// Mọi con số về giá nằm ở đây để đổi một chỗ là xong.
// LƯU Ý: phụ thu size là GIẢ ĐỊNH của nhóm (đề không nêu số), cần chốt với giảng viên.

export type SizeKey = 'S' | 'M' | 'L';

/** Phụ thu theo size, đơn vị VND. Giá gốc của sản phẩm là giá size S. */
export const SIZE_SURCHARGE: Record<SizeKey, number> = {
  S: 0,
  M: 5000,
  L: 10000,
};

/** Số topping tối đa cho mỗi ly. */
export const MAX_TOPPINGS_PER_ITEM = 3;

/** Cứ mỗi 1.000đ của total được 1 điểm thưởng (làm tròn xuống). */
export const VND_PER_LOYALTY_POINT = 1000;
