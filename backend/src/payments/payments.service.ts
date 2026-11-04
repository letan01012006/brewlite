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
import { ProcessPaymentDto } from './dto/process-payment.dto.js';
import {
  Prisma,
  type Order,
  type Payment,
} from '../generated/prisma/client.js';
import { lockOrder } from '../orders/order-lock.js';
import { VND_PER_LOYALTY_POINT } from '../common/pricing/pricing.constants.js';

type OwnedPayment = Prisma.PaymentGetPayload<{
  include: { order: { select: { userId: true } } };
}>;
type PaymentClaim =
  | { kind: 'claimed'; order: Order; payment: Payment }
  | { kind: 'existing'; payment: OwnedPayment };

const REPLAY_WAIT_MS = 3000;
const REPLAY_POLL_MS = 200;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mockPaymentService: MockPaymentService,
  ) {}

  async processPayment(
    userId: number,
    dto: ProcessPaymentDto,
    keyFromHeader?: string,
    requestPath = '/api/payments',
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

    // Only the request that committed the PROCESSING row may call the gateway.
    const { order, payment } = claim;
    let chargeResult: ChargeResult;
    try {
      chargeResult = await this.mockPaymentService.charge({
        amount: order.total,
        method: dto.method,
        mockResult: dto.mockResult,
      });
    } catch {
      // The mock gateway has no external money movement. Persist a failure so
      // retries replay it and the customer can retry with a new key or cancel.
      chargeResult = {
        success: false,
        failureReason: 'Cổng thanh toán không phản hồi, vui lòng thử lại',
      };
    }

    const points = Math.floor(order.total / VND_PER_LOYALTY_POINT);
    const statusCode = chargeResult.success
      ? HttpStatus.CREATED
      : HttpStatus.PAYMENT_REQUIRED;
    const response: Prisma.JsonObject = chargeResult.success
      ? {
          payment: {
            id: payment.id,
            orderId: order.id,
            amount: order.total,
            method: dto.method,
            status: 'SUCCESS',
            providerRef: chargeResult.providerRef ?? null,
          },
          order: {
            id: order.id,
            code: `#${order.id}`,
            status: 'PAID',
            total: order.total,
            pointsEarned: points,
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
          ...(chargeResult.success ? { pointsEarned: points } : {}),
        },
      });
      if (chargeResult.success && points > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { loyaltyPoints: { increment: points } },
        });
        await tx.loyaltyTransaction.create({
          data: { userId, orderId: order.id, points },
        });
      }
    });
    return { isReplayed: false, statusCode, data: response };
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
