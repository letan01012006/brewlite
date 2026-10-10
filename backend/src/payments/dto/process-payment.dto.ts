import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export const PAYMENT_METHODS = ['WALLET', 'CARD'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export class ProcessPaymentDto {
  @ApiProperty({ description: 'ID của đơn hàng cần thanh toán', example: 1 })
  @IsInt({ message: 'Mã đơn hàng (orderId) phải là số nguyên' })
  @Min(1, { message: 'Mã đơn hàng không hợp lệ' })
  orderId: number;

  @ApiProperty({
    description: 'Phương thức thanh toán không tiền mặt',
    enum: PAYMENT_METHODS,
    example: 'WALLET',
  })
  @IsIn(PAYMENT_METHODS, {
    message: 'Phương thức thanh toán chỉ chấp nhận: WALLET (Ví điện tử) hoặc CARD (Thẻ ngân hàng)',
  })
  method: PaymentMethod;

  @ApiPropertyOptional({
    description: 'Idempotency-Key (nếu không truyền qua Header Idempotency-Key)',
    example: 'c2e584f2-9844-484d-b94d-4be9df14d9b6',
  })
  @IsString({ message: 'Idempotency-Key phải là một chuỗi' })
  @IsOptional()
  idempotencyKey?: string;

  @ApiPropertyOptional({
    description: 'Mô phỏng kết quả thanh toán cho việc demo/test (SUCCESS hoặc FAILED)',
    enum: ['SUCCESS', 'FAILED'],
    example: 'SUCCESS',
  })
  @IsIn(['SUCCESS', 'FAILED'], {
    message: 'mockResult chỉ nhận SUCCESS hoặc FAILED',
  })
  @IsOptional()
  mockResult?: 'SUCCESS' | 'FAILED';
}
