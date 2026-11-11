import { randomUUID } from 'node:crypto';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { databaseFixture, type DatabaseFixture } from './database-fixture.js';
import { PricingService } from '../src/common/pricing/pricing.service.js';

describe('Order creation idempotency: PostgreSQL and HTTP', () => {
  let f: DatabaseFixture;
  beforeAll(async () => {
    f = await databaseFixture();
  }, 35000);
  afterAll(async () => {
    await f?.close();
  });
  afterEach(() => vi.restoreAllMocks());

  async function catalog(usageLimit = 1) {
    const ingredient = await f.db.ingredient.create({
      data: {
        code: randomUUID(),
        name: randomUUID(),
        unit: 'GRAM',
        stockQuantity: '1000',
      },
    });
    const product = await f.db.product.create({
      data: {
        name: randomUUID(),
        category: 'Test',
        imageUrl: '/test',
        price: 50000,
        recipes: {
          create: {
            size: 'S',
            isActive: true,
            ingredients: {
              create: {
                ingredientId: ingredient.id,
                unit: 'GRAM',
                quantity: '20',
              },
            },
          },
        },
      },
    });
    const promo = await f.db.promoCode.create({
      data: {
        code: randomUUID().toUpperCase(),
        type: 'FIXED',
        value: 5000,
        usageLimit,
        startsAt: new Date('2020-01-01'),
        expiresAt: new Date('2099-01-01'),
      },
    });
    return {
      product,
      ingredient,
      promo,
      body: {
        items: [{ productId: product.id, size: 'S', quantity: 1 }],
        promoCode: promo.code,
      },
    };
  }
  function post(body: object, key?: string, token = f.customer.token) {
    const req = f.api('post', '/orders', token).send(body);
    return key === undefined ? req : req.set('Idempotency-Key', key);
  }
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  async function expectOneOrder(promoId: number, orderId: number) {
    expect(
      await f.db.order.count({ where: { promotion: { id: promoId } } }),
    ).toBe(1);
    expect(
      (await f.db.promoCode.findUniqueOrThrow({ where: { id: promoId } }))
        .usedCount,
    ).toBe(1);
    expect(await f.db.orderItem.count({ where: { orderId } })).toBe(1);
    expect(await f.db.inventoryReservation.count({ where: { orderId } })).toBe(
      0,
    );
  }

  it('replays the same order even after the voucher is exhausted and the catalog changes', async () => {
    const { body, promo, ingredient, product } = await catalog();
    const key = randomUUID();
    const first = await post(body, key).expect(201);
    await f.db.ingredient.update({
      where: { id: ingredient.id },
      data: { stockQuantity: '0' },
    });
    await f.db.product.update({
      where: { id: product.id },
      data: { price: 99999 },
    });
    await f.db.promoCode.update({
      where: { id: promo.id },
      data: { isActive: false },
    });
    const replay = await post(
      { promoCode: body.promoCode, items: body.items },
      key,
    ).expect(201);
    expect(replay.body).toEqual(first.body);
    await expectOneOrder(promo.id, first.body.id);
  });

  it.each([false, true])(
    'unique DB claim serializes concurrent requests before the last voucher slot (changed body: %s)',
    async (changed) => {
      const { body, promo } = await catalog();
      const key = randomUUID();
      const entered = deferred(),
        release = deferred();
      const pricing = f.app.get(PricingService);
      const calculate = pricing.calculate.bind(pricing);
      const spy = vi
        .spyOn(pricing, 'calculate')
        .mockImplementationOnce(async (...args) => {
          entered.resolve();
          await release.promise;
          return calculate(...args);
        });
      const first = post(body, key).then((response) => response);
      let second: typeof first | undefined;
      try {
        await entered.promise;
        second = post(
          changed
            ? { ...body, items: [{ ...body.items[0], quantity: 2 }] }
            : body,
          key,
        ).then((response) => response);
        // Prove the second INSERT is waiting on PostgreSQL's unique index,
        // rather than merely sending two sequential requests.
        await expect
          .poll(
            async () => {
              const [row] = await f.db.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE application_name = ${f.schema} AND wait_event_type = 'Lock'`;
              return row.count;
            },
            { timeout: 3000, interval: 20 },
          )
          .toBeGreaterThanOrEqual(1);
      } finally {
        release.resolve();
      }
      const [one, two] = await Promise.all([first, second!]);
      expect(one.status).toBe(201);
      expect(two.status).toBe(changed ? 409 : 201);
      if (changed) expect(two.body.code).toBe('ORDER_IDEMPOTENCY_KEY_REUSED');
      else expect(two.body.code).toBe(one.body.code);
      expect(spy).toHaveBeenCalledTimes(1);
      await expectOneOrder(promo.id, one.body.id);
    },
  );

  it('returns 409 for reused keys with another quantity, note or voucher', async () => {
    const { body, promo } = await catalog();
    const key = randomUUID();
    const first = await post(body, key).expect(201);
    for (const changed of [
      { ...body, items: [{ ...body.items[0], quantity: 2 }] },
      { ...body, items: [{ ...body.items[0], note: 'Different note' }] },
      { ...body, promoCode: 'ANOTHER_VOUCHER' },
    ]) {
      const response = await post(changed, key).expect(409);
      expect(response.body.code).toBe('ORDER_IDEMPOTENCY_KEY_REUSED');
    }
    await expectOneOrder(promo.id, first.body.id);
  });

  it('retries a real HTTP timeout with the same key while the first transaction is still running', async () => {
    const { body, promo } = await catalog();
    const key = randomUUID();
    const entered = deferred(),
      release = deferred();
    const pricing = f.app.get(PricingService),
      calculate = pricing.calculate.bind(pricing);
    const spy = vi
      .spyOn(pricing, 'calculate')
      .mockImplementationOnce(async (...args) => {
        entered.resolve();
        await release.promise;
        return calculate(...args);
      });
    const lost = post(body, key)
      .timeout({ response: 150, deadline: 300 })
      .then(
        () => null,
        (error) => error,
      );
    try {
      await entered.promise;
      expect((await lost)?.timeout).toBeGreaterThan(0);
    } finally {
      release.resolve();
    }
    const retry = await post(body, key).expect(201);
    const again = await post(body, key).expect(201);
    expect(again.body.code).toBe(retry.body.code);
    expect(spy).toHaveBeenCalledTimes(1);
    await expectOneOrder(promo.id, retry.body.id);
  });

  it('scopes keys to each account and keeps legacy requests without headers compatible', async () => {
    const { body, promo } = await catalog(4);
    const other = await f.user();
    const key = randomUUID();
    const responses = await Promise.all([
      post(body, key),
      post(body, key, other.token),
      post(body),
      post(body),
    ]);
    expect(responses.map((response) => response.status)).toEqual([
      201, 201, 201, 201,
    ]);
    expect(new Set(responses.map((response) => response.body.id)).size).toBe(4);
    expect(
      (await f.db.promoCode.findUniqueOrThrow({ where: { id: promo.id } }))
        .usedCount,
    ).toBe(4);
  });

  it('rolls the key claim back with a rejected voucher so the request can be corrected', async () => {
    const { body, promo } = await catalog(0);
    const key = randomUUID();
    await post(body, key).expect(422);
    expect(
      await f.db.order.count({
        where: { userId: f.customer.id, creationKey: key },
      }),
    ).toBe(0);
    await f.db.promoCode.update({
      where: { id: promo.id },
      data: { usageLimit: 1 },
    });
    const accepted = await post(body, key).expect(201);
    await expectOneOrder(promo.id, accepted.body.id);
  });

  it('the DB unique constraint rejects duplicate identities independently of the HTTP handler', async () => {
    const { body } = await catalog();
    const key = randomUUID();
    const created = await post(body, key).expect(201);
    const original = await f.db.order.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    await expect(
      f.db.order.create({
        data: {
          userId: f.customer.id,
          creationKey: key,
          creationRequestHash: original.creationRequestHash,
          subtotal: 0,
          total: 0,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
