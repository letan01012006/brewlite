import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  MAX_TOPPINGS_PER_ITEM,
  SIZE_SURCHARGE,
  VND_PER_LOYALTY_POINT,
  type SizeKey,
} from './pricing.constants.js';

/** Một dòng trong giỏ hàng do client gửi lên. Client KHÔNG gửi giá. */
export interface PricingItemInput {
  productId: number;
  size: SizeKey;
  toppingIds?: number[];
  quantity: number;
  note?: string;
}

/** Một dòng đã được server tính giá, sẵn sàng lưu thành OrderItem. */
export interface PricedLine {
  productId: number;
  productName: string;
  size: SizeKey;
  toppings: { id: number; name: string; price: number }[];
  unitPrice: number;
  qty: number;
  lineTotal: number;
  note: string | null;
}

export interface PricingResult {
  lines: PricedLine[];
  subtotal: number;
}

/** Cho phép truyền cả PrismaService lẫn `tx` trong prisma.$transaction. */
type Db = Pick<PrismaClient, 'product'>;

/**
 * Nguồn duy nhất để tính giá (mục 4.1 tài liệu API).
 *   unitPrice = product.price + phụ thu size + tổng giá topping
 *   lineTotal = unitPrice * quantity
 *   subtotal  = tổng lineTotal
 * Dùng chung cho POST /orders và POST /promotions/validate.
 */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async calculate(
    items: PricingItemInput[],
    db: Db = this.prisma,
  ): Promise<PricingResult> {
    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await db.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      include: { toppings: { where: { isActive: true } } },
    });

    const productMap = new Map(products.map((p) => [p.id, p]));

    const lines: PricedLine[] = items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new NotFoundException({
          code: 'PRODUCT_NOT_FOUND',
          message: `Không tìm thấy sản phẩm #${item.productId}`,
          details: [{ productId: item.productId }],
        });
      }

      const ids = item.toppingIds ?? [];
      if (
        new Set(ids).size !== ids.length ||
        ids.some((id) => !Number.isInteger(id) || id < 1 || id > 2147483647)
      ) {
        throw new BadRequestException({
          code: 'INVALID_TOPPING_IDS',
          message: 'ID topping phải là số nguyên dương và không trùng',
        });
      }
      if (ids.length > MAX_TOPPINGS_PER_ITEM) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `Mỗi ly chỉ được chọn tối đa ${MAX_TOPPINGS_PER_ITEM} topping`,
        });
      }

      const chosen = ids.map((id) => {
        const t = product.toppings.find((topping) => topping.id === id);
        if (!t) {
          throw new BadRequestException({
            code: 'TOPPING_NOT_ALLOWED',
            message: `Topping #${id} không được phép dùng cho món này hoặc đã ngừng bán`,
            details: [{ productId: item.productId, toppingId: id }],
          });
        }
        return { id: t.id, name: t.name, price: t.price };
      });

      const toppingTotal = chosen.reduce((sum, t) => sum + t.price, 0);
      const unitPrice =
        product.price + SIZE_SURCHARGE[item.size] + toppingTotal;

      return {
        productId: product.id,
        productName: product.name,
        size: item.size,
        toppings: chosen,
        unitPrice,
        qty: item.quantity,
        lineTotal: unitPrice * item.quantity,
        note: item.note?.trim() || null,
      };
    });

    const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    return { lines, subtotal };
  }

  /** Điểm thưởng cho một đơn: 1 điểm / 1.000đ của total, làm tròn xuống. */
  pointsFor(total: number): number {
    return Math.floor(total / VND_PER_LOYALTY_POINT);
  }
}
