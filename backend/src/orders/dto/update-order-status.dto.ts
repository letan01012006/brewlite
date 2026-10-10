import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty } from 'class-validator';

export const ORDER_STATUSES = [
  'PENDING',
  'PAID',
  'PREPARING',
  'READY',
  'COMPLETED',
  'CANCELLED',
  'PAYMENT_FAILED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const BARISTA_ALLOWED_STATUSES = ['PREPARING', 'READY', 'COMPLETED'] as const;
export type BaristaAllowedStatus = (typeof BARISTA_ALLOWED_STATUSES)[number];

export class UpdateOrderStatusDto {
  @ApiProperty({
    description: 'Trạng thái mới của đơn hàng (Barista chỉ được chuyển PREPARING, READY, COMPLETED)',
    enum: BARISTA_ALLOWED_STATUSES,
    example: 'PREPARING',
  })
  @IsNotEmpty({ message: 'Trạng thái đơn hàng không được để trống' })
  @IsIn(BARISTA_ALLOWED_STATUSES, {
    message: `Trạng thái không hợp lệ. Barista chỉ được đổi sang: ${BARISTA_ALLOWED_STATUSES.join(', ')}`,
  })
  status: BaristaAllowedStatus;
}
