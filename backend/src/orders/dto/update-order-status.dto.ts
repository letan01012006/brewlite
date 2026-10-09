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

export class UpdateOrderStatusDto {
  @IsNotEmpty({ message: 'Trạng thái đơn hàng không được để trống' })
  @IsIn(ORDER_STATUSES, {
    message: `Trạng thái không hợp lệ. Phải là một trong các giá trị: ${ORDER_STATUSES.join(', ')}`,
  })
  status: OrderStatus;
}
