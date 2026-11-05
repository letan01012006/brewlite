export const WELCOME_POINTS = 500;
export const VND_PER_LOYALTY_POINT = 1000;

/**
 * Tính số điểm thưởng tích lũy theo số tiền thực trả của đơn hàng.
 * Tỷ lệ: 1.000đ = 1 điểm, làm tròn xuống (floor).
 * Số tiền <= 0 không được tích điểm.
 */
export function pointsEarnedFor(total: number): number {
  if (!Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.floor(total / VND_PER_LOYALTY_POINT);
}


