import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PaymentsService } from './payments.service.js';
import { ProcessPaymentDto } from './dto/process-payment.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Thanh toán không tiền mặt cho đơn hàng (Task 8 & Task 10)
   * POST /api/payments
   * Hỗ trợ Idempotency-Key và chống giao dịch trùng
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Thanh toán không tiền mặt qua Ví điện tử (WALLET) hoặc Thẻ (CARD)',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Khóa chống trùng lặp giao dịch (UUID v4 do frontend sinh)',
  })
  @ApiResponse({ status: 201, description: 'Thanh toán thành công, đơn hàng chuyển sang PAID' })
  @ApiResponse({ status: 400, description: 'Thiếu Idempotency-Key hoặc dữ liệu không hợp lệ' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 402, description: 'Thanh toán thất bại (PAYMENT_FAILED)' })
  @ApiResponse({ status: 403, description: 'Không có quyền thanh toán đơn hàng này' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy đơn hàng' })
  @ApiResponse({ status: 409, description: 'Đơn hàng đã thanh toán hoặc đang có giao dịch xử lý' })
  @ApiResponse({ status: 422, description: 'Idempotency-Key tái sử dụng với nội dung khác' })
  async processPayment(
    @CurrentUser('id') userId: number,
    @Body() processPaymentDto: ProcessPaymentDto,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.paymentsService.processPayment(
      userId,
      processPaymentDto,
      idempotencyKeyHeader,
    );

    // Nếu đây là kết quả Replay từ lần thanh toán thành công trước đó
    if (result.isReplayed) {
      res.setHeader('Idempotent-Replayed', 'true');
      return result.data;
    }

    return result.data;
  }
}
