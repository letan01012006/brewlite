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
  function status(id: number, nextStatus = 'PREPARING') {
    return f
      .api('patch', `/orders/${id}/status`, f.barista.token)
      .send({ status: nextStatus });
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
    const autoIng = await f
      .api('post', '/inventory/ingredients', f.barista.token)
      .send({ name: `Auto Code ${randomUUID()}`, unit: 'GRAM' })
      .expect(201);
    expect(autoIng.body.code).toMatch(/^AUTO_CODE_/);
    expect(autoIng.body.stockQuantity).toBe('0');
    await f
      .api('post', '/inventory/receipts', f.barista.token)
      .set('Idempotency-Key', randomUUID())
      .send({ ingredientId: autoIng.body.id, quantity: '500' })
      .expect(201);
    await f
      .api('post', '/inventory/adjustments', f.barista.token)
      .set('Idempotency-Key', randomUUID())
      .send({ ingredientId: autoIng.body.id, quantity: '50' })
      .expect(400);
    const wastage = await f
      .api('post', '/inventory/adjustments', f.barista.token)
      .set('Idempotency-Key', randomUUID())
      .send({
        ingredientId: autoIng.body.id,
        quantity: '50',
        reason: 'Hao hụt ca tối',
      })
      .expect(201);
    expect(wastage.body.stockDelta).toBe('-50');
    const { ingredient, product: p500 } = await catalog('500');
    const detail500 = await f.api('get', `/products/${p500.id}`).expect(200);
    expect(
      detail500.body.availability.find((a: { size: string }) => a.size === 'S')
        .maxQuantity,
    ).toBe(50);
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
    await f.db.inventoryMovement.create({
      data: {
        eventKey: `legacy-pos-adj:${randomUUID()}`,
        kind: 'ADJUSTMENT',
        ingredientId: ingredient.id,
        unit: 'GRAM',
        stockDelta: 50,
        reservedDelta: 0,
        actorId: f.barista.id,
        reason: 'thêm',
      },
    });
    const posAdj = await f
      .api(
        'get',
        `/inventory/movements?ingredientId=${ingredient.id}&kind=ADJUSTMENT_POSITIVE`,
        f.barista.token,
      )
      .expect(200);
    expect(posAdj.body.meta.total).toBe(1);
    expect(posAdj.body.data[0].stockDelta).toBe('50');
    const negAdj = await f
      .api(
        'get',
        `/inventory/movements?ingredientId=${ingredient.id}&kind=ADJUSTMENT_NEGATIVE`,
        f.barista.token,
      )
      .expect(200);
    expect(negAdj.body.meta.total).toBe(1);
    expect(negAdj.body.data[0].stockDelta).toBe('-1');

    // Toggle product selling status (Đang bán / Tạm dừng) independently of availability & existing orders
    const existingOrderId = await order(p500.id, 1, 'S');
    const paused = await f
      .api('patch', `/products/${p500.id}/status`, f.barista.token)
      .send({ isActive: false })
      .expect(200);
    expect(paused.body.isActive).toBe(false);
    expect(
      paused.body.availability.find((a: { size: string }) => a.size === 'S')
        .maxQuantity,
    ).toBeGreaterThan(0);

    const publicCatalog = await f.api('get', '/products?limit=50').expect(200);
    expect(
      publicCatalog.body.data.some((p: { id: number }) => p.id === p500.id),
    ).toBe(false);
    const baristaCatalog = await f
      .api('get', '/products?limit=50&includeInactive=true')
      .expect(200);
    expect(
      baristaCatalog.body.data.find((p: { id: number }) => p.id === p500.id)
        ?.isActive,
    ).toBe(false);

    await f.api('get', `/products/${p500.id}`).expect(404);
    await f
      .api('post', '/inventory/availability')
      .send({ items: [{ productId: p500.id, size: 'S', quantity: 1 }] })
      .expect(404);
    await f
      .api('post', '/orders', f.customer.token)
      .send({ items: [{ productId: p500.id, size: 'S', quantity: 1 }] })
      .expect(404);

    // Existing order created before pause is unaffected
    await pay(existingOrderId).expect(201);
    await status(existingOrderId).expect(200);

    // Reopen selling
    const reopened = await f
      .api('patch', `/products/${p500.id}/status`, f.barista.token)
      .send({ isActive: true })
      .expect(200);
    expect(reopened.body.isActive).toBe(true);
    await f.api('get', `/products/${p500.id}`).expect(200);

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
  it('31 ingredient pause/reactivate lifecycle: per-size impact, toppings, order block, stock preservation, and paid order fulfillment', async () => {
    // 1. Setup ingredients: Coffee (main), Ice (secondary), ToppingJelly (topping only)
    const coffee = await f.db.ingredient.create({
      data: {
        code: randomUUID(),
        name: 'Coffee ' + randomUUID(),
        unit: 'GRAM',
        stockQuantity: '1000',
      },
    });
    const ice = await f.db.ingredient.create({
      data: {
        code: randomUUID(),
        name: 'Ice ' + randomUUID(),
        unit: 'GRAM',
        stockQuantity: '500',
      },
    });
    const jelly = await f.db.ingredient.create({
      data: {
        code: randomUUID(),
        name: 'Jelly ' + randomUUID(),
        unit: 'GRAM',
        stockQuantity: '300',
      },
    });

    // Product 1: S uses Coffee only (10g). M uses Coffee (20g) + Ice (30g).
    const prod1 = await f.db.product.create({
      data: {
        name: 'Drink 1 ' + randomUUID(),
        category: 'Test',
        price: 20000,
        stock: 100,
        imageUrl: '/test1',
        recipes: {
          create: [
            {
              size: 'S',
              isActive: true,
              ingredients: {
                create: { ingredientId: coffee.id, unit: 'GRAM', quantity: 10 },
              },
            },
            {
              size: 'M',
              isActive: true,
              ingredients: {
                create: [
                  { ingredientId: coffee.id, unit: 'GRAM', quantity: 20 },
                  { ingredientId: ice.id, unit: 'GRAM', quantity: 30 },
                ],
              },
            },
          ],
        },
      },
    });

    // Product 2: S uses Coffee (15g). (Affected when coffee is paused)
    const prod2 = await f.db.product.create({
      data: {
        name: 'Drink 2 ' + randomUUID(),
        category: 'Test',
        price: 25000,
        stock: 100,
        imageUrl: '/test2',
        recipes: {
          create: [
            {
              size: 'S',
              isActive: true,
              ingredients: {
                create: { ingredientId: coffee.id, unit: 'GRAM', quantity: 15 },
              },
            },
          ],
        },
      },
    });

    // Topping linked to jelly ingredient
    const topping = await f.db.topping.create({
      data: {
        name: 'Thạch ' + randomUUID(),
        price: 5000,
        ingredientId: jelly.id,
        quantityPerServing: 20,
        products: { connect: [{ id: prod1.id }] },
      },
    });

    // 2. Pre-create an order for Prod1 Size M before pausing Ice, and pay it (hold inventory)
    const preOrderId = await order(prod1.id, 1, 'M');
    await pay(preOrderId).expect(201);
    const iceBefore = await f.db.ingredient.findUnique({ where: { id: ice.id } });
    expect(Number(iceBefore?.reservedQuantity)).toBe(30);

    // 3. Pause ICE via Barista API
    const pauseIceRes = await f
      .api('patch', `/inventory/ingredients/${ice.id}`, f.barista.token)
      .send({ isActive: false })
      .expect(200);
    expect(pauseIceRes.body.isActive).toBe(false);

    // Stock & reserved quantities must NOT change when toggling status
    const iceAfterPause = await f.db.ingredient.findUnique({ where: { id: ice.id } });
    expect(iceAfterPause?.stockQuantity.toString()).toBe('500');
    expect(Number(iceAfterPause?.reservedQuantity)).toBe(30);

    // 4. Check Product 1 availability:
    // Size S (uses coffee only) -> still available!
    // Size M (uses ice) -> INGREDIENT_PAUSED!
    const avail1 = await f.api('get', `/products/${prod1.id}`).expect(200);
    const sizeS = avail1.body.availability.find((a: { size: string }) => a.size === 'S');
    const sizeM = avail1.body.availability.find((a: { size: string }) => a.size === 'M');
    expect(sizeS.reason).toBeNull();
    expect(sizeS.maxQuantity).toBeGreaterThan(0);
    expect(sizeM.reason).toBe('INGREDIENT_PAUSED');
    expect(sizeM.maxQuantity).toBe(0);
    // Product 1 still inStock because size S is sellable
    expect(avail1.body.inStock).toBe(true);

    // Product 2 is completely unaffected by Ice pause
    const avail2 = await f.api('get', `/products/${prod2.id}`).expect(200);
    const prod2SizeS = avail2.body.availability.find((a: { size: string }) => a.size === 'S');
    expect(prod2SizeS.reason).toBeNull();
    expect(prod2SizeS.maxQuantity).toBeGreaterThan(0);

    // 5. Attempt to create order for Size M directly via backend -> Rejected with 409 INGREDIENT_PAUSED
    const errOrderM = await f
      .api('post', '/orders', f.customer.token)
      .send({ items: [{ productId: prod1.id, quantity: 1, size: 'M' }] })
      .expect(409);
    expect(errOrderM.body.code).toBe('INGREDIENT_PAUSED');

    // But order for Size S succeeds!
    const orderSId = await order(prod1.id, 1, 'S');
    expect(orderSId).toBeGreaterThan(0);

    // 6. Test Topping ingredient pause:
    await f
      .api('patch', `/inventory/ingredients/${jelly.id}`, f.barista.token)
      .send({ isActive: false })
      .expect(200);

    // Order with paused topping -> Rejected with 409 INGREDIENT_PAUSED
    const errToppingOrder = await f
      .api('post', '/orders', f.customer.token)
      .send({
        items: [
          { productId: prod1.id, quantity: 1, size: 'S', toppingIds: [topping.id] },
        ],
      })
      .expect(409);
    expect(errToppingOrder.body.code).toBe('INGREDIENT_PAUSED');

    // 7. Verify pre-existing paid order (preOrderId) can be finished/consumed without error!
    await status(preOrderId, 'PREPARING').expect(200);
    const iceConsumed = await f.db.ingredient.findUnique({ where: { id: ice.id } });
    expect(Number(iceConsumed?.reservedQuantity)).toBe(0);
    expect(Number(iceConsumed?.stockQuantity)).toBe(470); // 500 - 30

    // 8. Multiple products affected when Coffee is paused
    await f
      .api('patch', `/inventory/ingredients/${coffee.id}`, f.barista.token)
      .send({ isActive: false })
      .expect(200);

    // Now both Prod 1 (all configured sizes S & M) and Prod 2 (size S) have INGREDIENT_PAUSED
    const p1Avail = await f.api('get', `/products/${prod1.id}`).expect(200);
    expect(p1Avail.body.inStock).toBe(false);
    expect(
      p1Avail.body.availability
        .filter((a: { size: string }) => a.size === 'S' || a.size === 'M')
        .every((a: { reason: string }) => a.reason === 'INGREDIENT_PAUSED'),
    ).toBe(true);

    const p2Avail = await f.api('get', `/products/${prod2.id}`).expect(200);
    expect(p2Avail.body.inStock).toBe(false);
    expect(
      p2Avail.body.availability.find((a: { size: string }) => a.size === 'S').reason,
    ).toBe('INGREDIENT_PAUSED');

    // 9. Reactivate Coffee and Ice -> availability recalculates based on remaining stock
    await f
      .api('patch', `/inventory/ingredients/${coffee.id}`, f.barista.token)
      .send({ isActive: true })
      .expect(200);
    await f
      .api('patch', `/inventory/ingredients/${ice.id}`, f.barista.token)
      .send({ isActive: true })
      .expect(200);

    const restoredAvail = await f.api('get', `/products/${prod1.id}`).expect(200);
    expect(restoredAvail.body.inStock).toBe(true);
    expect(
      restoredAvail.body.availability.find((a: { size: string }) => a.size === 'S').reason,
    ).toBeNull();
    expect(
      restoredAvail.body.availability.find((a: { size: string }) => a.size === 'M').reason,
    ).toBeNull();
  });
});
