import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PricingService, type PricingItemInput } from '../common/pricing/pricing.service.js';
import { ValidatePromotionDto } from './dto/apply-promotion.dto.js';

@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: PricingService,
  ) {}

  /**
   * Kiểm tra và tính trước số tiền giảm của mã khuyến mãi (Task 10 - Mục 6.7)
   * POST /api/promotions/validate
   * - Tự động tính subtotal qua PricingService (không nhận subtotal từ client)
   * - Không ghi dữ liệu, không đổi tồn kho, không tăng usedCount
   */
  async validatePromotion(dto: ValidatePromotionDto) {
    // 1. Tính tổng tiền hàng (subtotal) chuẩn xác từ phía server
    const pricingInput: PricingItemInput[] = dto.items.map((i) => ({
      productId: i.productId,
      size: i.size,
      toppingIds: i.toppingIds,
      quantity: i.quantity,
      note: i.note,
    }));

    const pricingResult = await this.pricingService.calculate(pricingInput);
    const subtotal = pricingResult.subtotal;

    // 2. Tìm kiếm mã khuyến mãi
    const code = dto.code.trim().toUpperCase();
    const promo = await this.prisma.promoCode.findUnique({
      where: { code },
    });

    const now = new Date();

    if (!promo || !promo.isActive) {
      throw new UnprocessableEntityException({
        code: 'PROMO_NOT_FOUND',
        message: `Mã khuyến mãi '${code}' không tồn tại hoặc đã ngừng hoạt động`,
      });
    }

    if (now < promo.startsAt) {
      throw new UnprocessableEntityException({
        code: 'PROMO_NOT_STARTED',
        message: 'Mã khuyến mãi chưa đến thời gian áp dụng',
      });
    }

    if (now > promo.expiresAt) {
      throw new UnprocessableEntityException({
        code: 'PROMO_EXPIRED',
        message: 'Mã khuyến mãi đã hết hạn sử dụng',
      });
    }

    if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit) {
      throw new UnprocessableEntityException({
        code: 'PROMO_USAGE_EXCEEDED',
        message: 'Mã khuyến mãi đã hết lượt sử dụng',
      });
    }

    if (subtotal < promo.minOrderValue) {
      throw new UnprocessableEntityException({
        code: 'PROMO_MIN_ORDER_NOT_MET',
        message: `Đơn hàng tối thiểu phải từ ${promo.minOrderValue.toLocaleString('vi-VN')}đ để áp dụng mã này`,
        details: [{ minOrderValue: promo.minOrderValue, currentSubtotal: subtotal }],
      });
    }

    // 3. Tính số tiền được giảm
    let discountAmount = 0;
    if (promo.type === 'PERCENT') {
      const rawDiscount = Math.floor((subtotal * promo.value) / 100);
      discountAmount = promo.maxDiscount ? Math.min(rawDiscount, promo.maxDiscount) : rawDiscount;
    } else {
      discountAmount = Math.min(promo.value, subtotal);
    }

    const totalAfterDiscount = Math.max(0, subtotal - discountAmount);

    return {
      code: promo.code,
      type: promo.type,
      value: promo.value,
      subtotal,
      discountAmount,
      totalAfterDiscount,
    };
  }
}
