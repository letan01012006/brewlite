import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
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
import { VnpayGateway, type VnpayQueryResult } from './vnpay/vnpay.gateway.js';
import { parseVnpDate, sanitizeVnpayPayload } from './vnpay/vnpay.util.js';
import {
  POINTS_STEP,
  pointsToDiscountVnd,
} from '../promotions/voucher-rules.js';

type OwnedPayment = Prisma.PaymentGetPayload<{
  include: {
    order: { select: { userId: true; status: true; total: true } };
    refunds: true;
  };
}>;

type PaymentClaim =
  | {
      kind: 'claimed';
      order: Order;
      payment: Payment;
      directResponse?: {
        isReplayed: boolean;
        statusCode: HttpStatus;
        data: Prisma.JsonObject;
      };
    }
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
    const pointsUsed = dto.pointsUsed ?? 0;
    if (!Number.isInteger(pointsUsed) || pointsUsed < 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Số điểm sử dụng phải là số nguyên không âm',
      });
    }

    if (pointsUsed > 0 && pointsUsed % POINTS_STEP !== 0) {
      throw new BadRequestException({
        code: 'INVALID_POINTS_AMOUNT',
        message: `Số điểm sử dụng phải là bội số của ${POINTS_STEP}`,
      });
    }

    if (dto.method === 'POINTS' && pointsUsed === 0) {
      throw new BadRequestException({
        code: 'POINTS_REQUIRED',
        message:
          'Phương thức thanh toán bằng điểm yêu cầu cung cấp số điểm sử dụng',
      });
    }

    if (dto.method === 'WALLET' || dto.method === 'CARD') {
      if (!this.isMockAllowed()) {
        throw new BadRequestException({
          code: 'PAYMENT_METHOD_NOT_SUPPORTED',
          message:
            'Phương thức thanh toán thử nghiệm (WALLET/CARD) hiện không khả dụng',
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
          pointsUsed,
          mockResult: dto.method !== 'VNPAY' ? (dto.mockResult ?? null) : null,
        }),
      )
      .digest('hex');

    // Validate before replay too, before persisting a session or holding points.
    if (dto.method === 'VNPAY' && !this.vnpayGateway.isConfigured()) {
      throw new ServiceUnavailableException({
        code: 'VNPAY_NOT_CONFIGURED',
        message: 'Cổng thanh toán VNPAY chưa được cấu hình đầy đủ',
      });
    }

    const deadline = Date.now() + REPLAY_WAIT_MS;
    const existing = await this.findPayment(idempotencyKey);
    if (existing) {
      return this.replay(existing, userId, dto.orderId, requestHash, deadline);
    }

    let claim: PaymentClaim;
    try {
      claim = await inventoryTransaction(
        this.prisma,
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
              message:
                'Bạn không có quyền thanh toán cho đơn hàng của người khác',
            });
          }
          this.assertPayable(order);

          // Serialize claims across keys; an active session must be reused.
          const inProgress = await tx.payment.findFirst({
            where: { orderId: order.id, status: 'PROCESSING' },
          });
          if (inProgress) throw this.inProgress();

          const pointsDiscountVnd = pointsToDiscountVnd(pointsUsed);
          const user = await tx.user.findUniqueOrThrow({
            where: { id: userId },
          });

          if (pointsUsed > 0) {
            if (user.loyaltyPoints < pointsUsed) {
              throw new BadRequestException({
                code: 'INSUFFICIENT_LOYALTY_POINTS',
                message: `Bạn không đủ điểm thưởng để thanh toán (hiện có ${user.loyaltyPoints} điểm, yêu cầu ${pointsUsed} điểm)`,
              });
            }
            if (pointsDiscountVnd > order.total) {
              throw new BadRequestException({
                code: 'POINTS_EXCEED_ORDER_TOTAL',
                message:
                  'Số điểm quy đổi vượt quá tổng tiền thanh toán của đơn hàng',
              });
            }
          }

          const realAmount = order.total - pointsDiscountVnd;

          if (realAmount === 0) {
            if (dto.method !== 'POINTS') {
              throw new BadRequestException({
                code: 'INVALID_PAYMENT_METHOD',
                message:
                  'Đơn hàng thanh toán 100% bằng điểm phải dùng phương thức POINTS',
              });
            }
          } else {
            if (dto.method === 'POINTS') {
              throw new BadRequestException({
                code: 'INVALID_PAYMENT_METHOD',
                message:
                  'Số điểm chưa đủ để thanh toán 100% đơn hàng. Vui lòng thanh toán phần còn lại qua VNPAY',
              });
            }
            if (dto.method === 'VNPAY' && realAmount < VNPAY_MIN_AMOUNT) {
              throw new UnprocessableEntityException({
                code: 'VNPAY_MIN_AMOUNT_INVALID',
                message: `Đơn hàng tối thiểu để thanh toán qua VNPAY là ${VNPAY_MIN_AMOUNT.toLocaleString('vi-VN')}đ`,
              });
            }
          }

          // Trừ điểm và cập nhật Order
          if (pointsUsed > 0) {
            const updatedUser = await tx.user.updateMany({
              where: { id: userId, loyaltyPoints: { gte: pointsUsed } },
              data: { loyaltyPoints: { decrement: pointsUsed } },
            });
            if (updatedUser.count === 0) {
              throw new BadRequestException({
                code: 'INSUFFICIENT_LOYALTY_POINTS',
                message:
                  'Số dư điểm thưởng không đủ hoặc đã được sử dụng ở giao dịch khác',
              });
            }

            await tx.order.update({
              where: { id: order.id },
              data: {
                discountAmount: order.discountAmount + pointsDiscountVnd,
                total: realAmount,
              },
            });
            order.discountAmount += pointsDiscountVnd;
            order.total = realAmount;
          }

          if (order.status === 'PAYMENT_FAILED' && dto.method !== 'POINTS') {
            await tx.order.update({
              where: { id: order.id },
              data: { status: 'PENDING' },
            });
            order.status = 'PENDING';
          }

          const payment = await tx.payment.create({
            data: {
              orderId: order.id,
              idempotencyKey,
              requestHash,
              amount: realAmount,
              method: dto.method,
              status: dto.method === 'POINTS' ? 'SUCCESS' : 'PROCESSING',
              pointsUsed,
              pointsAmount: pointsDiscountVnd,
            },
          });

          if (pointsUsed > 0) {
            await tx.loyaltyTransaction.create({
              data: {
                userId,
                orderId: order.id,
                paymentId: payment.id,
                type: 'REDEEM',
                points: -pointsUsed,
                pointsAmount: pointsDiscountVnd,
                eventKey: `payment:${payment.id}:redeem`,
              },
            });
          }

          // Nếu thanh toán 100% bằng POINTS: chuyển order sang PAID ngay
          if (dto.method === 'POINTS') {
            try {
              await this.inventory.hold(tx, order.id);
            } catch (error) {
              if (error instanceof InsufficientIngredients) {
                throw new UnprocessableEntityException({
                  code: 'INSUFFICIENT_INGREDIENTS',
                  message:
                    'INSUFFICIENT_INGREDIENTS: Không đủ nguyên liệu để thanh toán đơn hàng.',
                });
              }
              throw error;
            }

            await tx.order.update({
              where: { id: order.id },
              data: { status: 'PAID' },
            });

            const responsePayload: Prisma.JsonObject = {
              payment: {
                id: payment.id,
                orderId: order.id,
                amount: 0,
                method: 'POINTS',
                status: 'SUCCESS',
                pointsUsed,
                pointsAmount: pointsDiscountVnd,
              },
              order: {
                id: order.id,
                code: `#${order.id}`,
                status: 'PAID',
                total: 0,
                pointsEarned: 0,
              },
            };

            await tx.payment.update({
              where: { id: payment.id },
              data: { responseSnapshot: responsePayload },
            });

            return {
              kind: 'claimed',
              order,
              payment,
              directResponse: {
                isReplayed: false,
                statusCode: HttpStatus.CREATED,
                data: responsePayload,
              },
            };
          }

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

    if (claim.directResponse) {
      return claim.directResponse;
    }

    const { order, payment } = claim;

    // --- NHÁNH 1: THANH TOÁN VNPAY ---
    if (dto.method === 'VNPAY') {
      try {
        const { paymentUrl, txnRef, vnpCreateDate, expiresAt } =
          this.vnpayGateway.createPaymentUrl({
            orderId: order.id,
            paymentId: payment.id,
            amount: payment.amount,
            ipAddr: clientIp,
            bankCode: dto.bankCode,
          });

        const responsePayload: Prisma.JsonObject = {
          payment: {
            id: payment.id,
            orderId: order.id,
            amount: payment.amount,
            method: 'VNPAY',
            status: 'PROCESSING',
            pointsUsed: payment.pointsUsed,
            pointsAmount: payment.pointsAmount,
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
          await lockOrder(tx, order.id);
          const current = await tx.payment.findUniqueOrThrow({
            where: { id: payment.id },
          });
          if (current.status !== 'PROCESSING') throw this.inProgress();
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
              amount: payment.amount,
              message: `Tạo link thanh toán VNPAY thành công cho đơn #${order.id}`,
              rawPayload: {
                orderId: order.id,
                amount: payment.amount,
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
      } catch (error) {
        await this.settlePayment({
          paymentId: payment.id,
          gatewayResult: {
            success: false,
            responseCode: '99',
            source: 'QUERY',
            message: 'Không thể khởi tạo liên kết thanh toán VNPAY',
          },
        });
        throw new ServiceUnavailableException(
          {
            code: 'VNPAY_INITIALIZATION_FAILED',
            message:
              'Không thể khởi tạo liên kết thanh toán VNPAY. Vui lòng thử lại.',
          },
          { cause: error },
        );
      }
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
  }): Promise<{ status: PaymentStatus; message: string; duplicate?: boolean }> {
    return inventoryTransaction(this.prisma, async (tx) => {
      const identity = await tx.payment.findUnique({
        where: { id: params.paymentId },
        select: { orderId: true },
      });
      if (!identity) {
        throw new NotFoundException({
          code: 'PAYMENT_NOT_FOUND',
          message: `Không tìm thấy giao dịch #${params.paymentId}`,
        });
      }
      await lockOrder(tx, identity.orderId);
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: params.paymentId },
        include: { order: true },
      });
      const lateSuccess =
        params.gatewayResult.success &&
        ['CANCELLED', 'EXPIRED', 'FAILED'].includes(payment.status);

      // A terminal unsuccessful session can still have collected real money.
      if (payment.status !== 'PROCESSING' && !lateSuccess) {
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
              rawPayload: sanitizeVnpayPayload(
                params.gatewayResult.rawPayload,
              ) as Prisma.InputJsonObject,
              requestId: params.gatewayResult.requestId,
            },
          });
        }
        return {
          status: payment.status,
          duplicate: true,
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
        if (!lateSuccess && isOrderPayable && !hasOtherSuccess) {
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
                  rawPayload: sanitizeVnpayPayload(
                    gatewayResult.rawPayload,
                  ) as Prisma.InputJsonObject,
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

            await this.restoreHeldPoints(tx, payment, order);
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
                  rawPayload: sanitizeVnpayPayload(
                    gatewayResult.rawPayload,
                  ) as Prisma.InputJsonObject,
                  requestId: gatewayResult.requestId,
                },
              });
            }

            return {
              status: 'NEEDS_REFUND',
              message:
                'Cổng đã thu tiền nhưng đơn hàng thiếu nguyên liệu, cần hoàn tiền',
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

          await this.restoreHeldPoints(tx, payment, order);
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
                rawPayload: sanitizeVnpayPayload(
                  gatewayResult.rawPayload,
                ) as Prisma.InputJsonObject,
                requestId: gatewayResult.requestId,
              },
            });
          }

          return {
            status: 'NEEDS_REFUND',
            message:
              'Đơn hàng không hợp lệ để nhận thanh toán, chuyển sang NEEDS_REFUND',
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

      // Hoàn lại điểm thưởng nếu giao dịch thất bại / hủy
      await this.restoreHeldPoints(tx, payment, order);

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
            rawPayload: sanitizeVnpayPayload(
              gatewayResult.rawPayload,
            ) as Prisma.InputJsonObject,
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

    // Settlement rechecks the current state while holding the order lock.
    const responseCode = String(query.vnp_ResponseCode ?? '99');
    const transactionStatus = query.vnp_TransactionStatus
      ? String(query.vnp_TransactionStatus)
      : undefined;

    const isSuccess =
      responseCode === '00' &&
      (!transactionStatus || transactionStatus === '00');

    const result = await this.settlePayment({
      paymentId: payment.id,
      gatewayResult: {
        success: isSuccess,
        responseCode,
        transactionStatus,
        transactionNo: query.vnp_TransactionNo
          ? String(query.vnp_TransactionNo)
          : undefined,
        bankCode: query.vnp_BankCode ? String(query.vnp_BankCode) : undefined,
        cardType: query.vnp_CardType ? String(query.vnp_CardType) : undefined,
        payDate: query.vnp_PayDate ? String(query.vnp_PayDate) : undefined,
        amount: payment.amount,
        source: 'IPN',
        rawPayload: query,
      },
    });

    return result.duplicate
      ? { RspCode: '02', Message: 'Order already confirmed' }
      : { RspCode: '00', Message: 'Confirm Success' };
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
          transactionDate:
            payment.vnpCreateDate ||
            payment.createdAt
              .toISOString()
              .replace(/[-:T.Z]/g, '')
              .slice(0, 14),
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
        const returnTxnStatus = query.vnp_TransactionStatus
          ? String(query.vnp_TransactionStatus)
          : undefined;
        const returnSuccess =
          returnResponseCode === '00' &&
          (!returnTxnStatus || returnTxnStatus === '00');

        await this.settlePayment({
          paymentId: payment.id,
          gatewayResult: {
            success: returnSuccess,
            responseCode: returnResponseCode,
            transactionStatus: returnTxnStatus,
            transactionNo: query.vnp_TransactionNo
              ? String(query.vnp_TransactionNo)
              : undefined,
            bankCode: query.vnp_BankCode
              ? String(query.vnp_BankCode)
              : undefined,
            cardType: query.vnp_CardType
              ? String(query.vnp_CardType)
              : undefined,
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
        order: {
          select: { id: true, userId: true, total: true, status: true },
        },
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
        order: {
          select: { id: true, userId: true, total: true, status: true },
        },
        refunds: true,
      },
    });

    // Chỉ chủ đơn mới thấy paymentUrl, và chỉ khi PROCESSING chưa hết hạn
    const isOwner = current.order.userId === userId;
    const isExpired = current.expiresAt
      ? current.expiresAt <= new Date()
      : false;
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

    const claim = await inventoryTransaction(this.prisma, async (tx) => {
      const identity = await tx.payment.findUnique({
        where: { id: paymentId },
        select: { orderId: true },
      });
      if (!identity)
        throw new NotFoundException({
          code: 'PAYMENT_NOT_FOUND',
          message: 'Không tìm thấy giao dịch',
        });
      await lockOrder(tx, identity.orderId);
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: { order: true, refunds: true },
      });
      const existing = payment.refunds[0];
      if (payment.refundedAt || existing?.status === 'SUCCESS') {
        return { action: 'done' as const, payment, refund: existing ?? null };
      }
      if (!['SUCCESS', 'NEEDS_REFUND'].includes(payment.status)) {
        throw new ConflictException({
          code: 'INVALID_REFUND_STATE',
          message: 'Giao dịch chưa thể hoàn tiền',
        });
      }
      // The same order lock is taken by updateStatus: either refund or
      // preparation wins. Never send money after preparation has won.
      if (
        payment.status === 'SUCCESS' &&
        !['PENDING', 'PAYMENT_FAILED', 'PAID', 'CANCELLED'].includes(
          payment.order.status,
        )
      ) {
        throw new ConflictException({
          code: 'ORDER_ALREADY_PREPARING',
          message: 'Đơn đã được nhận pha chế, không thể hoàn tiền',
        });
      }
      if (payment.method === 'POINTS') {
        // PaymentRefund is a cash request (amount > 0). The loyalty ledger and
        // Payment settlement evidence record a points-only refund atomically.
        await this.restoreHeldPoints(tx, payment, payment.order, false);
        const updated = await tx.payment.update({
          where: { id: payment.id },
          data: {
            refundedAt: new Date(),
            refundedAmount: 0,
            refundRef: `POINTS_REFUND_${payment.id}`,
          },
        });
        await this.inventory.finish(tx, payment.orderId, false);
        return { action: 'done' as const, payment: updated, refund: null };
      }
      if (
        existing?.status === 'PROCESSING' &&
        Date.now() - existing.updatedAt.getTime() < 60000
      ) {
        return { action: 'pending' as const, payment, refund: existing };
      }
      if (payment.method === 'VNPAY' && !this.vnpayGateway.isConfigured()) {
        throw new ServiceUnavailableException({ code: 'VNPAY_NOT_CONFIGURED' });
      }
      const reconcile = Boolean(
        existing &&
        (existing.gatewayResponseCode !== null ||
          existing.status === 'PROCESSING'),
      );
      const refund = await tx.paymentRefund.upsert({
        where: { paymentId },
        create: {
          paymentId,
          amount: payment.amount,
          idempotencyKey: `payment:${payment.id}:refund`,
          status: 'PROCESSING',
        },
        update: { status: 'PROCESSING', confirmedAt: null },
      });
      return {
        action: reconcile ? ('reconcile' as const) : ('send' as const),
        payment,
        refund,
      };
    });
    if (claim.action === 'done')
      return {
        message: 'Giao dịch đã được hoàn tiền trước đó',
        payment: claim.payment,
        refund: claim.refund,
      };
    if (claim.action === 'pending')
      return {
        message: 'Đang chờ hoàn tiền',
        payment: claim.payment,
        refund: claim.refund,
      };
    const { payment, refund } = claim;
    const transactionDate =
      payment.vnpCreateDate ||
      payment.createdAt
        .toISOString()
        .replace(/[-:T.Z]/g, '')
        .slice(0, 14);

    // Finish under the order lock. A lease reclaimed after a process crash
    // invalidates the old worker, so a delayed reply cannot overwrite it.
    const finish = async (
      status: 'SUCCESS' | 'PENDING' | 'FAILED',
      code: string,
      ref?: string,
      reason?: string,
    ) =>
      inventoryTransaction(this.prisma, async (tx) => {
        await lockOrder(tx, payment.orderId);
        const current = await tx.paymentRefund.findUniqueOrThrow({
          where: { id: refund.id },
        });
        if (
          current.status !== 'PROCESSING' ||
          current.updatedAt.getTime() !== refund.updatedAt.getTime()
        ) {
          return {
            message: 'Đang chờ hoàn tiền',
            refund: current,
            payment: await tx.payment.findUniqueOrThrow({
              where: { id: payment.id },
            }),
          };
        }
        const now = new Date();
        const updatedRefund = await tx.paymentRefund.update({
          where: { id: refund.id },
          data: {
            status,
            confirmedAt: status === 'SUCCESS' ? now : null,
            gatewayResponseCode: code,
            gatewayRefundNo: ref,
            failureReason: reason ?? null,
          },
        });
        let updatedPayment = await tx.payment.findUniqueOrThrow({
          where: { id: payment.id },
        });
        if (status === 'SUCCESS') {
          const order = await tx.order.findUniqueOrThrow({
            where: { id: payment.orderId },
          });
          await this.restoreHeldPoints(tx, updatedPayment, order, false);
          updatedPayment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              refundedAt: now,
              refundedAmount: payment.amount,
              refundRef: ref || `REFUND_${payment.id}`,
            },
          });
          // A late extra charge does not release stock for the successful tender.
          if (payment.status === 'SUCCESS')
            await this.inventory.finish(tx, payment.orderId, false);
        }
        return {
          message: status === 'SUCCESS' ? 'Đã hoàn tiền' : 'Đang chờ hoàn tiền',
          refund: updatedRefund,
          payment: updatedPayment,
        };
      });

    if (payment.method !== 'VNPAY') {
      const result = await this.mockPaymentService.refund(payment.amount);
      return finish('SUCCESS', '00', result.refundRef);
    }
    if (claim.action === 'reconcile') {
      let query: VnpayQueryResult | null = null;
      try {
        query = await this.vnpayGateway.queryTransaction({
          txnRef: payment.gatewayTxnRef!,
          transactionDate,
          ipAddr: clientIp,
        });
      } catch {
        /* Keep an ambiguous result pending; do not send another refund. */
      }
      const matched =
        query?.responseCode === '00' && query.amount === payment.amount;
      if (
        matched &&
        query &&
        query.transactionType === '02' &&
        query.transactionStatus === '00'
      ) {
        return finish('SUCCESS', '00', query.transactionNo);
      }
      // 05/06 means VNPAY/bank is processing the refund. Only an explicit
      // original successful payment or rejected refund allows another attempt.
      if (
        !matched ||
        !query ||
        !(
          (query.transactionType === '01' &&
            query.transactionStatus === '00') ||
          query.transactionStatus === '09'
        )
      ) {
        return finish(
          'PENDING',
          '99',
          undefined,
          'Refund outcome requires reconciliation',
        );
      }
    }
    try {
      const result = await this.vnpayGateway.refund({
        txnRef: payment.gatewayTxnRef!,
        amount: payment.amount,
        transactionDate,
        transactionNo: payment.providerRef || '0',
        createBy: `BARISTA_${adminId}`,
        ipAddr: clientIp,
        requestId: crypto
          .createHash('sha256')
          .update(refund.idempotencyKey)
          .digest('hex')
          .slice(0, 32),
      });
      if (result.success)
        return finish('SUCCESS', result.responseCode, result.refundNo);
      if (result.pending || result.responseCode === '99') {
        return finish(
          'PENDING',
          result.responseCode,
          undefined,
          result.failureReason,
        );
      }
      await finish(
        'FAILED',
        result.responseCode,
        undefined,
        result.failureReason,
      );
      throw new BadRequestException({
        code: 'REFUND_FAILED',
        message: result.failureReason,
      });
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      return finish(
        'PENDING',
        '99',
        undefined,
        'Refund outcome requires reconciliation',
      );
    }
  }

  /**
   * Đối soát một giao dịch VNPAY cụ thể khi hết hạn
   */
  async reconcileSinglePayment(paymentId: number) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (
      !payment ||
      payment.status !== 'PROCESSING' ||
      payment.method !== 'VNPAY'
    ) {
      return;
    }

    if (!payment.gatewayTxnRef) return;

    let querydrResult: VnpayQueryResult | null = null;
    try {
      querydrResult = await this.vnpayGateway.queryTransaction({
        txnRef: payment.gatewayTxnRef,
        transactionDate:
          payment.vnpCreateDate ||
          payment.createdAt
            .toISOString()
            .replace(/[-:T.Z]/g, '')
            .slice(0, 14),
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
      await this.prisma.$transaction(async (tx) => {
        await lockOrder(tx, payment.orderId);
        const current = await tx.payment.findUniqueOrThrow({
          where: { id: payment.id },
          include: { order: true },
        });
        if (current.status !== 'PROCESSING') return;
        await tx.payment.update({
          where: { id: current.id },
          data: {
            status: 'EXPIRED',
            failureReason: 'Giao dịch hết hạn thanh toán',
          },
        });
        await this.restoreHeldPoints(tx, current, current.order);
      });
    }
  }

  // Call only while holding the order lock. The ledger's unique payment/type
  // key also prevents a second refund if IPN, cancellation and retries race.
  private async restoreHeldPoints(
    tx: Prisma.TransactionClient,
    payment: Payment,
    order: Order,
    restoreOrderTotals = true,
  ) {
    if (payment.pointsUsed > 0) {
      const existingRefund = await tx.loyaltyTransaction.findFirst({
        where: { paymentId: payment.id, type: 'REFUND' },
      });
      if (!existingRefund) {
        await tx.user.update({
          where: { id: order.userId },
          data: { loyaltyPoints: { increment: payment.pointsUsed } },
        });

        const redeemTx = await tx.loyaltyTransaction.findFirst({
          where: { paymentId: payment.id, type: 'REDEEM' },
        });

        await tx.loyaltyTransaction.create({
          data: {
            userId: order.userId,
            orderId: order.id,
            paymentId: payment.id,
            relatedTransactionId: redeemTx?.id,
            points: payment.pointsUsed,
            pointsAmount: payment.pointsAmount,
            type: 'REFUND',
            eventKey: `payment:${payment.id}:refund`,
          },
        });

        if (restoreOrderTotals)
          await tx.order.update({
            where: { id: order.id },
            data: {
              discountAmount: order.discountAmount - payment.pointsAmount,
              total: order.total + payment.pointsAmount,
            },
          });
      }
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
        if (
          payment.status === 'PROCESSING' &&
          payment.expiresAt &&
          payment.expiresAt <= new Date()
        ) {
          await this.reconcileSinglePayment(payment.id);
          const refreshed = await this.findPayment(payment.idempotencyKey);
          if (refreshed?.status === 'EXPIRED') {
            throw new ConflictException({
              code: 'PAYMENT_EXPIRED',
              message:
                'Giao dịch đã hết hạn thanh toán. Vui lòng thanh toán lại với khóa mới',
            });
          }
          if (refreshed) payment = refreshed;
        }
        if (payment.status !== 'PROCESSING' || payment.paymentUrl) {
          return {
            isReplayed: true,
            statusCode: ['PROCESSING', 'SUCCESS'].includes(payment.status)
              ? HttpStatus.CREATED
              : HttpStatus.PAYMENT_REQUIRED,
            data: {
              payment: {
                id: payment.id,
                orderId: payment.orderId,
                amount: payment.amount,
                method: payment.method,
                status: payment.status,
                pointsUsed: payment.pointsUsed,
                pointsAmount: payment.pointsAmount,
                providerRef: payment.providerRef,
                failureReason: payment.failureReason,
                paymentUrl:
                  payment.status === 'PROCESSING' ? payment.paymentUrl : null,
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
