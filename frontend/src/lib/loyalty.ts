export const VND_PER_LOYALTY_POINT = 1000;
export const WELCOME_POINTS = 500;
export const POINTS_STEP = 20;
export const VND_PER_STEP = 1000;

/**
 * Tính số điểm tích lũy dựa trên số tiền thực trả của đơn hàng (Order.total).
 * Quy tắc: 1.000đ = 1 điểm, làm tròn xuống (floor), chỉ cộng khi đơn hoàn thành (COMPLETED).
 */
export function pointsEarnedFor(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.floor(total / VND_PER_LOYALTY_POINT);
}

/**
 * Quy đổi điểm thưởng ra tiền giảm giá (VND).
 * Quy tắc: 20 điểm = 1.000đ (bội số của 20).
 */
export function pointsToDiscountVnd(points: number): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  return Math.floor(points / POINTS_STEP) * VND_PER_STEP;
}


