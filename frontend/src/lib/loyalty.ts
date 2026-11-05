export const VND_PER_LOYALTY_POINT = 1000;
export const WELCOME_POINTS = 500;

/**
 * Tính số điểm tích lũy dựa trên số tiền thực trả của đơn hàng (Order.total).
 * Quy tắc: 1.000đ = 1 điểm, làm tròn xuống (floor), chỉ cộng khi đơn hoàn thành (COMPLETED).
 */
export function pointsEarnedFor(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.floor(total / VND_PER_LOYALTY_POINT);
}

