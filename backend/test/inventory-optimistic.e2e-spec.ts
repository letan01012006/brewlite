import { randomUUID } from 'node:crypto';
import { databaseFixture, type DatabaseFixture } from './database-fixture.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { MockPaymentService } from '../src/payments/mock-payment.service.js';
import { Prisma, type Ingredient } from '../src/generated/prisma/client.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function wait(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Concurrency checkpoint timed out')),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

describe('Task 10: optimistic Ingredient.version reservation on PostgreSQL', () => {
  let f: DatabaseFixture;
  beforeAll(async () => {
    f = await databaseFixture();
  }, 30000);
  afterAll(async () => {
    await f?.close();
  });
  afterEach(() => vi.restoreAllMocks());

  async function catalog(stock: number) {
    const ingredient = await f.db.ingredient.create({
      data: {
        code: randomUUID(),
        name: randomUUID(),
        unit: 'GRAM',
        stockQuantity: stock,
      },
    });
    return { ingredient, product: await product(ingredient.id) };
  }

  async function product(ingredientId: number) {
    return f.db.product.create({
      data: {
        name: randomUUID(),
        category: 'OCC test',
        price: 10000,
        imageUrl: '/test',
        recipes: {
          create: {
            size: 'S',
            isActive: true,
            ingredients: {
              create: { ingredientId, unit: 'GRAM', quantity: 10 },
            },
          },
        },
      },
    });
  }

  async function order(productId: number, token = f.customer.token) {
    return (
      await f
        .api('post', '/orders', token)
        .send({
          items: [{ productId, size: 'S', quantity: 1 }],
        })
        .expect(201)
    ).body.id as number;
  }

  function pay(orderId: number, token = f.customer.token, points = false) {
    return f
      .api('post', '/payments', token)
      .set('Idempotency-Key', randomUUID())
      .send({
        orderId,
        method: points ? 'POINTS' : 'WALLET',
        ...(points ? { pointsUsed: 200 } : { mockResult: 'SUCCESS' }),
      });
  }

  // Pause real queries after they read snapshots or before their actual SQL UPDATE.
  // Unlike artificial P2034 errors, this forces PostgreSQL to reject a stale version.
  function observeHold(hooks: {
    read?: (orderId: number, rows: Ingredient[]) => Promise<void> | void;
    beforeUpdate?: (
      orderId: number,
      args: Prisma.IngredientUpdateManyArgs,
    ) => Promise<void> | void;
    afterUpdate?: (orderId: number, count: number) => void;
  }) {
    const service = f.app.get(InventoryService);
    const original = service.hold.bind(service);
    vi.spyOn(service, 'hold').mockImplementation(async (tx, orderId) => {
      const ingredient = new Proxy(tx.ingredient, {
        get(target, key, receiver) {
          if (key === 'findMany')
            return async (args: Prisma.IngredientFindManyArgs) => {
              const rows = await target.findMany(args);
              await hooks.read?.(orderId, rows);
              return rows;
            };
          if (key === 'updateMany')
            return async (args: Prisma.IngredientUpdateManyArgs) => {
              await hooks.beforeUpdate?.(orderId, args);
              const result = await target.updateMany(args);
              hooks.afterUpdate?.(orderId, result.count);
              return result;
            };
          return Reflect.get(target, key, receiver);
        },
      });
      return original(
        new Proxy(tx, {
          get(target, key, receiver) {
            return key === 'ingredient'
              ? ingredient
              : Reflect.get(target, key, receiver);
          },
        }),
        orderId,
      );
    });
  }

  function forceSameRead(ingredientId: number) {
    const bothRead = deferred();
    const versions: number[] = [];
    const updates: number[] = [];
    observeHold({
      read: async (_, rows) => {
        versions.push(rows.find((row) => row.id === ingredientId)!.version);
        if (versions.length === 2) bothRead.resolve();
        if (versions.length <= 2) await wait(bothRead.promise);
      },
      afterUpdate: (_, count) => {
        updates.push(count);
      },
    });
    return { versions, updates };
  }

  it.each([10, 20])(
    'two customers read version 0 concurrently, then reread current stock %i',
    async (stock) => {
      const { ingredient, product } = await catalog(stock);
      const other = await f.user();
      const first = await order(product.id);
      const second = await order(product.id, other.token);
      const observed = forceSameRead(ingredient.id);
      const gateway = vi.spyOn(f.app.get(MockPaymentService), 'charge');
      const results = await Promise.all([pay(first), pay(second, other.token)]);

      expect(observed.versions.slice(0, 2)).toEqual([0, 0]);
      expect(observed.updates).toContain(0);
      expect(observed.versions.slice(2)).toContain(1);
      const successes = stock / 10;
      expect(results.filter((r) => r.status === 201)).toHaveLength(successes);
      if (stock === 10) {
        const failure = results.find((r) => r.status !== 201)!;
        expect(failure.status).toBe(402);
        expect(failure.body.message).toContain('INSUFFICIENT_INGREDIENTS');
      }
      expect(gateway).toHaveBeenCalledTimes(2); // retries never charge again
      const saved = await f.db.ingredient.findUniqueOrThrow({
        where: { id: ingredient.id },
      });
      expect(saved.stockQuantity.toNumber()).toBe(stock);
      expect(saved.reservedQuantity.toNumber()).toBe(stock);
      expect(saved.version).toBe(successes);
      expect(
        await f.db.inventoryReservation.count({
          where: { orderId: { in: [first, second] } },
        }),
      ).toBe(successes);
      expect(
        await f.db.inventoryMovement.count({
          where: { ingredientId: ingredient.id, kind: 'HOLD' },
        }),
      ).toBe(successes);
    },
  );

  it('rolls back earlier ingredients and ledger when the last ingredient loses a version race', async () => {
    const plentiful = await catalog(100);
    const scarce = await catalog(10);
    const recipe = await f.db.productRecipe.findUniqueOrThrow({
      where: {
        productId_size: { productId: plentiful.product.id, size: 'S' },
      },
    });
    await f.db.productRecipeIngredient.create({
      data: {
        recipeId: recipe.id,
        ingredientId: scarce.ingredient.id,
        unit: 'GRAM',
        quantity: 10,
      },
    });
    const other = await f.user();
    const loser = await order(plentiful.product.id);
    const winner = await order(scarce.product.id, other.token);
    const earlierIngredientHeld = deferred();
    const winnerCommitted = deferred();
    let loserReads = 0;
    observeHold({
      read: (id) => {
        if (id === loser) loserReads++;
      },
      beforeUpdate: async (id, args) => {
        if (id === loser && args.where?.id === scarce.ingredient.id) {
          earlierIngredientHeld.resolve();
          await wait(winnerCommitted.promise);
        }
      },
    });

    const losingRequest = pay(loser).then((result) => result);
    try {
      await wait(earlierIngredientHeld.promise);
      await pay(winner, other.token).expect(201);
    } finally {
      winnerCommitted.resolve();
    }
    const lost = await losingRequest;
    expect(lost.status).toBe(402);
    expect(lost.body.message).toContain('INSUFFICIENT_INGREDIENTS');
    expect(loserReads).toBe(2);
    const first = await f.db.ingredient.findUniqueOrThrow({
      where: { id: plentiful.ingredient.id },
    });
    expect(first.stockQuantity.toNumber()).toBe(100);
    expect(first.reservedQuantity.toNumber()).toBe(0);
    expect(first.version).toBe(0);
    expect(
      await f.db.inventoryReservation.count({ where: { orderId: loser } }),
    ).toBe(0);
    expect(
      await f.db.inventoryMovement.count({ where: { orderId: loser } }),
    ).toBe(0);
    expect(
      (await f.db.payment.findFirstOrThrow({ where: { orderId: loser } }))
        .status,
    ).toBe('FAILED');
    expect(
      (
        await f.db.ingredient.findUniqueOrThrow({
          where: { id: scarce.ingredient.id },
        })
      ).reservedQuantity.toNumber(),
    ).toBe(10);
  });

  it('POINTS retries the entire claim and refunds no points twice when the last portion is taken', async () => {
    const { ingredient, product } = await catalog(10);
    const other = await f.user();
    await f.db.user.updateMany({
      where: { id: { in: [f.customer.id, other.id] } },
      data: { loyaltyPoints: 200 },
    });
    const orders = [
      await order(product.id),
      await order(product.id, other.token),
    ];
    const observed = forceSameRead(ingredient.id);
    const gateway = vi.spyOn(f.app.get(MockPaymentService), 'charge');
    const results = await Promise.all([
      pay(orders[0], f.customer.token, true),
      pay(orders[1], other.token, true),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 422,
    ]);
    expect(observed.updates).toContain(0);
    expect(observed.versions.slice(2)).toContain(1);
    const winner = results.findIndex((r) => r.status === 201);
    const loser = 1 - winner;
    expect(results[loser].body.code).toBe('INSUFFICIENT_INGREDIENTS');
    const users = [f.customer, other];
    expect(
      (await f.db.user.findUniqueOrThrow({ where: { id: users[winner].id } }))
        .loyaltyPoints,
    ).toBe(0);
    expect(
      (await f.db.user.findUniqueOrThrow({ where: { id: users[loser].id } }))
        .loyaltyPoints,
    ).toBe(200);
    expect(
      await f.db.loyaltyTransaction.count({
        where: { orderId: orders[loser] },
      }),
    ).toBe(0);
    expect(
      await f.db.payment.count({ where: { orderId: orders[loser] } }),
    ).toBe(0);
    expect(
      await f.db.inventoryReservation.count({
        where: { orderId: orders[loser] },
      }),
    ).toBe(0);
    expect(
      await f.db.inventoryMovement.count({
        where: { ingredientId: ingredient.id, kind: 'HOLD' },
      }),
    ).toBe(1);
    expect(gateway).not.toHaveBeenCalled();
  });
});
