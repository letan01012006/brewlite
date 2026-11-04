import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PaymentsService } from './payments.service.js';
import { ProcessPaymentDto } from './dto/process-payment.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { getClientIp } from './client-ip.js';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Thanh toán không tiền mặt cho đơn hàng (Task 8 & Task 10 + VNPAY & POINTS)
   * POST /api/payments
   * Hỗ trợ Idempotency-Key và chống giao dịch trùng
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Thanh toán không tiền mặt qua WALLET, CARD, VNPAY hoặc POINTS',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Khóa chống trùng lặp giao dịch (UUID v4 do frontend sinh)',
  })
  @ApiResponse({
    status: 201,
    description: 'Thanh toán thành công hoặc khởi tạo URL VNPAY thành công',
  })
  @ApiResponse({
    status: 400,
    description: 'Thiếu Idempotency-Key hoặc dữ liệu không hợp lệ',
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({
    status: 402,
    description: 'Thanh toán thất bại (PAYMENT_FAILED)',
  })
  @ApiResponse({
    status: 403,
    description: 'Không có quyền thanh toán đơn hàng này',
  })
  @ApiResponse({ status: 404, description: 'Không tìm thấy đơn hàng' })
  @ApiResponse({
    status: 409,
    description: 'Đơn hàng đã thanh toán hoặc đang có giao dịch xử lý',
  })
  @ApiResponse({
    status: 422,
    description: 'Idempotency-Key tái sử dụng với nội dung khác',
  })
  async processPayment(
    @CurrentUser('id') userId: number,
    @Body() processPaymentDto: ProcessPaymentDto,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    const clientIp = getClientIp(req);
    const result = await this.paymentsService.processPayment(
      userId,
      processPaymentDto,
      idempotencyKeyHeader,
      req.originalUrl ?? req.url,
      clientIp,
    );

    // Return the persisted body for both success and failure, including replay.
    res.status(result.statusCode);
    if (result.isReplayed) {
      res.setHeader('Idempotent-Replayed', 'true');
    }

    return result.data;
  }

  /**
   * Webhook IPN nhận kết quả thanh toán từ VNPAY Sandbox
   * GET /api/payments/vnpay/ipn
   */
  @Get('vnpay/ipn')
  @ApiOperation({ summary: 'VNPAY IPN Webhook xác nhận kết quả giao dịch' })
  async handleVnpayIpn(@Query() query: Record<string, string>) {
    return this.paymentsService.handleVnpayIpn(query);
  }

  /**
   * Endpoint kiểm tra kết quả khi VNPAY redirect khách về Return URL
   * GET /api/payments/vnpay/return
   */
  @Get('vnpay/return')
  @ApiOperation({ summary: 'Xác thực chữ ký và đọc trạng thái đơn hàng từ VNPAY Return' })
  async handleVnpayReturn(@Query() query: Record<string, string>) {
    return this.paymentsService.verifyVnpayReturn(query);
  }
}