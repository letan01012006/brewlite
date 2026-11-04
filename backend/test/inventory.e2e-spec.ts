import { randomUUID } from 'node:crypto';
import { databaseFixture, type DatabaseFixture } from './database-fixture.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { MockPaymentService } from '../src/payments/mock-payment.service.js';
import { Prisma } from '../src/generated/prisma/client.js';

describe('Inventory lifecycle: real PostgreSQL transactions and HTTP', () => {
  let f: DatabaseFixture;
  beforeAll(async () => {
    f = await databaseFixture();
  }, 30000);
  afterAll(async () => {
    await f?.close();
  });
  afterEach(() => vi.restoreAllMocks());
  it('documents stock, availability and idempotency headers in Swagger', async () => {
    const document = (await f.api('get', '/docs-json').expect(200)).body;
    expect(
      document.paths['/api/inventory/availability'].post.responses['200']
        .content['application/json'].schema.properties.lines,
    ).toBeDefined();
    expect(
      document.paths['/api/inventory/receipts'].post.parameters.some(
        (p: { name: string }) => p.name === 'Idempotency-Key',
      ),
    ).toBe(true);
  });
  async function catalog(stock = '100') {
    const ingredient = await f.db.ingredient.create({
      data: {
        code: randomUUID(),
        name: randomUUID(),
        unit: 'GRAM',
        stockQuantity: stock,
      },
    });
    const product = await f.db.product.create({
      data: {
        name: randomUUID(),
        category: 'Test',
        price: 10000,
        stock: 777,
        imageUrl: '/test',
        recipes: {
          create: (['S', 'M', 'L'] as const).map((size, i) => ({
            size,
            isActive: true,
            ingredients: {
              create: {
                ingredientId: ingredient.id,
                unit: 'GRAM',
                quantity: (i + 1) * 10,
              },
            },
          })),
        },
      },
    });
    const topping = await f.db.topping.create({
      data: {
        name: randomUUID(),
        price: 1000,
        ingredientId: ingredient.id,
        quantityPerServing: 5,
        products: { connect: { id: product.id } },
      },
    });
    return { ingredient, product, topping };
  }
  async function order(
    productId: number,
    quantity = 1,
    size = 'S',
    toppingIds: number[] = [],
  ) {
    return (
      await f
        .api('post', '/orders', f.customer.token)
        .send({ items: [{ productId, quantity, size, toppingIds }] })
        .expect(201)
    ).body.id as number;
  }
  function pay(orderId: number, key = randomUUID(), mockResult = 'SUCCESS') {
    return f
      .api('post', '/payments', f.customer.token)
      .set('Idempotency-Key', key)
      .send({ orderId, method: 'WALLET', mockResult });
  }
  function status(id: number) {
    return f
      .api('patch', `/orders/${id}/status`, f.barista.token)
      .send({ status: 'PREPARING' });
  }
  function cancel(id: number) {
    return f.api('post', `/orders/${id}/cancel`, f.customer.token);
  }
  it('08–10 receipts/adjustments replay and cannot reduce stock below held quantity', async () => {
    const { ingredient } = await catalog('20');
    const key = randomUUID();
    const body = {
      ingredientId: ingredient.id,
      quantity: '10.500',
      reason: 'Test receipt',
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        f
          .api('post', '/inventory/receipts', f.barista.token)
          .set('Idempotency-Key', key)
          .send(body),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(
      (
        await f.db.ingredient.findUniqueOrThrow({
          where: { id: ingredient.id },
        })
      ).stockQuantity.toString(),
    ).toBe('30.5');
    await f
      .api('post', '/inventory/receipts', f.barista.token)
      .set('Idempotency-Key', key)
      .send({ ...body, quantity: '2' })
      .expect(409);
    await f
      .api('post', '/inventory/adjustments', f.barista.token)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, quantity: '-31' })
      .expect(409);
    await f
      .api('post', '/inventory/adjustments', f.barista.token)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, quantity: '-0.5' })
      .expect(201);
    expect(
      (
        await f.api('get', '/inventory/stock', f.barista.token).expect(200)
      ).body.find((r: { id: number }) => r.id === ingredient.id)
        .availableQuantity,
    ).toBe('30.000');
  });
  it('11–14 aggregates sizes, toppings and shared ingredients and freezes snapshot', async () => {
    const { ingredient, product, topping } = await catalog('50');
    const second = await f.db.product.create({
      data: {
        name: randomUUID(),
        category: 'Test',
        price: 1,
        imageUrl: '/',
        recipes: {
          create: {
            size: 'S',
            isActive: true,
            ingredients: {
              create: {
                ingredientId: ingredient.id,
                unit: 'GRAM',
                quantity: 20,
              },
            },
          },
        },
      },
    });
    const items = [
      {
        productId: product.id,
        size: 'M',
        quantity: 2,
        toppingIds: [topping.id],
      },
      { productId: second.id, size: 'S', quantity: 1 },
    ];
    const result = await f
      .api('post', '/inventory/availability')
      .send({ items })
      .expect(200);
    expect(result.body.available).toBe(false);
    expect(result.body.shortages[0].quantity).toBe('70.000');
    expect(result.body.lines[0].maxQuantity).toBe(1);
    await f
      .api('post', '/orders', f.customer.token)
      .send({ items })
      .expect(409);
    expect(
      await f.db.order.count({
        where: { items: { some: { productId: product.id } } },
      }),
    ).toBe(0);
    const id = await order(product.id, 1, 'L', [topping.id]);
    expect(
      await f.db.inventoryReservation.count({ where: { orderId: id } }),
    ).toBe(0);
    expect(
      (
        await f.db.ingredient.findUniqueOrThrow({
          where: { id: ingredient.id },
        })
      ).reservedQuantity.toString(),
    ).toBe('0');
    await f
      .api('put', `/products/${product.id}/recipes/L`, f.barista.token)
      .send({
        ingredients: [{ ingredientId: ingredient.id, quantity: '45' }],
        isActive: true,
      })
      .expect(200);
    await pay(id).expect(201);
    expect(
      (
        await f.db.ingredient.findUniqueOrThrow({
          where: { id: ingredient.id },
        })
      ).reservedQuantity.toString(),
    ).toBe('35');
    await status(id).expect(200);
    expect(
      (
        await f.db.ingredient.findUniqueOrThrow({
          where: { id: ingredient.id },
        })
      ).stockQuantity.toString(),
    ).toBe('15');
  });
  it('15–24 concurrent payment admission, failure replay, retry, hold/consume exactly once', async () => {
    const { ingredient, product } = await catalog('10');
    const [a, b] = await Promise.all([order(product.id), order(product.id)]);
    const keys = [randomUUID(), randomUUID()];
    const results = await Promise.all([pay(a, keys[0]), pay(b, keys[1])]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 402,
    ]);
    const winningIndex = results.findIndex((r) => r.status === 201);
    const winner = [a, b][winningIndex],
      loser = [a, b][1 - winningIndex];
    const failed = await pay(loser, keys[1 - winningIndex]).expect(402);
    expect(failed.body).toEqual(results[1 - winningIndex].body);
    expect(
      (await f.db.order.findUniqueOrThrow({ where: { id: loser } })).status,
    ).toBe('PAYMENT_FAILED');
    expect(
      await f.db.payment.count({
        where: { orderId: loser, status: 'PROCESSING' },
      }),
    ).toBe(0);
    const replays = await Promise.all([
      pay(winner, keys[winningIndex]),
      pay(winner, keys[winningIndex]),
    ]);
    expect(replays.every((r) => r.status === 201)).toBe(true);
    expect(
      await f.db.inventoryMovement.count({
        where: { orderId: winner, kind: 'HOLD' },
      }),
    ).toBe(1);
    await f
      .api('post', '/inventory/adjustments', f.barista.token)
      .set('Idempotency-Key', randomUUID())
      .send({
        ingredientId: ingredient.id,
        quantity: '-1',
        reason: 'Cannot remove held stock',
      })
      .expect(409);
    const preparing = await Promise.all([status(winner), status(winner)]);
    expect(preparing.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    const row = await f.db.ingredient.findUniqueOrThrow({
      where: { id: ingredient.id },
    });
    expect(row.stockQuantity.toString()).toBe('0');
    expect(row.reservedQuantity.toString()).toBe('0');
    expect(
      await f.db.inventoryMovement.count({
        where: { orderId: winner, kind: 'CONSUME' },
      }),
    ).toBe(1);
    await cancel(winner).expect(409);
    await f
      .api('post', '/inventory/receipts', f.barista.token)
      .set('Idempotency-Key', randomUUID())
      .send({ ingredientId: ingredient.id, quantity: '10', reason: 'Restock' })
      .expect(201);
    await pay(loser).expect(201);
    const cancelled = await Promise.all([cancel(loser), cancel(loser)]);
    expect(cancelled.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    expect(
      await f.db.inventoryMovement.count({
        where: { orderId: loser, kind: 'RELEASE' },
      }),
    ).toBe(1);
    expect(
      (
        await f.db.ingredient.findUniqueOrThrow({
          where: { id: ingredient.id },
        })
      ).reservedQuantity.toString(),
    ).toBe('0');
  });
  it('17 gateway failure leaves inventory untouched and permits new-key retry', async () => {
    const { product, ingredient } = await catalog();
    const id = await order(product.id);
    const key = randomUUID();
    const failure = await pay(id, key, 'FAILED').expect(402);
    expect((await pay(id, key, 'FAILED')).body).toEqual(failure.body);
    expect(
      await f.db.inventoryReservation.count({ where: { orderId: id } }),
    ).toBe(0);
    expect(
      (
        await f.db.ingredient.findUniqueOrThrow({
          where: { id: ingredient.id },
        })
      ).stockQuantity.toString(),
    ).toBe('100');
    await pay(id).expect(201);
  });
  it('two customers compete for the same last portion without negative inventory', async () => {
    const { product, ingredient } = await catalog('10');
    const other = await f.user();
    const first = await order(product.id);
    const second = (
      await f
        .api('post', '/orders', other.token)
        .send({ items: [{ productId: product.id, size: 'S', quantity: 1 }] })
        .expect(201)
    ).body.id;
    const result = await Promise.all([
      pay(first),
      f
        .api('post', '/payments', other.token)
        .set('Idempotency-Key', randomUUID())
        .send({ orderId: second, method: 'CARD', mockResult: 'SUCCESS' }),
    ]);
    expect(result.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 402,
    ]);
    const row = await f.db.ingredient.findUniqueOrThrow({
      where: { id: ingredient.id },
    });
    expect(row.stockQuantity.toString()).toBe('10');
    expect(row.reservedQuantity.toString()).toBe('10');
  });
  it('retries the whole final transaction without repeating the gateway or inventory events', async () => {
    const { product } = await catalog();
    const id = await order(product.id);
    const service = f.app.get(InventoryService);
    const original = service.hold.bind(service);
    vi.spyOn(service, 'hold').mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Prisma.PrismaClientKnownRequestError(
        'Injected serialization conflict',
        { code: 'P2034', clientVersion: '6.19.3' },
      );
    });
    const gateway = vi.spyOn(f.app.get(MockPaymentService), 'charge');
    await pay(id).expect(201);
    expect(gateway).toHaveBeenCalledTimes(1);
    expect(
      await f.db.inventoryReservation.count({ where: { orderId: id } }),
    ).toBe(1);
    expect(
      await f.db.inventoryMovement.count({
        where: { orderId: id, kind: 'HOLD' },
      }),
    ).toBe(1);
  });
  it('25 rolls back consumption, ledger and order status when transaction fails', async () => {
    const { product, ingredient } = await catalog();
    const id = await order(product.id);
    await pay(id).expect(201);
    const service = f.app.get(InventoryService);
    const original = service.finish.bind(service);
    vi.spyOn(service, 'finish').mockImplementation(async (...args) => {
      await original(...args);
      throw new Error('Injected after mutation');
    });
    await status(id).expect(500);
    expect((await f.db.order.findUniqueOrThrow({ where: { id } })).status).toBe(
      'PAID',
    );
    expect(
      (
        await f.db.inventoryReservation.findUniqueOrThrow({
          where: { orderId: id },
        })
      ).status,
    ).toBe('HELD');
    expect(
      await f.db.inventoryMovement.count({
        where: { orderId: id, kind: 'CONSUME' },
      }),
    ).toBe(0);
    const row = await f.db.ingredient.findUniqueOrThrow({
      where: { id: ingredient.id },
    });
    expect(row.stockQuantity.toString()).toBe('100');
    expect(row.reservedQuantity.toString()).toBe('10');
  });
  it('lists movement history filtered by ingredient and kind, barista only', async () => {
    const { ingredient } = await catalog('5');
    for (const [path, quantity] of [
      ['/inventory/receipts', '3'],
      ['/inventory/adjustments', '-1'],
    ]) {
      await f
        .api('post', path, f.barista.token)
        .set('Idempotency-Key', randomUUID())
        .send({ ingredientId: ingredient.id, quantity, reason: 'History test' })
        .expect(201);
    }
    const all = await f
      .api(
        'get',
        `/inventory/movements?ingredientId=${ingredient.id}`,
        f.barista.token,
      )
      .expect(200);
    expect(all.body.meta.total).toBe(2);
    expect(all.body.data.map((m: { kind: string }) => m.kind)).toEqual([
      'ADJUSTMENT',
      'RECEIPT',
    ]);
    expect(all.body.data[0].ingredient.code).toBe(ingredient.code);
    const receipts = await f
      .api(
        'get',
        `/inventory/movements?ingredientId=${ingredient.id}&kind=RECEIPT&limit=1`,
        f.barista.token,
      )
      .expect(200);
    expect(receipts.body.data).toHaveLength(1);
    expect(receipts.body.meta.limit).toBe(1);
    await f
      .api('get', '/inventory/movements?kind=BOGUS', f.barista.token)
      .expect(400);
    await f.api('get', '/inventory/movements', f.customer.token).expect(403);
    await f.api('get', '/inventory/movements').expect(401);
  });
  it('26 guards inventory and keeps unconfigured items unavailable', async () => {
    await f.api('get', '/inventory/stock').expect(401);
    await f.api('get', '/inventory/stock', f.customer.token).expect(403);
    const product = await f.db.product.create({
      data: {
        name: randomUUID(),
        category: 'Test',
        price: 1,
        stock: 100,
        imageUrl: '/',
      },
    });
    const detail = await f.api('get', `/products/${product.id}`).expect(200);
    expect(detail.body.inStock).toBe(false);
    await f
      .api('post', '/orders', f.customer.token)
      .send({ items: [{ productId: product.id, size: 'S', quantity: 1 }] })
      .expect(409);
  });
  it('30 preserves null-snapshot legacy payment, cancellation and product stock', async () => {
    const { product } = await catalog();
    const legacy = await f.db.order.create({
      data: {
        userId: f.customer.id,
        subtotal: 10000,
        total: 10000,
        items: {
          create: {
            productId: product.id,
            productName: product.name,
            size: 'S',
            qty: 1,
            unitPrice: 10000,
            lineTotal: 10000,
          },
        },
      },
    });
    await pay(legacy.id).expect(201);
    expect(
      await f.db.inventoryReservation.count({ where: { orderId: legacy.id } }),
    ).toBe(0);
    await cancel(legacy.id).expect(200);
    expect(
      (await f.db.product.findUniqueOrThrow({ where: { id: product.id } }))
        .stock,
    ).toBe(778);
  });
  it('serializes preparing versus cancellation and payment versus cancellation', async () => {
    const { product } = await catalog();
    const a = await order(product.id);
    await pay(a).expect(201);
    const results = await Promise.all([status(a), cancel(a)]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    expect(
      await f.db.inventoryMovement.count({
        where: { orderId: a, kind: { in: ['RELEASE', 'CONSUME'] } },
      }),
    ).toBe(1);
    const b = await order(product.id);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(f.app.get(MockPaymentService), 'charge').mockImplementation(
      async () => {
        entered();
        await barrier;
        return { success: true, providerRef: 'TEST' };
      },
    );
    const paying = pay(b).then((r) => r);
    await started;
    try {
      await cancel(b).expect(409);
    } finally {
      release();
    }
    expect((await paying).status).toBe(201);
  });
});
