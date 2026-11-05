import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  InventoryService,
  InsufficientIngredients,
} from '../inventory/inventory.service.js';
import { inventoryTransaction } from '../inventory/transaction.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  MockPaymentService,
  type ChargeResult,
} from './mock-payment.service.js';
import { ProcessPaymentDto } from './dto/process-payment.dto.js';
import {
  Prisma,
  type Order,
  type Payment,
  type PaymentStatus,
} from '../generated/prisma/client.js';
import { lockOrder } from '../orders/order-lock.js';
import {
  VnpayGateway,
  type VnpayQueryResult,
} from './vnpay/vnpay.gateway.js';
import {
  parseVnpDate,
  sanitizeVnpayPayload,
} from './vnpay/vnpay.util.js';

type OwnedPayment = Prisma.PaymentGetPayload<{
  include: {
    order: { select: { userId: true; status: true; total: true } };
    refunds: true;
  };
}>;

type PaymentClaim =
  | { kind: 'claimed'; order: Order; payment: Payment }
  | { kind: 'existing'; payment: OwnedPayment };

const REPLAY_WAIT_MS = 3000;
const REPLAY_POLL_MS = 200;
const VNPAY_MIN_AMOUNT = 5000;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mockPaymentService: MockPaymentService,
    private readonly vnpayGateway: VnpayGateway,
    private readonly inventory: InventoryService,
    private readonly configService: ConfigService,
  ) {}

  private isMockAllowed(): boolean {
    const mockEnv = this.configService.get<string>('PAYMENT_MOCK_ENABLED');
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    if (mockEnv === 'false') return false;
    if (nodeEnv === 'production' && mockEnv !== 'true') return false;
    return true;
  }

  async processPayment(
    userId: number,
    dto: ProcessPaymentDto,
    keyFromHeader?: string,
    requestPath = '/api/payments',
    clientIp = '127.0.0.1',
  ) {
    if (dto.method === 'POINTS') {
      throw new BadRequestException({
        code: 'PAYMENT_METHOD_NOT_SUPPORTED',
        message: 'Hệ thống chưa hỗ trợ thanh toán bằng điểm thưởng',
      });
    }

    if (dto.method === 'WALLET' || dto.method === 'CARD') {
      if (!this.isMockAllowed()) {
        throw new BadRequestException({
          code: 'PAYMENT_METHOD_NOT_SUPPORTED',
          message: 'Phương thức thanh toán thử nghiệm (WALLET/CARD) hiện không khả dụng',
        });
      }
    }

    if (dto.method === 'VNPAY' && dto.mockResult && !this.isMockAllowed()) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'mockResult chỉ hợp lệ khi chế độ giả lập được bật',
      });
    }

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
          mockResult: dto.method !== 'VNPAY' ? (dto.mockResult ?? null) : null,
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
              message: 'Bạn không có quyền thanh toán cho đơn hàng của người khác',
            });
          }
          this.assertPayable(order);

          if (dto.method === 'VNPAY' && order.total < VNPAY_MIN_AMOUNT) {
            throw new UnprocessableEntityException({
              code: 'VNPAY_MIN_AMOUNT_INVALID',
              message: `Đơn hàng tối thiểu để thanh toán qua VNPAY là ${VNPAY_MIN_AMOUNT.toLocaleString('vi-VN')}đ`,
            });
          }

          // Kiểm tra xem đơn hàng có giao dịch PROCESSING nào chưa hết hạn không
          const inProgress = await tx.payment.findFirst({
            where: {
              orderId: order.id,
              status: 'PROCESSING',
              OR: [
                { expiresAt: null },
                { expiresAt: { gt: new Date() } },
              ],
            },
          });
          if (inProgress) throw this.inProgress();

          const payment = await tx.payment.create({
            data: {
              orderId: order.id,
              idempotencyKey,
              requestHash,
              amount: order.total,
              method: dto.method,
              status: 'PROCESSING',
            },
          });
          return { kind: 'claimed', order, payment };
        },
      );
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
      const raced = await this.findPayment(idempotencyKey);
      if (!raced) throw this.inProgress();
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

    const { order, payment } = claim;

    // --- NHÁNH 1: THANH TOÁN VNPAY ---
    if (dto.method === 'VNPAY') {
      const { paymentUrl, txnRef, vnpCreateDate, expiresAt } =
        this.vnpayGateway.createPaymentUrl({
          orderId: order.id,
          paymentId: payment.id,
          amount: order.total,
          ipAddr: clientIp,
          bankCode: dto.bankCode,
        });

      const responsePayload: Prisma.JsonObject = {
        payment: {
          id: payment.id,
          orderId: order.id,
          amount: order.total,
          method: 'VNPAY',
          status: 'PROCESSING',
          paymentUrl,
          expiresAt: expiresAt.toISOString(),
        },
        order: {
          id: order.id,
          code: `#${order.id}`,
          status: order.status,
          total: order.total,
        },
      };

      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            gatewayTxnRef: txnRef,
            paymentUrl,
            vnpCreateDate,
            gatewayCreatedAt: new Date(),
            expiresAt,
            responseSnapshot: responsePayload,
          },
        });

        await tx.paymentWebhookLog.create({
          data: {
            paymentId: payment.id,
            source: 'CREATE',
            result: 'RECEIVED',
            gatewayTxnRef: txnRef,
            amount: order.total,
            message: `Tạo link thanh toán VNPAY thành công cho đơn #${order.id}`,
            rawPayload: {
              orderId: order.id,
              amount: order.total,
              vnpCreateDate,
              expiresAt: expiresAt.toISOString(),
            },
          },
        });
      });

      return {
        isReplayed: false,
        statusCode: HttpStatus.CREATED,
        data: responsePayload,
      };
    }

    // --- NHÁNH 2: THANH TOÁN MOCK (WALLET / CARD) ---
    let chargeResult: ChargeResult;
    try {
      chargeResult = await this.mockPaymentService.charge({
        amount: order.total,
        method: dto.method,
        mockResult: dto.mockResult,
      });
    } catch {
      chargeResult = {
        success: false,
        failureReason: 'Cổng thanh toán không phản hồi, vui lòng thử lại',
      };
    }

    const finalized = await inventoryTransaction(this.prisma, async (tx) => {
      await this.lockPayableOrder(tx, order.id);
      let outcome = chargeResult;
      if (outcome.success) {
        try {
          await this.inventory.hold(tx, order.id);
        } catch (error) {
          if (!(error instanceof InsufficientIngredients)) throw error;
          outcome = {
            success: false,
            failureReason:
              'INSUFFICIENT_INGREDIENTS: Không đủ nguyên liệu để thanh toán đơn hàng.',
          };
        }
      }

      const statusCode = outcome.success
        ? HttpStatus.CREATED
        : HttpStatus.PAYMENT_REQUIRED;

      const response: Prisma.JsonObject = outcome.success
        ? {
            payment: {
              id: payment.id,
              orderId: order.id,
              amount: order.total,
              method: dto.method,
              status: 'SUCCESS',
              providerRef: outcome.providerRef ?? null,
            },
            order: {
              id: order.id,
              code: `#${order.id}`,
              status: 'PAID',
              total: order.total,
              pointsEarned: 0,
            },
          }
        : {
            statusCode,
            code: 'PAYMENT_FAILED',
            message:
              outcome.failureReason ?? 'Cổng thanh toán từ chối giao dịch',
            order: {
              id: order.id,
              code: `#${order.id}`,
              status: 'PAYMENT_FAILED',
            },
            path: requestPath,
            timestamp: new Date().toISOString(),
          };

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: outcome.success ? 'SUCCESS' : 'FAILED',
          providerRef: outcome.providerRef,
          failureReason: outcome.failureReason,
          responseSnapshot: response,
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: outcome.success ? 'PAID' : 'PAYMENT_FAILED',
        },
      });

      return { statusCode, data: response };
    });

    return { isReplayed: false, ...finalized };
  }

  /**
   * Hàm chốt kết quả thanh toán dùng chung cho IPN, Return, QueryDR và Job đối soát.
   * Chạy nguyên tử trong transaction có lockOrder + khóa Payment, đảm bảo Idempotent.
   */
  async settlePayment(params: {
    paymentId: number;
    gatewayResult: {
      success: boolean;
      responseCode: string;
      transactionStatus?: string;
      transactionNo?: string;
      bankCode?: string;
      cardType?: string;
      payDate?: string;
      amount?: number;
      source: 'IPN' | 'RETURN' | 'QUERY' | 'REFUND';
      requestId?: string;
      rawPayload?: Record<string, unknown>;
      message?: string;
    };
  }): Promise<{ status: PaymentStatus; message: string }> {
    return inventoryTransaction(this.prisma, async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: params.paymentId },
        include: { order: true },
      });

      if (!payment) {
        throw new NotFoundException({
          code: 'PAYMENT_NOT_FOUND',
          message: `Không tìm thấy giao dịch #${params.paymentId}`,
        });
      }

      await lockOrder(tx, payment.orderId);

      // Nếu giao dịch đã ở trạng thái kết thúc (terminal state)
      if (payment.status !== 'PROCESSING') {
        // Ghi log nhật ký gọi lại (Duplicate/Idempotent event)
        if (params.gatewayResult.rawPayload) {
          await tx.paymentWebhookLog.create({
            data: {
              paymentId: payment.id,
              source: params.gatewayResult.source,
              result: 'DUPLICATE',
              gatewayTxnRef: payment.gatewayTxnRef,
              gatewayTransactionNo: params.gatewayResult.transactionNo,
              amount: payment.amount,
              responseCode: params.gatewayResult.responseCode,
              signatureValid: true,
              processed: true,
              message: `Sự kiện ${params.gatewayResult.source} đến khi giao dịch đã ở trạng thái ${payment.status}`,
              rawPayload: sanitizeVnpayPayload(params.gatewayResult.rawPayload) as Prisma.InputJsonObject,
              requestId: params.gatewayResult.requestId,
            },
          });
        }
        return {
          status: payment.status,
          message: `Giao dịch đã được chốt trước đó (${payment.status})`,
        };
      }

      const order = payment.order;
      const { gatewayResult } = params;

      // 1. CỔNG BÁO THÀNH CÔNG (00)
      if (gatewayResult.success) {
        const isOrderPayable =
          order.status === 'PENDING' || order.status === 'PAYMENT_FAILED';
        const hasOtherSuccess = await tx.payment.findFirst({
          where: {
            orderId: order.id,
            status: 'SUCCESS',
            id: { not: payment.id },
          },
        });

        // 1.1. Đơn còn nhận thanh toán và chưa có giao dịch SUCCESS khác
        if (isOrderPayable && !hasOtherSuccess) {
          let holdSuccess = true;
          try {
            await this.inventory.hold(tx, order.id);
          } catch (err) {
            if (err instanceof InsufficientIngredients) {
              holdSuccess = false;
            } else {
              throw err;
            }
          }

          if (holdSuccess) {
            const paidAt = parseVnpDate(gatewayResult.payDate) || new Date();
            const responseSnapshot: Prisma.JsonObject = {
              payment: {
                id: payment.id,
                orderId: order.id,
                amount: payment.amount,
                method: payment.method,
                status: 'SUCCESS',
                providerRef: gatewayResult.transactionNo ?? null,
              },
              order: {
                id: order.id,
                code: `#${order.id}`,
                status: 'PAID',
                total: order.total,
                pointsEarned: 0,
              },
            };

            await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: 'SUCCESS',
                providerRef: gatewayResult.transactionNo,
                vnpPayDate: gatewayResult.payDate,
                paidAt,
                gatewayBankCode: gatewayResult.bankCode,
                cardType: gatewayResult.cardType,
                gatewayResponseCode: gatewayResult.responseCode,
                gatewayTransactionStatus: gatewayResult.transactionStatus,
                ipnProcessedAt:
                  gatewayResult.source === 'IPN' ? new Date() : undefined,
                responseSnapshot,
              },
            });

            await tx.order.update({
              where: { id: order.id },
              data: { status: 'PAID' },
            });

            if (gatewayResult.rawPayload) {
              await tx.paymentWebhookLog.create({
                data: {
                  paymentId: payment.id,
                  source: gatewayResult.source,
                  result: 'ACCEPTED',
                  gatewayTxnRef: payment.gatewayTxnRef,
                  gatewayTransactionNo: gatewayResult.transactionNo,
                  amount: payment.amount,
                  responseCode: gatewayResult.responseCode,
                  signatureValid: true,
                  processed: true,
                  message: `Thanh toán thành công đơn hàng #${order.id}`,
                  rawPayload: sanitizeVnpayPayload(gatewayResult.rawPayload) as Prisma.InputJsonObject,
                  requestId: gatewayResult.requestId,
                },
              });
            }

            return { status: 'SUCCESS', message: 'Thanh toán thành công' };
          } else {
            // Hết hàng/không đủ kho => NEEDS_REFUND
            await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: 'NEEDS_REFUND',
                providerRef: gatewayResult.transactionNo,
                vnpPayDate: gatewayResult.payDate,
                paidAt: parseVnpDate(gatewayResult.payDate) || new Date(),
                gatewayBankCode: gatewayResult.bankCode,
                cardType: gatewayResult.cardType,
                gatewayResponseCode: gatewayResult.responseCode,
                gatewayTransactionStatus: gatewayResult.transactionStatus,
                failureReason:
                  'INSUFFICIENT_INGREDIENTS: Kho không đủ nguyên liệu khi cổng thanh toán đã thu tiền.',
              },
            });

            await tx.paymentRefund.upsert({
              where: { paymentId: payment.id },
              create: {
                paymentId: payment.id,
                amount: payment.amount,
                idempotencyKey: `payment:${payment.id}:refund`,
                status: 'PENDING',
              },
              update: {},
            });

            if (gatewayResult.rawPayload) {
              await tx.paymentWebhookLog.create({
                data: {
                  paymentId: payment.id,
                  source: gatewayResult.source,
                  result: 'ACCEPTED',
                  gatewayTxnRef: payment.gatewayTxnRef,
                  gatewayTransactionNo: gatewayResult.transactionNo,
                  amount: payment.amount,
                  responseCode: gatewayResult.responseCode,
                  signatureValid: true,
                  processed: true,
                  message: `Đơn #${order.id} thiếu nguyên liệu khi cổng đã thu tiền, chuyển sang NEEDS_REFUND`,
                  rawPayload: sanitizeVnpayPayload(gatewayResult.rawPayload) as Prisma.InputJsonObject,
                  requestId: gatewayResult.requestId,
                },
              });
            }

            return {
              status: 'NEEDS_REFUND',
              message: 'Cổng đã thu tiền nhưng đơn hàng thiếu nguyên liệu, cần hoàn tiền',
            };
          }
        } else {
          // 1.2. Đơn đã hủy hoặc đã có giao dịch SUCCESS khác => NEEDS_REFUND
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: 'NEEDS_REFUND',
              providerRef: gatewayResult.transactionNo,
              vnpPayDate: gatewayResult.payDate,
              paidAt: parseVnpDate(gatewayResult.payDate) || new Date(),
              gatewayBankCode: gatewayResult.bankCode,
              cardType: gatewayResult.cardType,
              gatewayResponseCode: gatewayResult.responseCode,
              gatewayTransactionStatus: gatewayResult.transactionStatus,
              failureReason: `Giao dịch đến muộn khi đơn hàng đã ở trạng thái ${order.status}`,
            },
          });

          await tx.paymentRefund.upsert({
            where: { paymentId: payment.id },
            create: {
              paymentId: payment.id,
              amount: payment.amount,
              idempotencyKey: `payment:${payment.id}:refund`,
              status: 'PENDING',
            },
            update: {},
          });

          if (gatewayResult.rawPayload) {
            await tx.paymentWebhookLog.create({
              data: {
                paymentId: payment.id,
                source: gatewayResult.source,
                result: 'ACCEPTED',
                gatewayTxnRef: payment.gatewayTxnRef,
                gatewayTransactionNo: gatewayResult.transactionNo,
                amount: payment.amount,
                responseCode: gatewayResult.responseCode,
                signatureValid: true,
                processed: true,
                message: `Đơn #${order.id} không còn hợp lệ (${order.status}), giao dịch chuyển NEEDS_REFUND`,
                rawPayload: sanitizeVnpayPayload(gatewayResult.rawPayload) as Prisma.InputJsonObject,
                requestId: gatewayResult.requestId,
              },
            });
          }

          return {
            status: 'NEEDS_REFUND',
            message: 'Đơn hàng không hợp lệ để nhận thanh toán, chuyển sang NEEDS_REFUND',
          };
        }
      }

      // 2. CỔNG BÁO THẤT BẠI HOẶC HỦY
      const isCancelledByCustomer = gatewayResult.responseCode === '24';
      const targetStatus: PaymentStatus = isCancelledByCustomer
        ? 'CANCELLED'
        : 'FAILED';

      const failureReason =
        gatewayResult.message ||
        (isCancelledByCustomer
          ? 'Khách hàng hủy giao dịch trên cổng VNPAY'
          : `Giao dịch thất bại (mã phản hồi ${gatewayResult.responseCode})`);

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: targetStatus,
          failureReason,
          gatewayResponseCode: gatewayResult.responseCode,
          gatewayTransactionStatus: gatewayResult.transactionStatus,
        },
      });

      // Nếu không còn Payment PROCESSING nào khác trên đơn, chuyển đơn sang PAYMENT_FAILED
      const otherActive = await tx.payment.findFirst({
        where: {
          orderId: order.id,
          id: { not: payment.id },
          status: { in: ['PROCESSING', 'SUCCESS'] },
        },
      });

      if (!otherActive && order.status === 'PENDING') {
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'PAYMENT_FAILED' },
        });
      }

      if (gatewayResult.rawPayload) {
        await tx.paymentWebhookLog.create({
          data: {
            paymentId: payment.id,
            source: gatewayResult.source,
            result: isCancelledByCustomer ? 'RECEIVED' : 'REJECTED',
            gatewayTxnRef: payment.gatewayTxnRef,
            gatewayTransactionNo: gatewayResult.transactionNo,
            amount: payment.amount,
            responseCode: gatewayResult.responseCode,
            signatureValid: true,
            processed: true,
            message: failureReason,
            rawPayload: sanitizeVnpayPayload(gatewayResult.rawPayload) as Prisma.InputJsonObject,
            requestId: gatewayResult.requestId,
          },
        });
      }

      return { status: targetStatus, message: failureReason };
    });
  }

  /**
   * Xử lý IPN từ VNPAY (GET /api/payments/vnpay/ipn)
   */
  async processIpn(query: Record<string, unknown>): Promise<{
    RspCode: string;
    Message: string;
  }> {
    const rawPayload = sanitizeVnpayPayload(query);
    const txnRef = typeof query.vnp_TxnRef === 'string' ? query.vnp_TxnRef : '';
    const amountNum = Number(query.vnp_Amount);

    // 1. Xác minh chữ ký
    const isSignatureValid = this.vnpayGateway.verifySignature(query);
    if (!isSignatureValid) {
      await this.prisma.paymentWebhookLog.create({
        data: {
          source: 'IPN',
          result: 'REJECTED',
          gatewayTxnRef: txnRef || null,
          signatureValid: false,
          processed: false,
          message: 'Chữ ký IPN không hợp lệ',
          rawPayload: rawPayload as Prisma.InputJsonObject,
        },
      });
      return { RspCode: '97', Message: 'Invalid signature' };
    }

    // 2. Tìm payment theo gatewayTxnRef
    if (!txnRef) {
      return { RspCode: '01', Message: 'Order not found' };
    }

    const payment = await this.prisma.payment.findUnique({
      where: { gatewayTxnRef: txnRef },
    });

    if (!payment) {
      await this.prisma.paymentWebhookLog.create({
        data: {
          source: 'IPN',
          result: 'REJECTED',
          gatewayTxnRef: txnRef,
          signatureValid: true,
          processed: false,
          message: `Không tìm thấy Payment với gatewayTxnRef ${txnRef}`,
          rawPayload: rawPayload as Prisma.InputJsonObject,
        },
      });
      return { RspCode: '01', Message: 'Order not found' };
    }

    // 3. Kiểm tra số tiền
    if (amountNum !== payment.amount * 100) {
      await this.prisma.paymentWebhookLog.create({
        data: {
          paymentId: payment.id,
          source: 'IPN',
          result: 'REJECTED',
          gatewayTxnRef: txnRef,
          amount: payment.amount,
          signatureValid: true,
          processed: false,
          message: `Số tiền IPN (${amountNum / 100}) không khớp Payment (${payment.amount})`,
          rawPayload: rawPayload as Prisma.InputJsonObject,
        },
      });
      return { RspCode: '04', Message: 'Invalid amount' };
    }

    // 4. Kiểm tra trạng thái: nếu đã chốt rồi
    if (payment.status !== 'PROCESSING') {
      await this.prisma.paymentWebhookLog.create({
        data: {
          paymentId: payment.id,
          source: 'IPN',
          result: 'DUPLICATE',
          gatewayTxnRef: txnRef,
          amount: payment.amount,
          signatureValid: true,
          processed: true,
          message: 'Đơn hàng đã được xác nhận trước đó',
          rawPayload: rawPayload as Prisma.InputJsonObject,
        },
      });
      return { RspCode: '02', Message: 'Order already confirmed' };
    }

    // 5. Chốt kết quả
    const responseCode = String(query.vnp_ResponseCode ?? '99');
    const transactionStatus = query.vnp_TransactionStatus
      ? String(query.vnp_TransactionStatus)
      : undefined;

    const isSuccess = responseCode === '00' && (!transactionStatus || transactionStatus === '00');

    await this.settlePayment({
      paymentId: payment.id,
      gatewayResult: {
        success: isSuccess,
        responseCode,
        transactionStatus,
        transactionNo: query.vnp_TransactionNo ? String(query.vnp_TransactionNo) : undefined,
        bankCode: query.vnp_BankCode ? String(query.vnp_BankCode) : undefined,
        cardType: query.vnp_CardType ? String(query.vnp_CardType) : undefined,
        payDate: query.vnp_PayDate ? String(query.vnp_PayDate) : undefined,
        amount: payment.amount,
        source: 'IPN',
        rawPayload: query,
      },
    });

    return { RspCode: '00', Message: 'Confirm Success' };
  }

  /**
   * Xử lý Return URL khi khách hàng quay lại từ cổng VNPAY (GET /api/payments/vnpay/return)
   */
  async processReturn(userId: number, query: Record<string, unknown>) {
    const isSignatureValid = this.vnpayGateway.verifySignature(query);
    if (!isSignatureValid) {
      throw new BadRequestException({
        code: 'INVALID_SIGNATURE',
        message: 'Chữ ký phản hồi từ VNPAY không hợp lệ',
      });
    }

    const txnRef = typeof query.vnp_TxnRef === 'string' ? query.vnp_TxnRef : '';
    if (!txnRef) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Không tìm thấy thông tin giao dịch trong URL trả về',
      });
    }

    const payment = await this.prisma.payment.findUnique({
      where: { gatewayTxnRef: txnRef },
      include: { order: true },
    });

    if (!payment) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: `Không tìm thấy giao dịch với mã ${txnRef}`,
      });
    }

    if (payment.order.userId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Bạn không có quyền xem kết quả giao dịch này',
      });
    }

    // Nếu Payment vẫn đang PROCESSING, gọi querydr đối soát để cập nhật ngay lập tức
    if (payment.status === 'PROCESSING') {
      let querydrResult: VnpayQueryResult | null = null;
      try {
        querydrResult = await this.vnpayGateway.queryTransaction({
          txnRef: payment.gatewayTxnRef!,
          transactionDate: payment.vnpCreateDate || payment.createdAt.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14),
        });
      } catch {
        querydrResult = null;
      }

      if (querydrResult && querydrResult.responseCode !== '99') {
        await this.settlePayment({
          paymentId: payment.id,
          gatewayResult: {
            success: querydrResult.success,
            responseCode: querydrResult.responseCode,
            transactionStatus: querydrResult.transactionStatus,
            transactionNo: querydrResult.transactionNo,
            bankCode: querydrResult.bankCode,
            cardType: querydrResult.cardType,
            payDate: querydrResult.payDate,
            source: 'RETURN',
            rawPayload: query,
          },
        });
      } else {
        // Nếu querydr không trả về hoặc timeout, sử dụng trực tiếp kết quả đã ký trên Return URL
        const returnResponseCode = String(query.vnp_ResponseCode ?? '99');
        const returnTxnStatus = query.vnp_TransactionStatus ? String(query.vnp_TransactionStatus) : undefined;
        const returnSuccess = returnResponseCode === '00' && (!returnTxnStatus || returnTxnStatus === '00');

        await this.settlePayment({
          paymentId: payment.id,
          gatewayResult: {
            success: returnSuccess,
            responseCode: returnResponseCode,
            transactionStatus: returnTxnStatus,
            transactionNo: query.vnp_TransactionNo ? String(query.vnp_TransactionNo) : undefined,
            bankCode: query.vnp_BankCode ? String(query.vnp_BankCode) : undefined,
            cardType: query.vnp_CardType ? String(query.vnp_CardType) : undefined,
            payDate: query.vnp_PayDate ? String(query.vnp_PayDate) : undefined,
            source: 'RETURN',
            rawPayload: query,
          },
        });
      }
    }

    // Lấy trạng thái mới nhất từ DB
    const latestPayment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: { order: true },
    });

    return {
      payment: {
        id: latestPayment.id,
        orderId: latestPayment.orderId,
        amount: latestPayment.amount,
        method: latestPayment.method,
        status: latestPayment.status,
        providerRef: latestPayment.providerRef,
        failureReason: latestPayment.failureReason,
        paidAt: latestPayment.paidAt,
      },
      order: {
        id: latestPayment.order.id,
        code: `#${latestPayment.order.id}`,
        status: latestPayment.order.status,
        total: latestPayment.order.total,
        pointsEarned: latestPayment.order.pointsEarned,
      },
    };
  }

  /**
   * Lấy chi tiết Payment (GET /api/payments/:id)
   */
  async getPayment(paymentId: number, userId: number, userRole: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        order: { select: { id: true, userId: true, total: true, status: true } },
        refunds: true,
      },
    });

    if (!payment) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: `Không tìm thấy giao dịch #${paymentId}`,
      });
    }

    if (payment.order.userId !== userId && userRole !== 'BARISTA') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Bạn không có quyền xem thông tin giao dịch này',
      });
    }

    // Nếu PROCESSING và đã hết hạn: đối soát
    if (
      payment.status === 'PROCESSING' &&
      payment.expiresAt &&
      payment.expiresAt <= new Date() &&
      payment.method === 'VNPAY' &&
      payment.gatewayTxnRef
    ) {
      await this.reconcileSinglePayment(payment.id);
    }

    const current = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: {
        order: { select: { id: true, userId: true, total: true, status: true } },
        refunds: true,
      },
    });

    // Chỉ chủ đơn mới thấy paymentUrl, và chỉ khi PROCESSING chưa hết hạn
    const isOwner = current.order.userId === userId;
    const isExpired = current.expiresAt ? current.expiresAt <= new Date() : false;
    const canSeeUrl = isOwner && current.status === 'PROCESSING' && !isExpired;

    return {
      id: current.id,
      orderId: current.orderId,
      amount: current.amount,
      method: current.method,
      status: current.status,
      providerRef: current.providerRef,
      failureReason: current.failureReason,
      paidAt: current.paidAt,
      expiresAt: current.expiresAt,
      refundedAt: current.refundedAt,
      refundedAmount: current.refundedAmount,
      refundRef: current.refundRef,
      paymentUrl: canSeeUrl ? current.paymentUrl : null,
      refunds: current.refunds,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
    };
  }

  /**
   * Hoàn tiền cho giao dịch (POST /api/payments/:id/refund) - Chỉ BARISTA
   */
  async refundPayment(
    paymentId: number,
    adminId: number,
    adminRole: string,
    clientIp = '127.0.0.1',
  ) {
    if (adminRole !== 'BARISTA') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Chỉ nhân viên BARISTA mới có quyền yêu cầu hoàn tiền',
      });
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { refunds: true },
    });

    if (!payment) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: `Không tìm thấy giao dịch #${paymentId}`,
      });
    }

    if (payment.status !== 'SUCCESS' && payment.status !== 'NEEDS_REFUND') {
      throw new ConflictException({
        code: 'INVALID_REFUND_STATE',
        message: `Chỉ giao dịch SUCCESS hoặc NEEDS_REFUND mới có thể hoàn tiền (hiện tại: ${payment.status})`,
      });
    }

    // Đã có bản ghi hoàn tiền SUCCESS chưa
    const existingSuccess = payment.refunds.find((r) => r.status === 'SUCCESS');
    if (existingSuccess || payment.refundedAt) {
      return {
        message: 'Giao dịch đã được hoàn tiền trước đó',
        refund: existingSuccess,
        payment,
      };
    }

    // Upsert bản ghi PaymentRefund ở trạng thái PROCESSING
    const refundRecord = await this.prisma.paymentRefund.upsert({
      where: { paymentId: payment.id },
      create: {
        paymentId: payment.id,
        amount: payment.amount,
        idempotencyKey: `payment:${payment.id}:refund`,
        status: 'PROCESSING',
      },
      update: {
        status: 'PROCESSING',
      },
    });

    if (payment.method === 'VNPAY') {
      const vnpTransactionDate =
        payment.vnpCreateDate ||
        payment.createdAt.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);

      const refundResult = await this.vnpayGateway.refund({
        txnRef: payment.gatewayTxnRef!,
        amount: payment.amount,
        transactionDate: vnpTransactionDate,
        transactionNo: payment.providerRef || '0',
        createBy: `BARISTA_${adminId}`,
        ipAddr: clientIp,
      });

      if (refundResult.success) {
        return this.prisma.$transaction(async (tx) => {
          const now = new Date();
          const updatedRefund = await tx.paymentRefund.update({
            where: { id: refundRecord.id },
            data: {
              status: 'SUCCESS',
              confirmedAt: now,
              gatewayRefundNo: refundResult.refundNo,
            },
          });

          const updatedPayment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              refundedAt: now,
              refundedAmount: payment.amount,
              refundRef: refundResult.refundNo || `VNPAY_REFUND_${payment.id}`,
            },
          });

          return {
            message: 'Hoàn tiền VNPAY thành công',
            refund: updatedRefund,
            payment: updatedPayment,
          };
        });
      } else {
        await this.prisma.paymentRefund.update({
          where: { id: refundRecord.id },
          data: {
            status: 'FAILED',
            failureReason: refundResult.failureReason,
            gatewayResponseCode: refundResult.responseCode,
          },
        });

        throw new BadRequestException({
          code: 'REFUND_FAILED',
          message: refundResult.failureReason || 'Cổng VNPAY từ chối hoàn tiền',
        });
      }
    } else {
      // Phương thức Mock (WALLET / CARD)
      const mockResult = await this.mockPaymentService.refund(payment.amount);
      return this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const updatedRefund = await tx.paymentRefund.update({
          where: { id: refundRecord.id },
          data: {
            status: 'SUCCESS',
            confirmedAt: now,
            gatewayRefundNo: mockResult.refundRef,
          },
        });

        const updatedPayment = await tx.payment.update({
          where: { id: payment.id },
          data: {
            refundedAt: now,
            refundedAmount: payment.amount,
            refundRef: mockResult.refundRef,
          },
        });

        return {
          message: 'Hoàn tiền mock thành công',
          refund: updatedRefund,
          payment: updatedPayment,
        };
      });
    }
  }

  /**
   * Đối soát một giao dịch VNPAY cụ thể khi hết hạn
   */
  async reconcileSinglePayment(paymentId: number) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment || payment.status !== 'PROCESSING' || payment.method !== 'VNPAY') {
      return;
    }

    if (!payment.gatewayTxnRef) return;

    let querydrResult: VnpayQueryResult | null = null;
    try {
      querydrResult = await this.vnpayGateway.queryTransaction({
        txnRef: payment.gatewayTxnRef,
        transactionDate:
          payment.vnpCreateDate ||
          payment.createdAt.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14),
      });
    } catch {
      querydrResult = null;
    }

    if (querydrResult && querydrResult.responseCode !== '99') {
      if (querydrResult.success) {
        await this.settlePayment({
          paymentId: payment.id,
          gatewayResult: {
            success: true,
            responseCode: querydrResult.responseCode,
            transactionStatus: querydrResult.transactionStatus,
            transactionNo: querydrResult.transactionNo,
            bankCode: querydrResult.bankCode,
            cardType: querydrResult.cardType,
            payDate: querydrResult.payDate,
            source: 'QUERY',
          },
        });
        return;
      }
    }

    // Nếu querydr xác nhận chưa thanh toán hoặc thất bại, và đã quá hạn
    if (payment.expiresAt && payment.expiresAt <= new Date()) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'EXPIRED',
          failureReason: 'Giao dịch hết hạn thanh toán',
        },
      });
    }
  }

  private findPayment(
    key: string,
    db: Pick<Prisma.TransactionClient, 'payment'> = this.prisma,
  ) {
    return db.payment.findUnique({
      where: { idempotencyKey: key },
      include: {
        order: { select: { userId: true, status: true, total: true } },
        refunds: true,
      },
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

      if (payment.method === 'VNPAY') {
        // Với VNPAY: nếu đang PROCESSING
        if (payment.status === 'PROCESSING') {
          // Kiểm tra nếu đã hết hạn
          if (payment.expiresAt && payment.expiresAt <= new Date()) {
            await this.reconcileSinglePayment(payment.id);
            const refreshed = await this.findPayment(payment.idempotencyKey);
            if (refreshed && refreshed.status === 'EXPIRED') {
              throw new ConflictException({
                code: 'PAYMENT_EXPIRED',
                message: 'Giao dịch đã hết hạn thanh toán. Vui lòng thanh toán lại với khóa mới',
              });
            }
          }

          return {
            isReplayed: true,
            statusCode: HttpStatus.CREATED,
            data: payment.responseSnapshot ?? {
              payment: {
                id: payment.id,
                orderId: payment.orderId,
                amount: payment.amount,
                method: payment.method,
                status: payment.status,
                paymentUrl: payment.paymentUrl,
                expiresAt: payment.expiresAt?.toISOString(),
              },
              order: {
                id: payment.orderId,
                code: `#${payment.orderId}`,
                status: payment.order.status,
                total: payment.order.total,
              },
            },
          };
        }

        // Nếu đã có snapshot và status !== PROCESSING
        if (payment.responseSnapshot) {
          return {
            isReplayed: true,
            statusCode:
              payment.status === 'SUCCESS'
                ? HttpStatus.CREATED
                : HttpStatus.PAYMENT_REQUIRED,
            data: payment.responseSnapshot,
          };
        }
      }

      // Với Mock payment
      if (payment.status !== 'PROCESSING') {
        if (payment.responseSnapshot === null) throw this.inProgress();
        return {
          isReplayed: true,
          statusCode:
            payment.status === 'SUCCESS'
              ? HttpStatus.CREATED
              : HttpStatus.PAYMENT_REQUIRED,
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
