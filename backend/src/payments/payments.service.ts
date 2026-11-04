import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  MockPaymentService,
  type ChargeResult,
} from './mock-payment.service.js';
import { VnpayGateway } from './vnpay/vnpay.gateway.js';
import { ProcessPaymentDto } from './dto/process-payment.dto.js';
import {
  Prisma,
  type Order,
  type Payment,
} from '../generated/prisma/client.js';
import { lockOrder } from '../orders/order-lock.js';
import {
  calculatePointsDiscount,
} from '../promotions/voucher-rules.js';

type OwnedPayment = Prisma.PaymentGetPayload<{
  include: { order: { select: { userId: true } } };
}>;
type PaymentClaim =
  | {
      kind: 'claimed';
      order: Order;
      payment: Payment;
      validPoints: number;
      discountVnd: number;
      realVndAmount: number;
    }
  | { kind: 'existing'; payment: OwnedPayment };

const REPLAY_WAIT_MS = 3000;
const REPLAY_POLL_MS = 200;
const VNPAY_EXPIRE_MS = 5 * 60 * 1000; // 5 phút theo chốt thiết kế

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mockPaymentService: MockPaymentService,
    private readonly vnpayGateway: VnpayGateway,
  ) {}

  async processPayment(
    userId: number,
    dto: ProcessPaymentDto,
    keyFromHeader?: string,
    requestPath = '/api/payments',
    clientIp = '127.0.0.1',
  ) {
    const idempotencyKey = dto.idempotencyKey?.trim() || keyFromHeader?.trim();
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message:
          'Thiếu Idempotency-Key. Vui lòng truyền qua Header hoặc Body để đảm bảo an toàn giao dịch',
      });
    }
    const requestHash = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          orderId: dto.orderId,
          method: dto.method,
          pointsUsed: dto.pointsUsed ?? 0,
          mockResult: dto.mockResult ?? null,
        }),
      )
      .digest('hex');
    const deadline = Date.now() + REPLAY_WAIT_MS;
    const existing = await this.findPayment(idempotencyKey);
    if (existing) {
      return this.replay(existing, userId, dto.orderId, requestHash, deadline);
    }

    let claim: PaymentClaim;
    try {
      claim = await this.prisma.$transaction(
        async (tx): Promise<PaymentClaim> => {
          await lockOrder(tx, dto.orderId);
          // Another request may have claimed this key while we waited for the row.
          // Release this transaction before polling so finalization can acquire it.
          const raced = await this.findPayment(idempotencyKey, tx);
          if (raced) return { kind: 'existing', payment: raced };

          const order = await tx.order.findUnique({
            where: { id: dto.orderId },
          });
          if (!order) {
            throw new NotFoundException({
              code: 'ORDER_NOT_FOUND',
              message: `Không tìm thấy đơn hàng #${dto.orderId}`,
            });
          }
          if (order.userId !== userId) {
            throw new ForbiddenException({
              code: 'FORBIDDEN',
              message:
                'Bạn không có quyền thanh toán cho đơn hàng của người khác',
            });
          }
          this.assertPayable(order);
          const inProgress = await tx.payment.findFirst({
            where: { orderId: order.id, status: 'PROCESSING' },
          });
          if (inProgress) throw this.inProgress();

          // Tính toán điểm thưởng sử dụng (nếu có)
          const requestedPoints = dto.pointsUsed ?? 0;
          if (requestedPoints % 20 !== 0) {
            throw new BadRequestException({
              code: 'INVALID_POINTS_STEP',
              message: 'Số điểm sử dụng phải là bội số của 20 (20 điểm = 1.000đ)',
            });
          }

          const { validPoints, discountVnd } = calculatePointsDiscount(
            requestedPoints,
            order.total,
          );
          const realVndAmount = order.total - discountVnd;

          if (dto.method === 'POINTS' && realVndAmount > 0) {
            throw new BadRequestException({
              code: 'INSUFFICIENT_POINTS_FOR_FULL_PAYMENT',
              message: `Thanh toán bằng POINTS yêu cầu trả đủ 100% giá trị đơn (${order.total}đ)`,
            });
          }

          if (dto.method === 'VNPAY' && realVndAmount > 0 && realVndAmount < 5000) {
            throw new BadRequestException({
              code: 'VNPAY_MIN_AMOUNT_INVALID',
              message:
                'Số tiền thanh toán qua VNPAY tối thiểu là 5.000đ. Vui lòng điều chỉnh lại số điểm.',
            });
          }

          // Trừ điểm nguyên tử có điều kiện ngay trong transaction giữ suất thanh toán
          if (validPoints > 0) {
            const updatedUser = await tx.user.updateMany({
              where: {
                id: userId,
                loyaltyPoints: { gte: validPoints },
              },
              data: {
                loyaltyPoints: { decrement: validPoints },
              },
            });
            if (updatedUser.count === 0) {
              throw new BadRequestException({
                code: 'INSUFFICIENT_LOYALTY_POINTS',
                message: 'Số dư điểm thưởng không đủ để thực hiện giao dịch',
              });
            }
          }

          const expiresAt =
            dto.method === 'VNPAY'
              ? new Date(Date.now() + VNPAY_EXPIRE_MS)
              : null;

          const payment = await tx.payment.create({
            data: {
              orderId: order.id,
              idempotencyKey,
              requestHash,
              amount: realVndAmount,
              pointsUsed: validPoints,
              pointsAmount: discountVnd,
              method: dto.method,
              status: 'PROCESSING',
              expiresAt,
            },
          });

          if (validPoints > 0) {
            await tx.loyaltyTransaction.create({
              data: {
                userId,
                orderId: order.id,
                paymentId: payment.id,
                type: 'REDEEM',
                points: -validPoints,
                pointsAmount: discountVnd,
              },
            });
          }

          return {
            kind: 'claimed',
            order,
            payment,
            validPoints,
            discountVnd,
            realVndAmount,
          };
        },
      );
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
      // The key is global: requests for different orders can race at INSERT.
      // Read only after the failed transaction has rolled back.
      const raced = await this.findPayment(idempotencyKey);
      if (!raced) throw this.inProgress(); // Partial unique index for this order.
      return this.replay(raced, userId, dto.orderId, requestHash, deadline);
    }
    if (claim.kind === 'existing') {
      return this.replay(
        claim.payment,
        userId,
        dto.orderId,
        requestHash,
        deadline,
      );
    }

    const { order, payment, validPoints, discountVnd, realVndAmount } = claim;

    // NHÁNH 1: Thanh toán 100% bằng điểm thưởng (POINTS) hoặc VNPAY nhưng điểm đã trả hết 100%
    if (dto.method === 'POINTS' || (dto.method === 'VNPAY' && realVndAmount === 0)) {
      const response: Prisma.JsonObject = {
        payment: {
          id: payment.id,
          orderId: order.id,
          amount: 0,
          pointsUsed: validPoints,
          pointsAmount: discountVnd,
          method: dto.method,
          status: 'SUCCESS',
          providerRef: `POINTS_${payment.id}`,
        },
        order: {
          id: order.id,
          code: `#${order.id}`,
          status: 'PAID',
          total: order.total,
          pointsEarned: 0, // Đơn trả 100% bằng điểm không tích thêm điểm
        },
      };

      await this.prisma.$transaction(async (tx) => {
        await this.lockPayableOrder(tx, order.id);
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'SUCCESS',
            providerRef: `POINTS_${payment.id}`,
            responseSnapshot: response,
          },
        });
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'PAID', pointsEarned: 0 },
        });
      });

      return { isReplayed: false, statusCode: HttpStatus.CREATED, data: response };
    }

    // NHÁNH 2: Thanh toán qua cổng VNPAY Sandbox (bất đồng bộ, đợi IPN)
    if (dto.method === 'VNPAY') {
      const gatewayTxnRef = `${order.id}_${payment.id}_${Date.now()}`;
      const expiresAt = payment.expiresAt ?? new Date(Date.now() + VNPAY_EXPIRE_MS);
      const paymentUrl = this.vnpayGateway.createPaymentUrl({
        txnRef: gatewayTxnRef,
        amount: realVndAmount,
        orderInfo: `Thanh toan don hang #${order.id}`,
        ipAddr: clientIp,
        expireDate: expiresAt,
      });

      const response: Prisma.JsonObject = {
        payment: {
          id: payment.id,
          orderId: order.id,
          amount: realVndAmount,
          pointsUsed: validPoints,
          pointsAmount: discountVnd,
          method: 'VNPAY',
          status: 'PROCESSING',
          gatewayTxnRef,
          expiresAt: expiresAt.toISOString(),
        },
        paymentUrl,
        order: {
          id: order.id,
          code: `#${order.id}`,
          status: order.status,
          total: order.total,
        },
      };

      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          gatewayTxnRef,
          providerRef: gatewayTxnRef,
          responseSnapshot: response,
        },
      });

      return { isReplayed: false, statusCode: HttpStatus.CREATED, data: response };
    }

    // NHÁNH 3: Thanh toán Mock (WALLET / CARD) giữ nguyên cho Test & tương thích cũ
    let chargeResult: ChargeResult;
    try {
      chargeResult = await this.mockPaymentService.charge({
        amount: realVndAmount,
        method: dto.method,
        mockResult: dto.mockResult,
      });
    } catch {
      chargeResult = {
        success: false,
        failureReason: 'Cổng thanh toán không phản hồi, vui lòng thử lại',
      };
    }

    const statusCode = chargeResult.success
      ? HttpStatus.CREATED
      : HttpStatus.PAYMENT_REQUIRED;
    const response: Prisma.JsonObject = chargeResult.success
      ? {
          payment: {
            id: payment.id,
            orderId: order.id,
            amount: realVndAmount,
            pointsUsed: validPoints,
            pointsAmount: discountVnd,
            method: dto.method,
            status: 'SUCCESS',
            providerRef: chargeResult.providerRef ?? null,
          },
          order: {
            id: order.id,
            code: `#${order.id}`,
            status: 'PAID',
            total: order.total,
            pointsEarned: order.pointsEarned,
          },
        }
      : {
          statusCode,
          code: 'PAYMENT_FAILED',
          message:
            chargeResult.failureReason ?? 'Cổng thanh toán từ chối giao dịch',
          order: {
            id: order.id,
            code: `#${order.id}`,
            status: 'PAYMENT_FAILED',
          },
          path: requestPath,
          timestamp: new Date().toISOString(),
        };

    await this.prisma.$transaction(async (tx) => {
      await this.lockPayableOrder(tx, order.id);
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: chargeResult.success ? 'SUCCESS' : 'FAILED',
          providerRef: chargeResult.providerRef,
          failureReason: chargeResult.failureReason,
          responseSnapshot: response,
        },
      });
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: chargeResult.success ? 'PAID' : 'PAYMENT_FAILED',
        },
      });

      // Nếu thanh toán thất bại mà có giữ điểm thì hoàn trả điểm ngay
      if (!chargeResult.success && validPoints > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { loyaltyPoints: { increment: validPoints } },
        });
        await tx.loyaltyTransaction.create({
          data: {
            userId,
            orderId: order.id,
            paymentId: payment.id,
            type: 'REFUND',
            points: validPoints,
            pointsAmount: discountVnd,
          },
        });
      }
    });
    return { isReplayed: false, statusCode, data: response };
  }

  /**
   * Xử lý IPN Webhook từ VNPAY Sandbox (kiểm tra chữ ký, số tiền, idempotent).
   */
  async handleVnpayIpn(query: Record<string, string>) {
    const isValidSignature = this.vnpayGateway.verifyIpn(query);
    const txnRef = query['vnp_TxnRef'] || '';
    const amount = Number(query['vnp_Amount'] || 0) / 100;
    const responseCode = query['vnp_ResponseCode'];
    const transactionNo = query['vnp_TransactionNo'];
    const bankCode = query['vnp_BankCode'];

    // Sanitize dữ liệu trước khi lưu log (không lưu secret)
    const sanitizedPayload: Record<string, string> = { ...query };
    delete sanitizedPayload['vnp_SecureHash'];
    delete sanitizedPayload['vnp_SecureHashType'];

    if (!isValidSignature) {
      await this.prisma.paymentWebhookLog.create({
        data: {
          gatewayTxnRef: txnRef || 'UNKNOWN',
          gatewayTransactionNo: transactionNo,
          amount: Number.isNaN(amount) ? 0 : amount,
          responseCode,
          signatureValid: false,
          processed: false,
          message: 'Invalid checksum signature',
          rawPayload: sanitizedPayload,
        },
      });
      return { RspCode: '97', Message: 'Invalid signature' };
    }

    const payment = await this.prisma.payment.findUnique({
      where: { gatewayTxnRef: txnRef },
    });

    if (!payment) {
      await this.prisma.paymentWebhookLog.create({
        data: {
          gatewayTxnRef: txnRef || 'UNKNOWN',
          gatewayTransactionNo: transactionNo,
          amount,
          responseCode,
          signatureValid: true,
          processed: false,
          message: 'Order payment not found',
          rawPayload: sanitizedPayload,
        },
      });
      return { RspCode: '01', Message: 'Order not found' };
    }

    if (payment.amount !== amount) {
      await this.prisma.paymentWebhookLog.create({
        data: {
          paymentId: payment.id,
          gatewayTxnRef: txnRef,
          gatewayTransactionNo: transactionNo,
          amount,
          responseCode,
          signatureValid: true,
          processed: false,
          message: `Invalid amount: expected ${payment.amount}, got ${amount}`,
          rawPayload: sanitizedPayload,
        },
      });
      return { RspCode: '04', Message: 'Invalid amount' };
    }

    // Xử lý trong transaction có lockOrder để chống race condition khi IPN gửi lặp
    return this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, payment.orderId);

      const lockedPayment = await tx.payment.findUnique({
        where: { id: payment.id },
      });
      const order = await tx.order.findUnique({
        where: { id: payment.orderId },
      });

      if (!lockedPayment || !order) {
        return { RspCode: '01', Message: 'Order not found' };
      }

      // IPN gửi lặp khi giao dịch đã kết thúc (SUCCESS / FAILED)
      if (
        lockedPayment.status === 'SUCCESS' ||
        lockedPayment.status === 'FAILED'
      ) {
        await tx.paymentWebhookLog.create({
          data: {
            paymentId: lockedPayment.id,
            gatewayTxnRef: txnRef,
            gatewayTransactionNo: transactionNo,
            amount,
            responseCode,
            signatureValid: true,
            processed: false,
            message: 'Order already confirmed (Idempotent replay)',
            rawPayload: sanitizedPayload,
          },
        });
        return { RspCode: '02', Message: 'Order already confirmed' };
      }

      // Trường hợp 9: Tiền VNPAY về muộn sau khi đơn đã CANCELLED hoặc thanh toán đã EXPIRED
      if (
        order.status === 'CANCELLED' ||
        lockedPayment.status === 'EXPIRED' ||
        lockedPayment.status === 'CANCELLED'
      ) {
        if (responseCode === '00') {
          await tx.paymentRefund.create({
            data: {
              paymentId: lockedPayment.id,
              amount,
              status: 'PENDING',
              gatewayRefundNo: transactionNo,
              failureReason: 'LATE_PAYMENT_AFTER_CANCEL_OR_EXPIRY',
            },
          });
        }
        await tx.paymentWebhookLog.create({
          data: {
            paymentId: lockedPayment.id,
            gatewayTxnRef: txnRef,
            gatewayTransactionNo: transactionNo,
            amount,
            responseCode,
            signatureValid: true,
            processed: true,
            message: 'Late payment recorded for reconciliation/refund',
            rawPayload: sanitizedPayload,
          },
        });
        return { RspCode: '00', Message: 'Confirm Success' };
      }

      // Giao dịch VNPAY thành công
      if (responseCode === '00') {
        const successSnapshot: Prisma.JsonObject = {
          payment: {
            id: lockedPayment.id,
            orderId: order.id,
            amount: lockedPayment.amount,
            pointsUsed: lockedPayment.pointsUsed,
            pointsAmount: lockedPayment.pointsAmount,
            method: 'VNPAY',
            status: 'SUCCESS',
            providerRef: transactionNo ?? txnRef,
            gatewayTxnRef: txnRef,
            gatewayTransactionNo: transactionNo ?? null,
          },
          order: {
            id: order.id,
            code: `#${order.id}`,
            status: 'PAID',
            total: order.total,
          },
        };

        await tx.payment.update({
          where: { id: lockedPayment.id },
          data: {
            status: 'SUCCESS',
            providerRef: transactionNo ?? txnRef,
            gatewayTransactionNo: transactionNo,
            gatewayBankCode: bankCode,
            gatewayResponseCode: responseCode,
            ipnProcessedAt: new Date(),
            responseSnapshot: successSnapshot,
          },
        });

        await tx.order.update({
          where: { id: order.id },
          data: { status: 'PAID' },
        });

        await tx.paymentWebhookLog.create({
          data: {
            paymentId: lockedPayment.id,
            gatewayTxnRef: txnRef,
            gatewayTransactionNo: transactionNo,
            amount,
            responseCode,
            signatureValid: true,
            processed: true,
            message: 'Payment confirmed successfully',
            rawPayload: sanitizedPayload,
          },
        });

        return { RspCode: '00', Message: 'Confirm Success' };
      }

      // Giao dịch VNPAY thất bại / khách hủy -> Hoàn lại điểm đã giữ (đúng 1 lần)
      await tx.payment.update({
        where: { id: lockedPayment.id },
        data: {
          status: 'FAILED',
          gatewayTransactionNo: transactionNo,
          gatewayBankCode: bankCode,
          gatewayResponseCode: responseCode,
          failureReason: `VNPAY failed with code ${responseCode}`,
          ipnProcessedAt: new Date(),
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: { status: 'PAYMENT_FAILED' },
      });

      if (lockedPayment.pointsUsed > 0) {
        const existingRefund = await tx.loyaltyTransaction.findFirst({
          where: { paymentId: lockedPayment.id, type: 'REFUND' },
        });
        if (!existingRefund) {
          await tx.user.update({
            where: { id: order.userId },
            data: { loyaltyPoints: { increment: lockedPayment.pointsUsed } },
          });
          await tx.loyaltyTransaction.create({
            data: {
              userId: order.userId,
              orderId: order.id,
              paymentId: lockedPayment.id,
              type: 'REFUND',
              points: lockedPayment.pointsUsed,
              pointsAmount: lockedPayment.pointsAmount,
            },
          });
        }
      }

      await tx.paymentWebhookLog.create({
        data: {
          paymentId: lockedPayment.id,
          gatewayTxnRef: txnRef,
          gatewayTransactionNo: transactionNo,
          amount,
          responseCode,
          signatureValid: true,
          processed: true,
          message: `Payment failed with code ${responseCode}`,
          rawPayload: sanitizedPayload,
        },
      });

      return { RspCode: '00', Message: 'Confirm Success' };
    });
  }

  /**
   * Xác thực dữ liệu Return URL và đọc trạng thái DB cho Frontend.
   */
  async verifyVnpayReturn(query: Record<string, string>) {
    const isValidSignature = this.vnpayGateway.verifyIpn(query);
    const txnRef = query['vnp_TxnRef'] || '';
    const payment = await this.prisma.payment.findUnique({
      where: { gatewayTxnRef: txnRef },
      include: { order: true },
    });

    return {
      isValidSignature,
      responseCode: query['vnp_ResponseCode'] ?? null,
      payment: payment
        ? {
            id: payment.id,
            orderId: payment.orderId,
            amount: payment.amount,
            pointsUsed: payment.pointsUsed,
            pointsAmount: payment.pointsAmount,
            status: payment.status,
            method: payment.method,
          }
        : null,
      order: payment?.order
        ? {
            id: payment.order.id,
            status: payment.order.status,
            total: payment.order.total,
          }
        : null,
    };
  }

  private findPayment(
    key: string,
    db: Pick<Prisma.TransactionClient, 'payment'> = this.prisma,
  ) {
    return db.payment.findUnique({
      where: { idempotencyKey: key },
      include: { order: { select: { userId: true } } },
    });
  }

  private async replay(
    payment: OwnedPayment,
    userId: number,
    orderId: number,
    requestHash: string,
    deadline: number,
  ) {
    for (;;) {
      // Authorization precedes both the status check and any snapshot access.
      if (
        payment.order.userId !== userId ||
        payment.orderId !== orderId ||
        payment.requestHash !== requestHash
      ) {
        throw new UnprocessableEntityException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'Idempotency-Key này đã được sử dụng cho một giao dịch khác',
        });
      }
      if (payment.status !== 'PROCESSING' || payment.method === 'VNPAY') {
        if (payment.responseSnapshot === null) throw this.inProgress();
        return {
          isReplayed: true,
          statusCode:
            payment.status === 'FAILED'
              ? HttpStatus.PAYMENT_REQUIRED
              : HttpStatus.CREATED,
          data: payment.responseSnapshot,
        };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw this.inProgress();
      await delay(Math.min(REPLAY_POLL_MS, remaining));
      const current = await this.findPayment(payment.idempotencyKey);
      if (!current) throw this.inProgress();
      payment = current;
    }
  }

  private inProgress() {
    return new ConflictException({
      code: 'PAYMENT_IN_PROGRESS',
      message:
        'Đơn hàng đang có giao dịch thanh toán đang xử lý, vui lòng thử lại',
    });
  }

  private assertPayable(order: Order) {
    // A failed retry may remain PAYMENT_FAILED. Never overwrite terminal states.
    if (order.status !== 'PENDING' && order.status !== 'PAYMENT_FAILED') {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: `Không thể thanh toán đơn hàng đang ở trạng thái ${order.status}`,
      });
    }
  }

  private async lockPayableOrder(
    tx: Prisma.TransactionClient,
    orderId: number,
  ) {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: `Không tìm thấy đơn hàng #${orderId}`,
      });
    }
    this.assertPayable(order);
  }
}