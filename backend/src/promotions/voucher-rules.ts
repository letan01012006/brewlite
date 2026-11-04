/**
 * Quy tắc đổi điểm và tích điểm thưởng của BrewLite:
 * - Dùng điểm: 20 điểm = 1.000đ (bội số của 20 điểm).
 * - Tích điểm: 1.000đ tiền mặt thực trả = 1 điểm (làm tròn xuống).
 * - Điểm tích lũy chỉ tính trên phần tiền thật thanh toán, không tính phần trả bằng điểm.
 */

export const POINTS_STEP = 20; // 20 điểm mỗi mốc
export const VND_PER_STEP = 1000; // 1.000đ mỗi mốc
export const EARN_RATE_VND = 1000; // 1.000đ tiền thật = 1 điểm

/**
 * Tính số điểm cần thiết để giảm một số tiền VND nhất định.
 * Làm tròn lên mốc 20 điểm gần nhất.
 */
export function pointsNeededFor(vndAmount: number): number {
  if (vndAmount <= 0) return 0;
  const steps = Math.ceil(vndAmount / VND_PER_STEP);
  return steps * POINTS_STEP;
}

/**
 * Chuyển đổi số điểm thành số tiền VND được giảm giá.
 * Chỉ tính theo bội số nguyên của 20 điểm.
 */
export function pointsToVnd(points: number): number {
  if (points <= 0) return 0;
  const usableSteps = Math.floor(points / POINTS_STEP);
  return usableSteps * VND_PER_STEP;
}

/**
 * Tính số điểm hợp lệ và số tiền giảm giá thực tế khi khách áp dụng điểm vào đơn.
 * Đảm bảo:
 * 1. Điểm dùng là bội số của 20.
 * 2. Số tiền giảm không vượt quá tổng tiền của đơn.
 */
export function calculatePointsDiscount(
  pointsToUse: number,
  maxPayableVnd: number,
): { validPoints: number; discountVnd: number } {
  if (pointsToUse <= 0 || maxPayableVnd <= 0) {
    return { validPoints: 0, discountVnd: 0 };
  }

  // Quy đổi thử số điểm ra tiền
  let discountVnd = pointsToVnd(pointsToUse);

  // Nếu số tiền giảm vượt quá số tiền cần thanh toán, giới hạn lại
  if (discountVnd > maxPayableVnd) {
    discountVnd = Math.floor(maxPayableVnd / VND_PER_STEP) * VND_PER_STEP;
  }

  // Tính ngược lại số điểm thực tế cần dùng
  const validPoints = (discountVnd / VND_PER_STEP) * POINTS_STEP;

  return { validPoints, discountVnd };
}

/**
 * Tính số điểm thưởng được cộng khi đơn chuyển sang COMPLETED.
 * Chỉ tính trên số tiền thật đã thanh toán (payment.amount), bỏ qua phần trả bằng điểm.
 */
export function pointsEarnedFor(realVndAmount: number): number {
  if (realVndAmount <= 0) return 0;
  return Math.floor(realVndAmount / EARN_RATE_VND);
}