import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { MockPaymentService } from './mock-payment.service.js';
import { ProcessPaymentDto } from './dto/process-payment.dto.js';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mockPaymentService: MockPaymentService,
  ) {}

  /**
   * Xử lý thanh toán không tiền mặt bảo mật cao (Task 8 & Task 10)
   * POST /api/payments
   * - Hỗ trợ Idempotency-Key chống thanh toán trùng
   * - Kiểm tra Request Hash SHA-256
   * - Khóa đơn hàng trong Transaction
   * - Chuyển trạng thái Order sang PAID và cộng điểm tích lũy
   */
  async processPayment(
    userId: number,
    dto: ProcessPaymentDto,
    keyFromHeader?: string,
  ) {
    // Ưu tiên key từ body nếu được truyền trực tiếp, sau đó mới đến header
    const idempotencyKey = dto.idempotencyKey?.trim() || keyFromHeader?.trim();

    // 1. Kiểm tra Idempotency-Key
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Thiếu Idempotency-Key. Vui lòng truyền qua Header hoặc Body để đảm bảo an toàn giao dịch',
      });
    }

    // 2. Tính Request Hash (SHA-256) từ các trường cố định
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

    // 3. Tra cứu lịch sử thanh toán theo Idempotency-Key
    const existingPayment = await this.prisma.payment.findUnique({
      where: { idempotencyKey },
    });

    if (existingPayment) {
      // Nếu key đã dùng nhưng hash khác hoặc thuộc về đơn khác -> Chặn gian lận
      if (
        existingPayment.orderId !== dto.orderId ||
        existingPayment.requestHash !== requestHash
      ) {
        throw new UnprocessableEntityException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'Idempotency-Key này đã được sử dụng cho một giao dịch khác',
        });
      }

      // Nếu đang trong quá trình xử lý song song
      if (existingPayment.status === 'PROCESSING') {
        throw new ConflictException({
          code: 'PAYMENT_IN_PROGRESS',
          message: 'Giao dịch với Idempotency-Key này đang được xử lý, vui lòng không gửi lặp lại',
        });
      }

      // Nếu đã từng thanh toán trước đó (SUCCESS hoặc FAILED) -> REPLAY kết quả cũ (Không trừ tiền lại!)
      if (existingPayment.status === 'SUCCESS') {
        return {
          isReplayed: true,
          data: existingPayment.responseSnapshot,
        };
      }

      if (existingPayment.status === 'FAILED') {
        const errorBody =
          (existingPayment.responseSnapshot as Record<string, any>) ?? {
            statusCode: 402,
            code: 'PAYMENT_FAILED',
            message: existingPayment.failureReason ?? 'Thanh toán thất bại',
          };
        throw new HttpException(errorBody, HttpStatus.PAYMENT_REQUIRED);
      }
    }


    // 4. Bước chiếm key và khóa đơn hàng (Transaction 1)
    const { order, payment } = await this.prisma.$transaction(async (tx) => {
      const ord = await tx.order.findUnique({
        where: { id: dto.orderId },
      });

      if (!ord) {
        throw new NotFoundException({
          code: 'ORDER_NOT_FOUND',
          message: `Không tìm thấy đơn hàng #${dto.orderId}`,
        });
      }

      if (ord.userId !== userId) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Bạn không có quyền thanh toán cho đơn hàng của người khác',
        });
      }

      if (ord.status !== 'PENDING' && ord.status !== 'PAYMENT_FAILED') {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: `Không thể thanh toán đơn hàng đang ở trạng thái ${ord.status}`,
        });
      }

      // Kiểm tra xem đơn này có giao dịch PROCESSING nào khác đang chạy không
      const inProgress = await tx.payment.findFirst({
        where: { orderId: ord.id, status: 'PROCESSING' },
      });

      if (inProgress) {
        throw new ConflictException({
          code: 'PAYMENT_IN_PROGRESS',
          message: 'Đơn hàng đang có một giao dịch thanh toán khác đang xử lý',
        });
      }

      // Ghi nhận Payment ở trạng thái PROCESSING
      const p = await tx.payment.create({
        data: {
          orderId: ord.id,
          idempotencyKey,
          requestHash,
          amount: ord.total,
          method: dto.method,
          status: 'PROCESSING',
        },
      });

      return { order: ord, payment: p };
    });

    // 5. Gọi Mock Payment Gateway (Momo/VNPay/Stripe ảo)
    const chargeResult = await this.mockPaymentService.charge({
      amount: order.total,
      method: dto.method,
      mockResult: dto.mockResult,
    });

    // 6. Cập nhật kết quả cuối cùng (Transaction 2)
    if (chargeResult.success) {
      // Tính điểm thưởng: 1 điểm cho mỗi 1.000đ của total
      const points = Math.floor(order.total / 1000);

      const successResponse = {
        payment: {
          id: payment.id,
          orderId: order.id,
          amount: order.total,
          method: dto.method,
          status: 'SUCCESS',
          providerRef: chargeResult.providerRef,
        },
        order: {
          id: order.id,
          code: `#${order.id}`,
          status: 'PAID',
          total: order.total,
          pointsEarned: points,
        },
      };

      await this.prisma.$transaction(async (tx) => {
        // Cập nhật Payment
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'SUCCESS',
            providerRef: chargeResult.providerRef,
            responseSnapshot: successResponse,
          },
        });

        // Cập nhật Order sang PAID
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'PAID',
            pointsEarned: points,
          },
        });

        // Cộng điểm loyaltyPoints và ghi nhận giao dịch
        if (points > 0) {
          await tx.user.update({
            where: { id: userId },
            data: {
              loyaltyPoints: { increment: points },
            },
          });

          await tx.loyaltyTransaction.create({
            data: {
              userId,
              orderId: order.id,
              points,
            },
          });
        }
      });

      return {
        isReplayed: false,
        data: successResponse,
      };
    } else {
      // Thanh toán thất bại (Code 402)
      const failedResponse = {
        statusCode: 402,
        code: 'PAYMENT_FAILED',
        message: chargeResult.failureReason ?? 'Cổng thanh toán từ chối giao dịch',
        order: {
          id: order.id,
          code: `#${order.id}`,
          status: 'PAYMENT_FAILED',
        },
      };

      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            failureReason: chargeResult.failureReason,
            responseSnapshot: failedResponse,
          },
        });

        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'PAYMENT_FAILED',
          },
        });
      });

      throw new HttpException(failedResponse, HttpStatus.PAYMENT_REQUIRED);
    }
  }
}
