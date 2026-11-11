export const VND_PER_LOYALTY_POINT = 1000;
export const WELCOME_POINTS = 1000;
export const POINTS_STEP = 20;
export const VND_PER_STEP = 1000;
export const VNPAY_MIN_AMOUNT = 5000;

/** Maximum valid redemption, keeping any VNPAY remainder at least 5.000 VND. */
export function maxRedeemablePoints(balance: number, total: number): number {
  if (
    !Number.isFinite(balance) ||
    !Number.isFinite(total) ||
    balance <= 0 ||
    total <= 0
  )
    return 0;
  const available = Math.floor(balance / POINTS_STEP) * POINTS_STEP;
  const fullOrderPoints = (total / VND_PER_STEP) * POINTS_STEP;
  if (total % VND_PER_STEP === 0 && available >= fullOrderPoints)
    return fullOrderPoints;
  const partial =
    Math.floor(Math.max(0, total - VNPAY_MIN_AMOUNT) / VND_PER_STEP) *
    POINTS_STEP;
  return Math.min(available, partial);
}

/**
 * Tính số điểm tích lũy dựa trên số tiền thực trả của đơn hàng (Order.total).
 * Quy tắc: 1.000đ = 1 điểm, làm tròn xuống (floor), cộng khi đơn đã thanh toán (PAID).
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
