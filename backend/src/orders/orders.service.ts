import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PricingService, type PricingItemInput } from '../common/pricing/pricing.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { QueryOrderDto } from './dto/query-order.dto.js';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: PricingService,
  ) {}

  /**
   * Tạo đơn hàng mới từ giỏ hàng (Task 6 & Task 10)
   * POST /api/orders
   * - Tính giá chính xác trên server qua PricingService
   * - Kiểm tra tồn kho & trừ kho (reserve stock)
   * - Kiểm tra và áp dụng mã khuyến mãi (nếu có)
   * - Toàn bộ chạy trong 1 Transaction an toàn
   */
  async create(userId: number, dto: CreateOrderDto) {
    const pricingInput: PricingItemInput[] = dto.items.map((i) => ({
      productId: i.productId,
      size: i.size,
      toppingIds: i.toppingIds,
      quantity: i.quantity,
      note: i.note,
    }));

    // Chạy toàn bộ luồng tạo đơn trong Transaction
    return this.prisma.$transaction(async (tx) => {
      // 1. Tính giá server-side (không tin giá client)
      const pricingResult = await this.pricingService.calculate(pricingInput, tx);
      const subtotal = pricingResult.subtotal;

      // 2. Tính tổng số lượng cần cho từng sản phẩm (gộp dòng cùng productId)
      const qtyByProduct = new Map<number, number>();
      for (const item of dto.items) {
        qtyByProduct.set(
          item.productId,
          (qtyByProduct.get(item.productId) ?? 0) + item.quantity,
        );
      }

      // Sắp xếp Product ID tăng dần để chống deadlock khi có nhiều request đồng thời
      const sortedProductIds = [...qtyByProduct.keys()].sort((a, b) => a - b);

      // 3. Kiểm tra tồn kho và trừ kho (Giữ hàng ngay khi tạo đơn - Task 10)
      for (const pId of sortedProductIds) {
        const neededQty = qtyByProduct.get(pId)!;
        const current = await tx.product.findUnique({
          where: { id: pId },
        });

        if (!current || !current.isActive) {
          throw new NotFoundException({
            code: 'PRODUCT_NOT_FOUND',
            message: `Không tìm thấy sản phẩm #${pId}`,
            details: [{ productId: pId }],
          });
        }

        if (current.stock < neededQty) {
          throw new ConflictException({
            code: 'OUT_OF_STOCK',
            message: `Sản phẩm '${current.name}' chỉ còn ${current.stock} phần`,
            details: [{ productId: pId, available: current.stock, requested: neededQty }],
          });
        }

        // Trừ tồn kho và tăng version cho optimistic locking
        await tx.product.update({
          where: { id: pId },
          data: {
            stock: { decrement: neededQty },
            version: { increment: 1 },
          },
        });
      }

      // 4. Xử lý khuyến mãi nếu có mã promoCode
      let discountAmount = 0;
      let appliedPromoCode: string | null = null;

      if (dto.promoCode?.trim()) {
        const code = dto.promoCode.trim().toUpperCase();
        const promo = await tx.promoCode.findUnique({
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
            message: `Đơn hàng tối thiểu phải từ ${promo.minOrderValue.toLocaleString('vi-VN')}đ để sử dụng mã này`,
          });
        }

        // Tính tiền giảm (PERCENT hoặc FIXED)
        if (promo.type === 'PERCENT') {
          const rawDiscount = Math.floor((subtotal * promo.value) / 100);
          discountAmount = promo.maxDiscount ? Math.min(rawDiscount, promo.maxDiscount) : rawDiscount;
        } else {
          discountAmount = Math.min(promo.value, subtotal);
        }

        appliedPromoCode = promo.code;

        // Tăng số lượt đã sử dụng của mã
        await tx.promoCode.update({
          where: { id: promo.id },
          data: {
            usedCount: { increment: 1 },
          },
        });
      }

      const total = Math.max(0, subtotal - discountAmount);

      // 5. Tạo đơn hàng Order ở trạng thái PENDING
      const order = await tx.order.create({
        data: {
          userId,
          status: 'PENDING',
          subtotal,
          discountAmount,
          total,
          promoCode: appliedPromoCode,
          pointsEarned: 0,
        },
      });

      // 6. Tạo các dòng OrderItem kèm snapshot tên, toppings, giá lúc đặt
      const createdItems = await Promise.all(
        pricingResult.lines.map((line) =>
          tx.orderItem.create({
            data: {
              orderId: order.id,
              productId: line.productId,
              productName: line.productName,
              size: line.size,
              toppings: line.toppings,
              unitPrice: line.unitPrice,
              qty: line.qty,
              lineTotal: line.lineTotal,
              note: line.note,
            },
          }),
        ),
      );

      return {
        id: order.id,
        code: `#${order.id}`,
        status: order.status,
        items: createdItems,
        subtotal: order.subtotal,
        discountAmount: order.discountAmount,
        total: order.total,
        promoCode: order.promoCode,
        createdAt: order.createdAt,
      };
    });
  }

  /**
   * Lấy lịch sử đơn hàng của người dùng hiện tại (Task 9)
   * GET /api/orders/me
   */
  async findMyOrders(userId: number, query: QueryOrderDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const where = {
      userId,
      ...(query.status ? { status: query.status } : {}),
    };

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          items: {
            select: { id: true, qty: true },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    const data = orders.map((o) => ({
      id: o.id,
      code: `#${o.id}`,
      status: o.status,
      total: o.total,
      itemCount: o.items.reduce((sum, i) => sum + i.qty, 0),
      createdAt: o.createdAt,
    }));

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  /**
   * Lấy chi tiết một đơn hàng (Task 9)
   * GET /api/orders/:id
   * Chỉ chủ đơn hoặc BARISTA mới có quyền xem đơn này
   */
  async findOne(orderId: number, userId: number, role: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        payments: {
          select: {
            id: true,
            method: true,
            status: true,
            amount: true,
            providerRef: true,
            createdAt: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: `Không tìm thấy đơn hàng #${orderId}`,
      });
    }

    // Kiểm tra quyền riêng tư (chỉ chủ đơn hoặc Barista)
    if (order.userId !== userId && role !== 'BARISTA') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Bạn không có quyền xem thông tin đơn hàng của người khác',
      });
    }

    return {
      id: order.id,
      code: `#${order.id}`,
      status: order.status,
      items: order.items,
      subtotal: order.subtotal,
      discountAmount: order.discountAmount,
      total: order.total,
      promoCode: order.promoCode,
      pointsEarned: order.pointsEarned,
      payments: order.payments,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}
