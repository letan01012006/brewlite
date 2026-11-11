import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  Prisma,
  type Ingredient,
  type IngredientUnit,
  type OrderItem,
  type Size,
} from '../generated/prisma/client.js';
import type { PricingItemInput } from '../common/pricing/pricing.service.js';
import { quantity } from './quantity.js';
import {
  inventoryTransaction,
  InventoryVersionConflict,
} from './transaction.js';
import type { StockAdjustmentDto } from './dto/stock-adjustment.dto.js';

type Db = Prisma.TransactionClient;
export type IngredientAmount = {
  ingredientId: number;
  unit: IngredientUnit;
  quantity: string;
};
export type RecipeSnapshot = {
  schemaVersion: 1;
  recipeId: number;
  recipeVersion: number;
  toppings: { id: number; ingredientId: number; quantity: string }[];
  ingredients: IngredientAmount[];
};
export class InsufficientIngredients extends ConflictException {
  constructor(details: unknown) {
    super({
      code: 'INSUFFICIENT_INGREDIENTS',
      message: 'Không đủ nguyên liệu cho lựa chọn này.',
      details,
    });
  }
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async stock() {
    return (
      await this.prisma.ingredient.findMany({ orderBy: { id: 'asc' } })
    ).map((row) => ({
      ...row,
      availableQuantity: row.stockQuantity
        .minus(row.reservedQuantity)
        .toFixed(3),
    }));
  }
  /** Lịch sử biến động kho (mới nhất trước), có lọc theo nguyên liệu/loại/thời gian. */
  async movements(query: {
    ingredientId?: number;
    kind?:
      | 'RECEIPT'
      | 'ADJUSTMENT'
      | 'ADJUSTMENT_POSITIVE'
      | 'ADJUSTMENT_NEGATIVE'
      | 'HOLD'
      | 'RELEASE'
      | 'CONSUME';
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from?.trim()) {
      const fromDate = new Date(
        /^\d{4}-\d{2}-\d{2}$/.test(query.from.trim())
          ? `${query.from.trim()}T00:00:00.000`
          : query.from.trim(),
      );
      if (Number.isNaN(fromDate.getTime()))
        throw new BadRequestException('Ngày bắt đầu không hợp lệ.');
      createdAt.gte = fromDate;
    }
    if (query.to?.trim()) {
      const toDate = new Date(
        /^\d{4}-\d{2}-\d{2}$/.test(query.to.trim())
          ? `${query.to.trim()}T23:59:59.999`
          : query.to.trim(),
      );
      if (Number.isNaN(toDate.getTime()))
        throw new BadRequestException('Ngày kết thúc không hợp lệ.');
      createdAt.lte = toDate;
    }
    const kindFilter: Prisma.InventoryMovementWhereInput =
      query.kind === 'ADJUSTMENT_POSITIVE'
        ? { kind: 'ADJUSTMENT', stockDelta: { gt: 0 } }
        : query.kind === 'ADJUSTMENT_NEGATIVE'
          ? { kind: 'ADJUSTMENT', stockDelta: { lt: 0 } }
          : query.kind
            ? { kind: query.kind }
            : {};
    const where: Prisma.InventoryMovementWhereInput = {
      ...(query.ingredientId ? { ingredientId: query.ingredientId } : {}),
      ...kindFilter,
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          ingredient: {
            select: {
              code: true,
              name: true,
              toppings: { select: { id: true, name: true } },
            },
          },
          actor: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }
  async adjust(
    actorId: number,
    kind: 'RECEIPT' | 'ADJUSTMENT',
    dto: StockAdjustmentDto,
    key?: string,
  ) {
    if (!key?.trim() || key.length > 200)
      throw new BadRequestException(
        'Idempotency-Key bắt buộc, tối đa 200 ký tự.',
      );
    const reason = dto.reason?.trim() || null;
    if (kind === 'ADJUSTMENT' && !reason) {
      throw new BadRequestException('Ghi nhận hao hụt bắt buộc phải có lý do.');
    }
    const rawAmount = new Prisma.Decimal(dto.quantity);
    const expectedDelta =
      kind === 'ADJUSTMENT' && rawAmount.isPositive()
        ? rawAmount.negated()
        : rawAmount;
    const eventKey = `manual:${key.trim()}`;
    return inventoryTransaction(this.prisma, async (tx) => {
      // A transaction-scoped key lock handles concurrent first requests, including different ingredients.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${eventKey}, 0))`;
      const previous = await tx.inventoryMovement.findUnique({
        where: { eventKey },
      });
      if (previous) {
        if (
          previous.actorId !== actorId ||
          previous.kind !== kind ||
          previous.ingredientId !== dto.ingredientId ||
          !previous.stockDelta.equals(expectedDelta) ||
          (previous.reason ?? null) !== reason
        ) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'Khóa đã dùng cho thao tác khác.',
          });
        }
        return previous;
      }
      await this.lockIngredients(tx, [dto.ingredientId]);
      const row = await tx.ingredient.findUnique({
        where: { id: dto.ingredientId },
      });
      if (!row) throw new NotFoundException('Không tìm thấy nguyên liệu.');
      const parsed = quantity(dto.quantity, row.unit, kind === 'ADJUSTMENT');
      const delta =
        kind === 'ADJUSTMENT' && parsed.isPositive()
          ? parsed.negated()
          : parsed;
      const next = row.stockQuantity.plus(delta);
      if (
        next.lessThan(row.reservedQuantity) ||
        next.greaterThan('999999999999999.999')
      ) {
        throw new ConflictException({
          code: 'INVALID_STOCK',
          message:
            'Tồn sau điều chỉnh không hợp lệ hoặc thấp hơn lượng đang giữ.',
        });
      }
      await tx.ingredient.update({
        where: { id: row.id },
        data: { stockQuantity: next, version: { increment: 1 } },
      });
      return tx.inventoryMovement.create({
        data: {
          eventKey,
          kind,
          ingredientId: row.id,
          unit: row.unit,
          stockDelta: delta,
          reservedDelta: 0,
          actorId,
          reason,
        },
      });
    });
  }

  async snapshots(
    items: PricingItemInput[],
    tx: Db,
  ): Promise<RecipeSnapshot[]> {
    const products = await tx.product.findMany({
      where: { id: { in: items.map((i) => i.productId) }, isActive: true },
      include: {
        recipes: {
          include: { ingredients: { include: { ingredient: true } } },
        },
        toppings: { include: { ingredient: true } },
      },
    });
    return items.map((item) => {
      const product = products.find((p) => p.id === item.productId);
      if (!product)
        throw new NotFoundException('Không tìm thấy sản phẩm đang bán.');
      const recipe = product.recipes.find(
        (r) => r.size === item.size && r.isActive,
      );
      if (!recipe?.ingredients.length)
        throw this.unconfigured(item.productId, item.size);
      const pausedIngredient = recipe.ingredients.find(
        (entry) => !entry.ingredient.isActive,
      );
      if (pausedIngredient) {
        throw new ConflictException({
          code: 'INGREDIENT_PAUSED',
          message: `Nguyên liệu "${pausedIngredient.ingredient.name}" đang tạm dừng.`,
          details: [
            {
              productId: item.productId,
              size: item.size,
              ingredientId: pausedIngredient.ingredientId,
              ingredientName: pausedIngredient.ingredient.name,
            },
          ],
        });
      }
      const ingredients: IngredientAmount[] = recipe.ingredients.map(
        (entry) => ({
          ingredientId: entry.ingredientId,
          unit: entry.unit,
          quantity: entry.quantity.toFixed(3),
        }),
      );
      const ids = item.toppingIds ?? [];
      if (ids.length > 3 || new Set(ids).size !== ids.length)
        throw new BadRequestException('Topping không hợp lệ.');
      const toppings = ids.map((id) => {
        const topping = product.toppings.find((t) => t.id === id && t.isActive);
        if (!topping)
          throw new BadRequestException({
            code: 'TOPPING_NOT_ALLOWED',
            message: 'Topping không thuộc sản phẩm hoặc đã ngừng bán.',
          });
        if (!topping.ingredient || !topping.quantityPerServing)
          throw this.unconfigured(item.productId, item.size);
        if (!topping.ingredient.isActive) {
          throw new ConflictException({
            code: 'INGREDIENT_PAUSED',
            message: `Nguyên liệu cho topping "${topping.name}" đang tạm dừng.`,
            details: [
              {
                productId: item.productId,
                size: item.size,
                toppingId: topping.id,
                toppingName: topping.name,
                ingredientId: topping.ingredient.id,
                ingredientName: topping.ingredient.name,
              },
            ],
          });
        }
        const amount = quantity(
          topping.quantityPerServing.toFixed(3),
          topping.ingredient.unit,
        );
        ingredients.push({
          ingredientId: topping.ingredient.id,
          unit: topping.ingredient.unit,
          quantity: amount.toFixed(3),
        });
        return {
          id,
          ingredientId: topping.ingredient.id,
          quantity: amount.toFixed(3),
        };
      });
      return {
        schemaVersion: 1,
        recipeId: recipe.id,
        recipeVersion: recipe.version,
        toppings,
        ingredients: this.aggregate([{ ingredients, qty: 1 }]),
      };
    });
  }
  private unconfigured(productId: number, size: Size) {
    return new ConflictException({
      code: 'RECIPE_UNAVAILABLE',
      message: 'Món/size/topping chưa có công thức nguyên liệu hợp lệ.',
      details: [{ productId, size }],
    });
  }
  aggregate(
    lines: { ingredients: IngredientAmount[]; qty: number }[],
  ): IngredientAmount[] {
    const totals = new Map<
      number,
      { unit: IngredientUnit; amount: Prisma.Decimal }
    >();
    for (const line of lines)
      for (const entry of line.ingredients) {
        const old = totals.get(entry.ingredientId);
        if (old && old.unit !== entry.unit)
          throw new ConflictException('Đơn vị trong snapshot không nhất quán.');
        totals.set(entry.ingredientId, {
          unit: entry.unit,
          amount: (old?.amount ?? new Prisma.Decimal(0)).plus(
            quantity(entry.quantity, entry.unit).times(line.qty),
          ),
        });
      }
    return [...totals]
      .sort(([a], [b]) => a - b)
      .map(([ingredientId, row]) => ({
        ingredientId,
        unit: row.unit,
        quantity: row.amount.toFixed(3),
      }));
  }
  private async balance(
    tx: Db,
    needs: IngredientAmount[],
    snapshot?: Ingredient[],
  ) {
    const rows =
      snapshot ??
      (await tx.ingredient.findMany({
        where: { id: { in: needs.map((n) => n.ingredientId) } },
      }));
    return needs.map((need) => {
      const row = rows.find((r) => r.id === need.ingredientId);
      const available =
        row?.isActive && row.unit === need.unit
          ? row.stockQuantity.minus(row.reservedQuantity)
          : new Prisma.Decimal(0);
      return {
        ...need,
        availableQuantity: available.toFixed(3),
        sufficient: available.greaterThanOrEqualTo(need.quantity),
      };
    });
  }
  async assertAvailable(
    tx: Db,
    snapshots: RecipeSnapshot[],
    quantities: number[],
  ) {
    const needs = this.aggregate(
      snapshots.map((s, i) => ({
        ingredients: s.ingredients,
        qty: quantities[i],
      })),
    );
    const balance = await this.balance(tx, needs);
    if (balance.some((b) => !b.sufficient))
      throw new InsufficientIngredients(balance.filter((b) => !b.sufficient));
  }
  async availability(items: PricingItemInput[]) {
    return inventoryTransaction(
      this.prisma,
      async (tx) => {
        const snapshots = await this.snapshots(items, tx);
        const needs = this.aggregate(
          snapshots.map((s, i) => ({
            ingredients: s.ingredients,
            qty: items[i].quantity,
          })),
        );
        const balances = await this.balance(tx, needs);
        const available = new Map(
          balances.map((b) => [
            b.ingredientId,
            new Prisma.Decimal(b.availableQuantity),
          ]),
        );
        return {
          available: balances.every((b) => b.sufficient),
          shortages: balances.filter((b) => !b.sufficient),
          lines: snapshots.map((snapshot, index) => {
            // Maximum TOTAL quantity of this line after satisfying every other line.
            let maxQuantity = 20;
            for (const entry of snapshot.ingredients) {
              const perCup = new Prisma.Decimal(entry.quantity);
              const total = new Prisma.Decimal(
                needs.find((n) => n.ingredientId === entry.ingredientId)!
                  .quantity,
              );
              const other = total.minus(perCup.times(items[index].quantity));
              const remaining = available.get(entry.ingredientId)!.minus(other);
              maxQuantity = Math.min(
                maxQuantity,
                Math.max(0, remaining.div(perCup).floor().toNumber()),
              );
            }
            return {
              index,
              productId: items[index].productId,
              size: items[index].size,
              maxQuantity,
            };
          }),
        };
      },
      true,
    );
  }
  async productAvailability(productId: number) {
    return (await this.productAvailabilities([productId])).get(productId)!;
  }
  async productAvailabilities(productIds: number[]) {
    return inventoryTransaction(
      this.prisma,
      async (tx) => {
        const recipes = await tx.productRecipe.findMany({
          where: { productId: { in: productIds } },
          include: { ingredients: { include: { ingredient: true } } },
        });
        return new Map(
          productIds.map((productId) => {
            const entries = (['S', 'M', 'L'] as const).map((size) => {
              const recipe = recipes.find(
                (r) => r.productId === productId && r.size === size,
              );
              const configured = Boolean(
                recipe?.isActive && recipe.ingredients.length,
              );
              const hasPausedIngredient =
                configured &&
                recipe!.ingredients.some((i) => !i.ingredient.isActive);

              if (!configured) {
                return {
                  size,
                  maxQuantity: 0,
                  reason: 'RECIPE_UNAVAILABLE' as const,
                };
              }
              if (hasPausedIngredient) {
                return {
                  size,
                  maxQuantity: 0,
                  reason: 'INGREDIENT_PAUSED' as const,
                };
              }

              let maxQuantity = Number.MAX_SAFE_INTEGER;
              for (const entry of recipe!.ingredients) {
                const available = entry.ingredient.stockQuantity.minus(
                  entry.ingredient.reservedQuantity,
                );
                maxQuantity = Math.min(
                  maxQuantity,
                  Math.max(0, available.div(entry.quantity).floor().toNumber()),
                );
              }
              return {
                size,
                maxQuantity,
                reason:
                  maxQuantity > 0
                    ? null
                    : ('INSUFFICIENT_INGREDIENTS' as const),
              };
            });
            return [
              productId,
              {
                inventoryMode: 'INGREDIENT' as const,
                availability: entries,
                inStock: entries.some((e) => e.maxQuantity > 0),
              },
            ];
          }),
        );
      },
      true,
    );
  }
  private async lockIngredients(tx: Db, ids: number[]) {
    for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
      await tx.$queryRaw`SELECT "id" FROM "Ingredient" WHERE "id" = ${id} FOR UPDATE`;
    }
  }
  private snapshot(item: OrderItem): RecipeSnapshot {
    const snapshot = item.recipeSnapshot as RecipeSnapshot | null;
    if (
      !snapshot ||
      snapshot.schemaVersion !== 1 ||
      !Array.isArray(snapshot.ingredients) ||
      !snapshot.ingredients.length
    ) {
      throw new ConflictException({
        code: 'INVALID_RECIPE_SNAPSHOT',
        message: 'Snapshot công thức không hợp lệ; cần đối soát đơn.',
      });
    }
    return snapshot;
  }
  async hold(tx: Db, orderId: number) {
    const items = await tx.orderItem.findMany({ where: { orderId } });
    if (items.every((i) => i.recipeSnapshot === null)) return; // Legacy order already reserved Product.stock.
    const snapshots = items.map((item) => this.snapshot(item));
    const previous = await tx.inventoryReservation.findUnique({
      where: { orderId },
    });
    if (previous) {
      if (previous.status === 'HELD') return;
      if (previous.status !== 'RELEASED')
        throw new ConflictException('Reservation đã kết thúc.');
    }
    const needs = this.aggregate(
      snapshots.map((s, i) => ({
        ingredients: s.ingredients,
        qty: items[i].qty,
      })),
    );
    // Optimistic read: do not lock Ingredient rows before checking stock.
    const ingredients = await tx.ingredient.findMany({
      where: { id: { in: needs.map((n) => n.ingredientId) } },
    });
    const balance = await this.balance(tx, needs, ingredients);
    if (balance.some((b) => !b.sufficient))
      throw new InsufficientIngredients(balance.filter((b) => !b.sufficient));
    const reservation = previous
      ? await tx.inventoryReservation.update({
          where: {
            id: previous.id,
            version: previous.version,
            status: 'RELEASED',
          },
          data: {
            status: 'HELD',
            version: { increment: 1 },
            releasedAt: null,
            releaseReason: null,
          },
        })
      : await tx.inventoryReservation.create({
          data: {
            orderId,
            eventKey: `order:${orderId}:hold`,
            items: {
              create: needs.map((n) => ({
                ...n,
                quantity: new Prisma.Decimal(n.quantity),
              })),
            },
          },
        });
    for (const need of needs) {
      const ingredient = ingredients.find(
        (row) => row.id === need.ingredientId,
      )!;
      const updated = await tx.ingredient.updateMany({
        where: {
          id: need.ingredientId,
          version: ingredient.version,
          isActive: true,
          unit: need.unit,
          reservedQuantity: {
            lte: ingredient.stockQuantity.minus(need.quantity),
          },
        },
        data: {
          reservedQuantity: { increment: need.quantity },
          version: { increment: 1 },
        },
      });
      // Do not report a shortage here: callers may persist failed payments.
      // The retry wrapper must roll back this reservation and any earlier
      // ingredient updates, then reread all balances in a new transaction.
      if (updated.count !== 1) throw new InventoryVersionConflict();
      await tx.inventoryMovement.create({
        data: {
          eventKey: `order:${orderId}:hold:${reservation.version}:${need.ingredientId}`,
          kind: 'HOLD',
          orderId,
          reservationId: reservation.id,
          reservationVersion: reservation.version,
          ingredientId: need.ingredientId,
          unit: need.unit,
          stockDelta: 0,
          reservedDelta: need.quantity,
        },
      });
    }
  }
  async finish(tx: Db, orderId: number, consume: boolean) {
    const reservation = await tx.inventoryReservation.findUnique({
      where: { orderId },
      include: { items: true },
    });
    if (!reservation) {
      const items = await tx.orderItem.findMany({ where: { orderId } });
      if (consume && items.some((i) => i.recipeSnapshot !== null))
        throw new ConflictException('Đơn chưa giữ nguyên liệu.');
      return;
    }
    const status = consume ? 'CONSUMED' : 'RELEASED';
    if (reservation.status === status) return;
    if (reservation.status !== 'HELD')
      throw new ConflictException('Reservation đã kết thúc.');
    await this.lockIngredients(
      tx,
      reservation.items.map((i) => i.ingredientId),
    );
    for (const item of reservation.items) {
      const delta = item.quantity.negated();
      await tx.ingredient.update({
        where: { id: item.ingredientId },
        data: {
          reservedQuantity: { decrement: item.quantity },
          ...(consume ? { stockQuantity: { decrement: item.quantity } } : {}),
          version: { increment: 1 },
        },
      });
      await tx.inventoryMovement.create({
        data: {
          eventKey: `order:${orderId}:${status}:${reservation.version}:${item.ingredientId}`,
          kind: consume ? 'CONSUME' : 'RELEASE',
          orderId,
          reservationId: reservation.id,
          reservationVersion: reservation.version,
          ingredientId: item.ingredientId,
          unit: item.unit,
          stockDelta: consume ? delta : 0,
          reservedDelta: delta,
        },
      });
    }
    await tx.inventoryReservation.update({
      where: { id: reservation.id },
      data: {
        status,
        version: { increment: 1 },
        ...(consume
          ? { consumedAt: new Date() }
          : { releasedAt: new Date(), releaseReason: 'ORDER_CANCELLED' }),
      },
    });
  }
}
