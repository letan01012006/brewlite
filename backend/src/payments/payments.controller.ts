import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
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
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { getClientIp } from './client-ip.js';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Thanh toán đơn hàng (VNPAY hoặc WALLET/CARD khi mock)
   * POST /api/payments
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Thanh toán đơn hàng qua VNPAY hoặc phương thức thử nghiệm',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Khóa chống trùng lặp giao dịch (UUID v4 do frontend sinh)',
  })
  @ApiResponse({
    status: 201,
    description: 'Tạo link thanh toán VNPAY hoặc thanh toán mock thành công',
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

    res.status(result.statusCode);
    if (result.isReplayed) {
      res.setHeader('Idempotent-Replayed', 'true');
    }

    return result.data;
  }

  /**
   * IPN Webhook từ cổng VNPAY (Không dùng JWT Guard)
   * GET /api/payments/vnpay/ipn
   */
  @Get('vnpay/ipn')
  @ApiOperation({
    summary: 'Webhook IPN tiếp nhận thông báo kết quả từ cổng VNPAY',
  })
  async handleVnpayIpn(@Query() query: Record<string, unknown>) {
    return this.paymentsService.processIpn(query);
  }

  /**
   * Return URL đón khách hàng quay về từ VNPAY (Cần JWT)
   * GET /api/payments/vnpay/return
   */
  @Get('vnpay/return')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xác nhận và kiểm tra kết quả giao dịch sau khi khách quay lại từ VNPAY',
  })
  async handleVnpayReturn(
    @CurrentUser('id') userId: number,
    @Query() query: Record<string, unknown>,
  ) {
    return this.paymentsService.processReturn(userId, query);
  }

  /**
   * Hoàn tiền cho giao dịch (Chỉ dành cho BARISTA)
   * POST /api/payments/:id/refund
   */
  @Post(':id/refund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BARISTA')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Yêu cầu hoàn tiền cho giao dịch đã thanh toán hoặc lỗi kho',
  })
  async refundPayment(
    @Param('id', ParseIntPipe) paymentId: number,
    @CurrentUser('id') adminId: number,
    @CurrentUser('role') adminRole: string,
    @Req() req: Request,
  ) {
    const clientIp = getClientIp(req);
    return this.paymentsService.refundPayment(
      paymentId,
      adminId,
      adminRole,
      clientIp,
    );
  }

  /**
   * Lấy chi tiết thông tin thanh toán
   * GET /api/payments/:id
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xem chi tiết giao dịch thanh toán',
  })
  async getPayment(
    @Param('id', ParseIntPipe) paymentId: number,
    @CurrentUser('id') userId: number,
    @CurrentUser('role') userRole: string,
  ) {
    return this.paymentsService.getPayment(paymentId, userId, userRole);
  }
}
