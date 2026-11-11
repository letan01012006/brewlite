import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import crypto from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  type Order,
  type OrderItem,
} from '../generated/prisma/client.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { inventoryTransaction } from '../inventory/transaction.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PricingService,
  type PricingItemInput,
} from '../common/pricing/pricing.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { QueryOrderDto } from './dto/query-order.dto.js';
import { assertTransition } from './order-state.js';
import { lockOrder } from './order-lock.js';
import { releaseOrderVoucher } from './order-voucher.js';
import {
  type BaristaAllowedStatus,
  type OrderStatus,
} from './dto/update-order-status.dto.js';
import { awardOrderPoints, revokeOrderPoints } from './order-loyalty.js';
import { PaymentsService } from '../payments/payments.service.js';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: PricingService,
    private readonly inventory: InventoryService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Tạo đơn hàng mới từ giỏ hàng (Task 6 & Task 10)
   * POST /api/orders
   * - Tính giá chính xác trên server qua PricingService
   * - Kiểm tra nguyên liệu và lưu snapshot; đơn 0đ giữ kho và sang PAID ngay
   * - Kiểm tra và áp dụng mã khuyến mãi (nếu có)
   * - Toàn bộ chạy trong 1 Transaction an toàn
   */
  async create(userId: number, dto: CreateOrderDto, idempotencyKey?: string) {
    const key = idempotencyKey?.trim();
    if (idempotencyKey !== undefined && (!key || key.length > 128)) {
      throw new BadRequestException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key phải có từ 1 đến 128 ký tự',
      });
    }
    const identity = key
      ? {
          key,
          requestHash: crypto
            .createHash('sha256')
            .update(
              JSON.stringify({
                items: dto.items.map((item) => ({
                  productId: item.productId,
                  size: item.size,
                  quantity: item.quantity,
                  toppingIds: item.toppingIds ?? [],
                  note: item.note ?? null,
                })),
                promoCode: dto.promoCode?.trim().toUpperCase() || null,
              }),
            )
            .digest('hex'),
        }
      : undefined;
    if (identity) {
      const existing = await this.findCreation(userId, identity.key);
      if (existing) return this.replayCreation(existing, identity.requestHash);
    }
    try {
      return await this.createAttempt(userId, dto, identity);
    } catch (error) {
      // The unique insert waits for the competing transaction. Its voucher
      // and order writes are committed together before this read can replay it.
      if (
        identity &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.findCreation(userId, identity.key);
        if (existing)
          return this.replayCreation(existing, identity.requestHash);
      }
      throw error;
    }
  }

  private findCreation(userId: number, creationKey: string) {
    return this.prisma.order.findUnique({
      where: { userId_creationKey: { userId, creationKey } },
      include: { items: { orderBy: { id: 'asc' } } },
    });
  }

  private replayCreation(
    order: Order & { items: OrderItem[] },
    requestHash: string,
  ) {
    if (order.creationRequestHash !== requestHash)
      throw new ConflictException({
        code: 'ORDER_IDEMPOTENCY_KEY_REUSED',
        message: 'Idempotency-Key đã được dùng với nội dung đơn hàng khác',
      });
    return this.creationResponse(order, order.items);
  }

  private creationResponse(order: Order, items: OrderItem[]) {
    return {
      id: order.id,
      code: `#${order.id}`,
      status: order.status,
      items,
      subtotal: order.subtotal,
      discountAmount: order.discountAmount,
      total: order.total,
      promoCode: order.promoCode,
      pointsEarned: order.pointsEarned,
      createdAt: order.createdAt,
    };
  }

  private async createAttempt(
    userId: number,
    dto: CreateOrderDto,
    identity?: { key: string; requestHash: string },
  ) {
    const pricingInput: PricingItemInput[] = dto.items.map((i) => ({
      productId: i.productId,
      size: i.size,
      toppingIds: i.toppingIds,
      quantity: i.quantity,
      note: i.note,
    }));

    // Chạy toàn bộ luồng tạo đơn trong Transaction
    return inventoryTransaction(
      this.prisma,
      async (tx) => {
        // Claim before pricing or voucher admission. The placeholder is never
        // visible outside this transaction and every failure rolls it back.
        const claimedOrder = identity
          ? await tx.order.create({
              data: {
                userId,
                subtotal: 0,
                total: 0,
                creationKey: identity.key,
                creationRequestHash: identity.requestHash,
              },
            })
          : null;
        // 1. Tính giá server-side (không tin giá client)
        const pricingResult = await this.pricingService.calculate(
          pricingInput,
          tx,
        );
        const subtotal = pricingResult.subtotal;

        const snapshots = await this.inventory.snapshots(pricingInput, tx);
        await this.inventory.assertAvailable(
          tx,
          snapshots,
          dto.items.map((item) => item.quantity),
        );

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

          if (
            promo.usageLimit !== null &&
            promo.usedCount >= promo.usageLimit
          ) {
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
            discountAmount = Math.min(
              rawDiscount,
              promo.maxDiscount ?? Infinity,
            );
          } else {
            discountAmount = Math.min(promo.value, subtotal);
          }

          appliedPromoCode = promo.code;

          // Tăng số lượt đã sử dụng của mã
          const claimed = await tx.promoCode.updateMany({
            where: {
              id: promo.id,
              OR: [
                { usageLimit: null },
                { usedCount: { lt: tx.promoCode.fields.usageLimit } },
              ],
            },
            data: {
              usedCount: { increment: 1 },
            },
          });
          if (claimed.count === 0) {
            throw new UnprocessableEntityException({
              code: 'PROMO_USAGE_EXCEEDED',
              message: 'Mã khuyến mãi đã hết lượt sử dụng',
            });
          }
        }

        const total = Math.max(0, subtotal - discountAmount);

        // 5. Tạo đơn hàng Order ở trạng thái PENDING
        const data = {
          userId,
          status: 'PENDING',
          subtotal,
          discountAmount,
          total,
          promoCode: appliedPromoCode,
          pointsEarned: 0,
        } satisfies Prisma.OrderUncheckedCreateInput;
        let order = claimedOrder
          ? await tx.order.update({ where: { id: claimedOrder.id }, data })
          : await tx.order.create({ data });

        // 6. Tạo các dòng OrderItem kèm snapshot tên, toppings, giá lúc đặt
        const createdItems = await Promise.all(
          pricingResult.lines.map((line, index) =>
            tx.orderItem.create({
              data: {
                orderId: order.id,
                productId: line.productId,
                productName: line.productName,
                size: line.size,
                toppings: line.toppings,
                recipeSnapshot: snapshots[index],
                unitPrice: line.unitPrice,
                qty: line.qty,
                lineTotal: line.lineTotal,
                note: line.note,
              },
            }),
          ),
        );

        // No tender is needed for a server-validated, fully discounted order.
        // The unique creation claim, voucher admission and hold commit together.
        if (total === 0 && appliedPromoCode) {
          await this.inventory.hold(tx, order.id);
          const pointsEarned = await awardOrderPoints(tx, order);
          order = await tx.order.update({
            where: { id: order.id },
            data: { status: 'PAID', pointsEarned },
          });
        }

        return this.creationResponse(order, createdItems);
      },
      true,
    );
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
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
   * Barista xem toàn bộ đơn hàng của quán (phân loại theo tiến trình pha chế)
   * GET /api/orders
   */
  async findActiveOrders() {
    // One query across all active states: history and offset pagination cannot
    // hide an older unfinished order. Oldest orders are served first.
    return this.prisma.order.findMany({
      where: {
        status: { in: ['PAID', 'PREPARING', 'READY'] },
        payments: {
          none: {
            status: 'SUCCESS',
            OR: [
              { refundedAt: { not: null } },
              {
                refunds: {
                  some: {
                    status: { in: ['PENDING', 'PROCESSING', 'SUCCESS'] },
                  },
                },
              },
            ],
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        items: true,
        user: { select: { fullName: true, email: true } },
      },
    });
  }

  async findAllOrders(query: QueryOrderDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const where = query.status ? { status: query.status } : {};

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          items: true,
          user: { select: { fullName: true, email: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: orders,
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
            pointsUsed: true,
            pointsAmount: true,
            paymentUrl: true,
            providerRef: true,
            refunds: { select: { status: true, confirmedAt: true } },
            refundedAt: true,
            refundedAmount: true,
            refundRef: true,
            createdAt: true,
            expiresAt: true,
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
      payments: order.payments.map((payment) => ({
        ...payment,
        paymentUrl: order.userId === userId ? payment.paymentUrl : null,
      })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  /**
   * Hủy đơn hàng và xử lý hoàn trả toàn diện (Task 10 - Mục 6.11)
   * POST /api/orders/:id/cancel
   * - Hoàn lại kho cho từng sản phẩm
   * - Hoàn lại lượt dùng mã giảm giá
   * - Nếu đã thanh toán: hoàn tiền mock hoặc tạo yêu cầu hoàn VNPAY và thu hồi điểm thưởng
   */
  async cancelOrder(orderId: number, userId: number, role: string) {
    return this.closeOrder(orderId, { kind: 'cancel', userId, role });
  }

  async expirePendingOrders(now = new Date()) {
    const configured = Number(
      this.configService.get('ORDER_PENDING_EXPIRE_MINUTES', 15),
    );
    const minutes =
      Number.isFinite(configured) && configured > 0 ? configured : 15;
    const cutoff = new Date(now.getTime() - minutes * 60000);
    let cursor = 0;
    let expired = 0;
    // Move past unresolved sessions too, so they cannot starve newer candidates.
    for (;;) {
      const candidates = await this.prisma.order.findMany({
        where: {
          id: { gt: cursor },
          OR: [
            {
              status: { in: ['PENDING', 'PAYMENT_FAILED'] },
              createdAt: { lte: cutoff },
            },
            {
              status: 'CANCELLED',
              promoCode: { not: null },
              promoReleasedAt: null,
            },
          ],
        },
        orderBy: { id: 'asc' },
        take: 100,
        select: {
          id: true,
          payments: {
            where: { status: { in: ['PROCESSING', 'CANCELLED'] } },
            select: { id: true, method: true, status: true, expiresAt: true },
          },
        },
      });
      if (!candidates.length) return expired;
      for (const order of candidates) {
        for (const payment of order.payments) {
          if (
            payment.method === 'VNPAY' &&
            (payment.status === 'CANCELLED' ||
              (payment.expiresAt && payment.expiresAt <= now))
          )
            await this.paymentsService.reconcileSinglePayment(payment.id);
        }
        if (await this.closeOrder(order.id, { kind: 'expire', cutoff }))
          expired++;
        cursor = order.id;
      }
    }
  }

  private async closeOrder(
    orderId: number,
    action:
      | { kind: 'cancel'; userId: number; role: string }
      | { kind: 'expire'; cutoff: Date },
  ) {
    return inventoryTransaction(this.prisma, async (tx) => {
      await lockOrder(tx, orderId);
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: true,
          payments: true,
        },
      });

      if (!order) {
        throw new NotFoundException({
          code: 'ORDER_NOT_FOUND',
          message: `Không tìm thấy đơn hàng #${orderId}`,
        });
      }

      // Chỉ chủ đơn hoặc BARISTA mới được hủy
      if (
        action.kind === 'cancel' &&
        order.userId !== action.userId &&
        action.role !== 'BARISTA'
      ) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Bạn không có quyền hủy đơn hàng của người khác',
        });
      }

      // Nếu đơn đang có giao dịch thanh toán PROCESSING:
      const processingPayment = order.payments.find(
        (p) => p.status === 'PROCESSING',
      );
      const unresolved = order.payments.some(
        (payment) =>
          payment.status === 'PROCESSING' ||
          (payment.status === 'CANCELLED' &&
            payment.gatewayTxnRef &&
            payment.gatewayResponseCode !== '24' &&
            !(
              payment.gatewayResponseCode === '00' &&
              ['01', '02', '08', '11'].includes(
                payment.gatewayTransactionStatus ?? '',
              )
            )),
      );
      if (action.kind === 'expire' && order.status === 'CANCELLED') {
        if (unresolved || order.promoReleasedAt || !order.promoCode)
          return null;
        await releaseOrderVoucher(tx, order);
        return { id: order.id, status: order.status };
      }
      // Recheck under the same lock as cancellation, payment claims and IPN.
      // Reconciliation must first terminate any active gateway session.
      if (
        action.kind === 'expire' &&
        (!['PENDING', 'PAYMENT_FAILED'].includes(order.status) ||
          order.createdAt > action.cutoff ||
          unresolved ||
          order.payments.some((payment) => payment.status === 'SUCCESS'))
      )
        return null;
      let releaseInventory = true;
      if (processingPayment) {
        if (processingPayment.method === 'VNPAY') {
          // Query while holding the order lock: cancellation, IPN and expiry
          // cannot decide ownership of the same reservation concurrently.
          const result =
            await this.paymentsService.queryVnpayPayment(processingPayment);
          const paid = result?.success === true;
          releaseInventory =
            !processingPayment.gatewayTxnRef ||
            paid ||
            this.paymentsService.isConfirmedUnpaid(result);
          // Khách chủ động hủy đơn khi giao dịch VNPAY bị bỏ dở (Vấn đề 3)
          await tx.payment.update({
            where: { id: processingPayment.id },
            data: {
              status: paid ? 'NEEDS_REFUND' : 'CANCELLED',
              ...(paid
                ? {
                    providerRef: result.transactionNo,
                    paidAt: new Date(),
                    vnpPayDate: result.payDate,
                    gatewayResponseCode: result.responseCode,
                    gatewayTransactionStatus: result.transactionStatus,
                  }
                : {}),
              failureReason: 'Khách hàng hủy đơn khi đang chờ thanh toán VNPAY',
            },
          });
          if (paid)
            await tx.paymentRefund.upsert({
              where: { paymentId: processingPayment.id },
              create: {
                paymentId: processingPayment.id,
                amount: processingPayment.amount,
                idempotencyKey: `payment:${processingPayment.id}:refund`,
                status: 'PENDING',
              },
              update: {},
            });

          // Hoàn lại điểm thưởng nếu phiên thanh toán này có giữ điểm
          if (processingPayment.pointsUsed > 0) {
            const existingRefund = await tx.loyaltyTransaction.findFirst({
              where: { paymentId: processingPayment.id, type: 'REFUND' },
            });
            if (!existingRefund) {
              await tx.user.update({
                where: { id: order.userId },
                data: {
                  loyaltyPoints: { increment: processingPayment.pointsUsed },
                },
              });
              const redeemTx = await tx.loyaltyTransaction.findFirst({
                where: { paymentId: processingPayment.id, type: 'REDEEM' },
              });
              await tx.loyaltyTransaction.create({
                data: {
                  userId: order.userId,
                  orderId: order.id,
                  paymentId: processingPayment.id,
                  relatedTransactionId: redeemTx?.id,
                  points: processingPayment.pointsUsed,
                  pointsAmount: processingPayment.pointsAmount,
                  type: 'REFUND',
                  eventKey: `payment:${processingPayment.id}:cancel-refund`,
                },
              });
              await tx.order.update({
                where: { id: order.id },
                data: {
                  discountAmount:
                    order.discountAmount - processingPayment.pointsAmount,
                  total: order.total + processingPayment.pointsAmount,
                },
              });
            }
          }
        } else {
          // Phương thức thanh toán đồng bộ (WALLET, CARD) đang có request xử lý dở dang
          throw new ConflictException({
            code: 'PAYMENT_IN_PROGRESS',
            message:
              'Đơn hàng đang có giao dịch thanh toán đang xử lý, không thể hủy lúc này',
          });
        }
      }

      // Kiểm tra State Machine: chỉ PENDING, PAYMENT_FAILED hoặc PAID mới được hủy
      assertTransition(order.status as OrderStatus, 'CANCELLED');

      // 1. Gộp và khóa sản phẩm cùng thứ tự với luồng tạo đơn để tránh deadlock.
      const qtyByProduct = new Map<number, number>();
      if (releaseInventory) await this.inventory.finish(tx, orderId, false);
      for (const item of order.items.filter(
        (item) => item.recipeSnapshot === null,
      )) {
        qtyByProduct.set(
          item.productId,
          (qtyByProduct.get(item.productId) ?? 0) + item.qty,
        );
      }
      for (const [productId, qty] of [...qtyByProduct].sort(
        ([a], [b]) => a - b,
      )) {
        await tx.product.update({
          where: { id: productId },
          data: {
            stock: { increment: qty },
            version: { increment: 1 },
          },
        });
      }

      // 2. Hoàn lại lượt dùng mã giảm giá nếu có
      if (releaseInventory) await releaseOrderVoucher(tx, order);

      // 3. Nếu đơn đã PAID: hoàn điểm đã dùng và ghi nhận hoàn tiền
      if (order.status === 'PAID') {
        const successfulPayment = order.payments.find(
          (p) => p.status === 'SUCCESS',
        );
        if (successfulPayment) {
          // Hoàn lại điểm thưởng nếu đơn PAID dùng điểm
          if (successfulPayment.pointsUsed > 0) {
            const existingRefund = await tx.loyaltyTransaction.findFirst({
              where: { paymentId: successfulPayment.id, type: 'REFUND' },
            });
            if (!existingRefund) {
              await tx.user.update({
                where: { id: order.userId },
                data: {
                  loyaltyPoints: { increment: successfulPayment.pointsUsed },
                },
              });
              const redeemTx = await tx.loyaltyTransaction.findFirst({
                where: { paymentId: successfulPayment.id, type: 'REDEEM' },
              });
              await tx.loyaltyTransaction.create({
                data: {
                  userId: order.userId,
                  orderId: order.id,
                  paymentId: successfulPayment.id,
                  relatedTransactionId: redeemTx?.id,
                  points: successfulPayment.pointsUsed,
                  pointsAmount: successfulPayment.pointsAmount,
                  type: 'REFUND',
                  eventKey: `payment:${successfulPayment.id}:paid-cancel-refund`,
                },
              });
            }
          }

          if (
            successfulPayment.method === 'VNPAY' &&
            successfulPayment.amount > 0
          ) {
            await tx.paymentRefund.upsert({
              where: { paymentId: successfulPayment.id },
              create: {
                paymentId: successfulPayment.id,
                amount: successfulPayment.amount,
                idempotencyKey: `payment:${successfulPayment.id}:refund`,
                status: 'PENDING',
              },
              update: {},
            });
          } else if (
            successfulPayment.method === 'WALLET' ||
            successfulPayment.method === 'CARD'
          ) {
            // WALLET / CARD mock hoàn tiền tức thì
            const refundRef = `REFUND-${Math.random().toString(16).substring(2, 8).toUpperCase()}`;
            const now = new Date();
            await tx.paymentRefund.upsert({
              where: { paymentId: successfulPayment.id },
              create: {
                paymentId: successfulPayment.id,
                amount: successfulPayment.amount,
                idempotencyKey: `payment:${successfulPayment.id}:refund`,
                status: 'SUCCESS',
                confirmedAt: now,
                gatewayRefundNo: refundRef,
              },
              update: {
                status: 'SUCCESS',
                confirmedAt: now,
                gatewayRefundNo: refundRef,
              },
            });
            await tx.payment.update({
              where: { id: successfulPayment.id },
              data: {
                refundedAt: now,
                refundedAmount: successfulPayment.amount,
                refundRef,
              },
            });
          }
        }
      }

      // Revoke after returning redeemed points, using the ledger for legacy orders too.
      await revokeOrderPoints(tx, order);

      // 4. Chuyển trạng thái Order sang CANCELLED
      const cancelledOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'CANCELLED',
        },
      });

      return {
        id: cancelledOrder.id,
        code: `#${cancelledOrder.id}`,
        status: cancelledOrder.status,
        message:
          'Hủy đơn hàng thành công, tồn kho và các quyền lợi đã được hoàn trả',
      };
    });
  }

  /**
   * Barista cập nhật trạng thái chế biến đơn hàng (Task 10 - Mục 6.13)
   * PATCH /api/orders/:id/status
   * Chỉ cho phép đổi sang: PREPARING -> READY -> COMPLETED
   */
  async updateStatus(orderId: number, newStatus: BaristaAllowedStatus) {
    return inventoryTransaction(this.prisma, async (tx) => {
      await lockOrder(tx, orderId);
      const order = await tx.order.findUnique({
        where: { id: orderId },
      });

      if (!order) {
        throw new NotFoundException({
          code: 'ORDER_NOT_FOUND',
          message: `Không tìm thấy đơn hàng #${orderId}`,
        });
      }

      // Kiểm tra State Machine xem có nhảy cóc sai trạng thái không
      const refunding = await tx.payment.findFirst({
        where: {
          orderId,
          status: 'SUCCESS',
          OR: [
            { refundedAt: { not: null } },
            {
              refunds: {
                some: { status: { in: ['PENDING', 'PROCESSING', 'SUCCESS'] } },
              },
            },
          ],
        },
      });
      if (refunding)
        throw new ConflictException({
          code: 'ORDER_REFUND_IN_PROGRESS',
          message:
            'Đơn đang chờ hoàn tiền hoặc đã hoàn tiền, không thể nhận pha chế',
        });
      assertTransition(order.status as OrderStatus, newStatus);
      if (newStatus === 'PREPARING')
        await this.inventory.finish(tx, orderId, true);

      // Backfill legacy paid orders only; a prior EARN/REVOKE is never repeated.
      let pointsEarned = order.pointsEarned;
      if (newStatus === 'COMPLETED') {
        const successPayment = await tx.payment.findFirst({
          where: { orderId, status: 'SUCCESS' },
        });
        pointsEarned = await awardOrderPoints(tx, order, successPayment);
      }

      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status: newStatus,
          pointsEarned,
        },
      });

      return {
        id: updatedOrder.id,
        code: `#${updatedOrder.id}`,
        status: updatedOrder.status,
        updatedAt: updatedOrder.updatedAt,
      };
    });
  }
}
