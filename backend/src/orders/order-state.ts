import { ConflictException } from '@nestjs/common';
import { type OrderStatus } from './dto/update-order-status.dto.js';

/**
 * Ma trận chuyển đổi trạng thái đơn hàng chuẩn xác theo Mục 5 của tài liệu thiết kế:
 * PENDING -> PAID, PAYMENT_FAILED, CANCELLED
 * PAYMENT_FAILED -> PAID, CANCELLED
 * PAID -> PREPARING, CANCELLED
 * PREPARING -> READY
 * READY -> COMPLETED
 * COMPLETED & CANCELLED là trạng thái kết thúc, không thể đổi sang bất kỳ trạng thái nào khác.
 */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['PAID', 'PAYMENT_FAILED', 'CANCELLED'],
  PAYMENT_FAILED: ['PAID', 'CANCELLED'],
  PAID: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY'],
  READY: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * Hàm kiểm tra hợp lệ khi chuyển đổi trạng thái
 * Ném ra lỗi 409 INVALID_TRANSITION nếu vi phạm
 */
export function assertTransition(from: OrderStatus, to: OrderStatus) {
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new ConflictException({
      code: 'INVALID_TRANSITION',
      message: `Không thể chuyển trạng thái đơn hàng từ ${from} sang ${to}`,
    });
  }
}
