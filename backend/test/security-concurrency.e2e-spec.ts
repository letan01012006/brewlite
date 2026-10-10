import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request, { type Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { MockPaymentService } from '../src/payments/mock-payment.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Opt in explicitly. Every run creates and removes only its own isolated schema.
const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `brewlite_test_${randomUUID().replaceAll('-', '')}`;

function deferred() {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe.skipIf(!databaseUrl)(
  'BrewLite business rules and authorization (PostgreSQL)',
  () => {
    let admin: PrismaClient;
    let db: PrismaClient;
    let app: INestApplication;
    let gateway: MockPaymentService;
    let schemaCreated = false;
    let userId: number;
    let customerToken: string;
    let otherToken: string;
    let baristaToken: string;

    beforeAll(async () => {
      admin = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
      });
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      schemaCreated = true;
      db = new PrismaClient({
        adapter: new PrismaPg(
          {
            connectionString: databaseUrl,
            max: 20,
            application_name: schema,
            options: `-c search_path=${schema}`,
          },
          { schema },
        ),
      });
      const [namespace] = await db.$queryRaw<
        Array<{ name: string }>
      >`SELECT current_schema() AS name`;
      expect(namespace.name).toBe(schema);
      const migrations = resolve('prisma/migrations');
      for (const entry of (
        await readdir(migrations, { withFileTypes: true })
      ).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory()) continue;
        const sql = await readFile(
          resolve(migrations, entry.name, 'migration.sql'),
          'utf8',
        );
        for (const statement of sql.split(';').filter((part) => part.trim())) {
          await db.$executeRawUnsafe(statement);
        }
      }
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(db)
        .compile();
      app = module.createNestApplication();
      configureApp(app);
      await app.init();
      gateway = app.get(MockPaymentService);
    }, 30000);

    afterAll(async () => {
      await app?.close();
      await db?.$disconnect();
      try {
        if (schemaCreated)
          await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await admin?.$disconnect();
      }
    });

    beforeEach(async () => {
      vi.restoreAllMocks();
      const users = await Promise.all(
        ['CUSTOMER', 'CUSTOMER', 'BARISTA'].map((role) =>
          db.user.create({
            data: {
              email: `${randomUUID()}@test.example`,
              fullName: 'Test User',
              passwordHash: 'unused',
              role: role as 'CUSTOMER' | 'BARISTA',
              loyaltyPoints: 500,
            },
          }),
        ),
      );
      userId = users[0].id;
      [customerToken, otherToken, baristaToken] = users.map((user) =>
        app.get(JwtService).sign({
          sub: user.id,
          email: user.email,
          role: user.role,
        }),
      );
    });

    function post(path: string, token?: string, body: object = {}) {
      const call = request(app.getHttpServer()).post(`/api${path}`).send(body);
      return token ? call.auth(token, { type: 'bearer' }) : call;
    }

    function createProduct(stock = 10, price = 35000) {
      return db.product.create({
        data: {
          name: randomUUID(),
          category: 'Coffee',
          price,
          stock,
          imageUrl: '/test.jpg',
        },
      });
    }

    async function fixture(withPromo = false) {
      const product = await createProduct();
      const promo = withPromo
        ? await db.promoCode.create({
            data: {
              code: randomUUID().toUpperCase(),
              type: 'FIXED',
              value: 1000,
              usedCount: 5,
              startsAt: new Date('2020-01-01'),
              expiresAt: new Date('2099-01-01'),
            },
          })
        : undefined;
      const response = await post('/orders', customerToken, {
        items: [{ productId: product.id, size: 'S', quantity: 1 }],
        ...(promo ? { promoCode: promo.code } : {}),
      }).expect(201);
      return { product, promo, orderId: response.body.id as number };
    }

    function pay(
      orderId: number,
      token = customerToken,
      key = randomUUID(),
      mockResult = 'SUCCESS',
    ) {
      return post('/payments', token, {
        orderId,
        method: 'WALLET',
        mockResult,
      }).set('Idempotency-Key', key);
    }

    function prepare(orderId: number) {
      return request(app.getHttpServer())
        .patch(`/api/orders/${orderId}/status`)
        .auth(baristaToken, { type: 'bearer' })
        .send({ status: 'PREPARING' });
    }

    // Queue actual requests behind a real row lock. Wait for PostgreSQL to report
    // each blocked connection, so the race is reproducible without fixed sleeps.
    async function queuedRace(
      orderId: number,
      operations: Array<() => PromiseLike<Response>>,
      target: 'Order' | 'Product' | 'PromoCode' | 'PaymentTable' = 'Order',
    ) {
      const locked = deferred();
      const release = deferred();
      const blocker = db.$transaction(
        async (tx) => {
          if (target === 'Product') {
            await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${orderId} FOR UPDATE`;
          } else if (target === 'PromoCode') {
            await tx.$queryRaw`SELECT "id" FROM "PromoCode" WHERE "id" = ${orderId} FOR UPDATE`;
          } else if (target === 'PaymentTable') {
            await tx.$executeRaw`LOCK TABLE "Payment" IN SHARE MODE`;
          } else {
            await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
          }
          locked.resolve();
          await release.promise;
        },
        { timeout: 15000 },
      );
      const running: Promise<Response>[] = [];
      try {
        await Promise.race([locked.promise, blocker]);
        for (const operation of operations) {
          running.push(Promise.resolve(operation()));
          await expect
            .poll(
              async () => {
                const [row] = await admin.$queryRaw<Array<{ count: number }>>`
            SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE application_name = ${schema} AND wait_event_type = 'Lock'
          `;
                return row.count;
              },
              { timeout: 5000, interval: 20 },
            )
            .toBeGreaterThanOrEqual(running.length);
        }
      } finally {
        release.resolve();
        await blocker;
        await Promise.allSettled(running);
      }
      return Promise.all(running);
    }

    it.each(['/products', '/toppings'])(
      '%s creation requires BARISTA, while its menu stays public',
      async (path) => {
        const body = {
          name: randomUUID(),
          price: 5000,
          ...(path === '/products' ? { category: 'Coffee' } : {}),
        };
        await post(path, undefined, body).expect(401);
        await post(path, customerToken, body).expect(403);
        await post(path, baristaToken, body).expect(201);
        await request(app.getHttpServer()).get(`/api${path}`).expect(200);
      },
    );

    it('active kitchen orders require BARISTA and include more than 50 old unfinished orders', async () => {
      await request(app.getHttpServer()).get('/api/orders/active').expect(401);
      await request(app.getHttpServer()).get('/api/orders/active')
        .auth(customerToken, { type: 'bearer' }).expect(403);
      const active = await db.order.createManyAndReturn({
        data: Array.from({ length: 63 }, (_, index) => ({
          userId, subtotal: 35000, total: 35000,
          status: (['PAID', 'PREPARING', 'READY'] as const)[index % 3],
          createdAt: new Date('2001-01-01'),
        })),
      });
      const history = await db.order.createManyAndReturn({
        data: Array.from({ length: 65 }, (_, index) => ({
          userId, subtotal: 35000, total: 35000,
          status: (['PENDING', 'PAYMENT_FAILED', 'COMPLETED', 'CANCELLED'] as const)[index % 4],
          createdAt: new Date('2099-01-01'),
        })),
      });
      const result = await request(app.getHttpServer()).get('/api/orders/active')
        .auth(baristaToken, { type: 'bearer' }).expect(200);
      const rows = result.body as Array<{ id: number; status: string; user: Record<string, unknown>; items: unknown[] }>;
      const ids = rows.map((row) => row.id);
      expect(ids).toEqual(expect.arrayContaining(active.map((row) => row.id)));
      expect(ids.filter((id) => history.some((row) => row.id === id))).toEqual([]);
      expect(rows.every((row) => ['PAID', 'PREPARING', 'READY'].includes(row.status))).toBe(true);
      expect(rows[0].user).not.toHaveProperty('passwordHash');
      expect(rows[0].items).toBeInstanceOf(Array);
      const activeIds = new Set(active.map((row) => row.id));
      const ownIds = ids.filter((id) => activeIds.has(id));
      expect(ownIds).toEqual([...ownIds].sort((a, b) => a - b));
      // Equal timestamps must not cause duplicates across history pages.
      const first = await request(app.getHttpServer()).get('/api/orders?limit=50&page=1')
        .auth(baristaToken, { type: 'bearer' }).expect(200);
      const second = await request(app.getHttpServer()).get('/api/orders?limit=50&page=2')
        .auth(baristaToken, { type: 'bearer' }).expect(200);
      const firstIds = new Set((first.body.data as Array<{ id: number }>).map((row) => row.id));
      expect((second.body.data as Array<{ id: number }>).some((row) => firstIds.has(row.id))).toBe(false);
    });

    it('customer history pages include older orders without ties or other customers', async () => {
      const created = await db.order.createManyAndReturn({
        data: Array.from({ length: 25 }, () => ({
          userId, subtotal: 35000, total: 35000,
          createdAt: new Date('2025-01-01'),
        })),
      });
      const expectedIds = created.map((order) => order.id).sort((a, b) => b - a);
      for (const page of [1, 2]) {
        const result = await request(app.getHttpServer()).get(`/api/orders/me?limit=20&page=${page}`)
          .auth(customerToken, { type: 'bearer' }).expect(200);
        expect(result.body.meta.total).toBe(25);
        expect(result.body.meta.totalPages).toBe(2);
        expect((result.body.data as Array<{ id: number }>).map((order) => order.id))
          .toEqual(expectedIds.slice((page - 1) * 20, page * 20));
      }
      const other = await request(app.getHttpServer()).get('/api/orders/me?limit=20&page=1')
        .auth(otherToken, { type: 'bearer' }).expect(200);
      expect(other.body.data).toEqual([]);
    });

    it('promotion validation requires JWT and still accepts a customer', async () => {
      const { product, promo } = await fixture(true);
      const body = {
        code: promo!.code,
        items: [{ productId: product.id, size: 'S', quantity: 1 }],
      };
      await post('/promotions/validate', undefined, body).expect(401);
      await post('/promotions/validate', customerToken, body).expect(200);
      await request(app.getHttpServer())
        .get(`/api/products/${product.id}`)
        .expect(200);
    });

    it.each(['SUCCESS', 'FAILED'])(
      'rejects another user replaying a %s payment',
      async (result) => {
        const { orderId } = await fixture();
        const key = randomUUID();
        const charge = vi.spyOn(gateway, 'charge');
        const first = await pay(orderId, customerToken, key, result).expect(
          result === 'SUCCESS' ? 201 : 402,
        );
        for (const token of [otherToken, baristaToken]) {
          const forbidden = await pay(orderId, token, key, result).expect(422);
          expect(forbidden.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
          expect(forbidden.body).not.toHaveProperty('payment');
          expect(forbidden.body).not.toHaveProperty('order');
        }
        const replay = await pay(orderId, customerToken, key, result).expect(
          first.status,
        );
        expect(replay.body).toEqual(first.body);
        expect(replay.headers['idempotent-replayed']).toBe('true');
        if (result === 'FAILED') {
          expect(replay.body).toMatchObject({
            code: 'PAYMENT_FAILED',
            statusCode: 402,
            order: { id: orderId, status: 'PAYMENT_FAILED' },
            path: '/api/payments',
            timestamp: expect.any(String),
          });
        }
        expect(charge).toHaveBeenCalledTimes(1);
        expect(await db.payment.count({ where: { orderId } })).toBe(1);
      },
    );

    it.each([true, false])(
      'rejects foreign PROCESSING replay and cancellation during payment (success: %s)',
      async (success) => {
        const { orderId, product } = await fixture();
        const key = randomUUID();
        const started = deferred();
        const finish = deferred();
        const charge = vi
          .spyOn(gateway, 'charge')
          .mockImplementationOnce(async () => {
            started.resolve();
            await finish.promise;
            return success
              ? { success: true, providerRef: 'TEST-GATEWAY' }
              : { success: false, failureReason: 'TEST-DECLINED' };
          });
        const payment = pay(orderId, customerToken, key).then(
          (response) => response,
        );
        try {
          await Promise.race([started.promise, payment]);
          const replay = await pay(orderId, otherToken, key).expect(422);
          expect(replay.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
          const cancellation = await post(
            `/orders/${orderId}/cancel`,
            customerToken,
          ).expect(409);
          expect(cancellation.body.code).toBe('PAYMENT_IN_PROGRESS');
        } finally {
          finish.resolve();
          await payment;
        }
        expect((await payment).status).toBe(success ? 201 : 402);
        expect(charge).toHaveBeenCalledTimes(1);
        expect(
          (await db.order.findUniqueOrThrow({ where: { id: orderId } })).status,
        ).toBe(success ? 'PAID' : 'PAYMENT_FAILED');
        expect(
          (await db.product.findUniqueOrThrow({ where: { id: product.id } }))
            .stock,
        ).toBe(9);
        expect(
          (await db.user.findUniqueOrThrow({ where: { id: userId } }))
            .loyaltyPoints,
        ).toBe(success ? 535 : 500);
      },
    );

    it('preserves ownership checks and the BARISTA-only status route', async () => {
      const { orderId } = await fixture();
      await post(`/orders/${orderId}/cancel`, otherToken).expect(403);
      await pay(orderId, otherToken).expect(403);
      await request(app.getHttpServer())
        .patch(`/api/orders/${orderId}/status`)
        .auth(customerToken, { type: 'bearer' })
        .send({ status: 'PREPARING' })
        .expect(403);
      expect(
        (await db.order.findUniqueOrThrow({ where: { id: orderId } })).status,
      ).toBe('PENDING');
      expect(await db.payment.count({ where: { orderId } })).toBe(0);
    });

    it('restores stock only once for simultaneous PENDING cancellations', async () => {
      const { orderId, product } = await fixture();
      const results = await queuedRace(orderId, [
        () => post(`/orders/${orderId}/cancel`, customerToken),
        () => post(`/orders/${orderId}/cancel`, customerToken),
      ]);
      expect(results.map((response) => response.status)).toEqual([200, 409]);
      expect(results[1].body.code).toBe('INVALID_TRANSITION');
      expect(
        (await db.product.findUniqueOrThrow({ where: { id: product.id } }))
          .stock,
      ).toBe(10);
    });

    it('reverses stock, promo usage, points and payment only once for simultaneous PAID cancellations', async () => {
      const { orderId, product, promo } = await fixture(true);
      await pay(orderId).expect(201);
      const results = await queuedRace(orderId, [
        () => post(`/orders/${orderId}/cancel`, customerToken),
        () => post(`/orders/${orderId}/cancel`, baristaToken),
      ]);
      expect(results.map((response) => response.status)).toEqual([200, 409]);
      expect(
        (await db.product.findUniqueOrThrow({ where: { id: product.id } }))
          .stock,
      ).toBe(10);
      expect(
        (await db.promoCode.findUniqueOrThrow({ where: { id: promo!.id } }))
          .usedCount,
      ).toBe(5);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: userId } }))
          .loyaltyPoints,
      ).toBe(500);
      expect(
        (await db.loyaltyTransaction.findUniqueOrThrow({ where: { orderId } }))
          .reversedAt,
      ).not.toBeNull();
      const payment = await db.payment.findFirstOrThrow({ where: { orderId } });
      expect(payment.refundedAmount).toBe(payment.amount);
      expect(payment.refundedAt).not.toBeNull();
    });

    it('does not call the gateway when cancellation wins the race with payment', async () => {
      const { orderId, product } = await fixture();
      const charge = vi.spyOn(gateway, 'charge');
      const results = await queuedRace(orderId, [
        () => post(`/orders/${orderId}/cancel`, customerToken),
        () => pay(orderId),
      ]);
      expect(results.map((response) => response.status)).toEqual([200, 409]);
      expect(charge).not.toHaveBeenCalled();
      expect(await db.payment.count({ where: { orderId } })).toBe(0);
      expect(
        (await db.order.findUniqueOrThrow({ where: { id: orderId } })).status,
      ).toBe('CANCELLED');
      expect(
        (await db.product.findUniqueOrThrow({ where: { id: product.id } }))
          .stock,
      ).toBe(10);
    });

    it.each([true, false])(
      'keeps cancellation and barista preparation consistent (cancel first: %s)',
      async (cancelFirst) => {
        const { orderId, product } = await fixture();
        await pay(orderId).expect(201);
        const cancel = () => post(`/orders/${orderId}/cancel`, customerToken);
        const prep = () => prepare(orderId);
        const results = await queuedRace(
          orderId,
          cancelFirst ? [cancel, prep] : [prep, cancel],
        );
        expect(results.map((response) => response.status)).toEqual([200, 409]);
        expect(results[1].body.code).toBe('INVALID_TRANSITION');
        expect(
          (await db.order.findUniqueOrThrow({ where: { id: orderId } })).status,
        ).toBe(cancelFirst ? 'CANCELLED' : 'PREPARING');
        expect(
          (await db.product.findUniqueOrThrow({ where: { id: product.id } }))
            .stock,
        ).toBe(cancelFirst ? 10 : 9);
        expect(
          (await db.user.findUniqueOrThrow({ where: { id: userId } }))
            .loyaltyPoints,
        ).toBe(cancelFirst ? 500 : 535);
        const payment = await db.payment.findFirstOrThrow({
          where: { orderId },
        });
        expect(payment.refundedAmount).toBe(cancelFirst ? payment.amount : 0);
      },
    );

    it('can fail payment repeatedly and then succeed without duplicating loyalty points', async () => {
      const { orderId } = await fixture();
      await pay(orderId, customerToken, randomUUID(), 'FAILED').expect(402);
      await pay(orderId, customerToken, randomUUID(), 'FAILED').expect(402);
      await pay(orderId).expect(201);
      expect(await db.loyaltyTransaction.count({ where: { orderId } })).toBe(1);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: userId } }))
          .loyaltyPoints,
      ).toBe(535);
    });

    it.each([5, 10])(
      'handles 10 simultaneous orders against stock %i',
      async (stock) => {
        const product = await createProduct(stock);
        const users = await Promise.all(
          Array.from({ length: 10 }, () =>
            db.user.create({
              data: {
                email: `${randomUUID()}@test.example`,
                fullName: 'Stock Test',
                passwordHash: 'unused',
              },
            }),
          ),
        );
        const tokens = users.map((user) =>
          app
            .get(JwtService)
            .sign({ sub: user.id, email: user.email, role: user.role }),
        );
        const results = await queuedRace(
          product.id,
          tokens.map(
            (token) => () =>
              post('/orders', token, {
                items: [{ productId: product.id, size: 'S', quantity: 1 }],
              }),
          ),
          'Product',
        );
        expect(results.filter((r) => r.status === 201)).toHaveLength(stock);
        const failures = results.filter((r) => r.status !== 201);
        expect(failures).toHaveLength(10 - stock);
        for (const failure of failures) {
          expect(failure.status).toBe(409);
          expect(failure.body.code).toBe('OUT_OF_STOCK');
        }
        const saved = await db.product.findUniqueOrThrow({
          where: { id: product.id },
        });
        expect(saved.stock).toBe(0);
        expect(saved.version).toBe(stock);
        expect(
          await db.order.count({
            where: { items: { some: { productId: product.id } } },
          }),
        ).toBe(stock);
      },
      15000,
    );

    it('rolls back the entire basket when its second product is out of stock', async () => {
      const first = await createProduct(10);
      const second = await createProduct(0);
      const result = await post('/orders', customerToken, {
        items: [
          { productId: first.id, size: 'S', quantity: 2 },
          { productId: second.id, size: 'S', quantity: 1 },
        ],
      }).expect(409);
      expect(result.body.code).toBe('OUT_OF_STOCK');
      expect(
        await db.product.findUniqueOrThrow({ where: { id: first.id } }),
      ).toMatchObject({ stock: 10, version: 0 });
      expect(await db.order.count({ where: { userId } })).toBe(0);
      expect(await db.orderItem.count({ where: { productId: first.id } })).toBe(
        0,
      );
    });

    it('rolls back and reprices the whole basket after a version conflict on its second product', async () => {
      const first = await createProduct();
      const second = await createProduct();
      const locked = deferred();
      const release = deferred();
      const blocker = db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${second.id} FOR UPDATE`;
          locked.resolve();
          await release.promise;
          await tx.product.update({
            where: { id: second.id },
            data: { price: 36000, version: { increment: 1 } },
          });
        },
        { timeout: 15000 },
      );
      let pending: Promise<Response> | undefined;
      try {
        await Promise.race([locked.promise, blocker]);
        pending = post('/orders', customerToken, {
          items: [
            { productId: first.id, size: 'S', quantity: 1 },
            { productId: second.id, size: 'S', quantity: 1 },
          ],
        }).then((response) => response);
        await expect
          .poll(
            async () => {
              const [row] = await admin.$queryRaw<Array<{ count: number }>>`
            SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE application_name = ${schema} AND wait_event_type = 'Lock'
          `;
              return row.count;
            },
            { timeout: 5000, interval: 20 },
          )
          .toBe(1);
      } finally {
        release.resolve();
        await blocker;
        await pending;
      }
      const response = await pending!;
      expect(response.status).toBe(201);
      expect(response.body.total).toBe(71000);
      expect(
        await db.product.findUniqueOrThrow({ where: { id: first.id } }),
      ).toMatchObject({ stock: 9, version: 1 });
      expect(
        await db.product.findUniqueOrThrow({ where: { id: second.id } }),
      ).toMatchObject({ stock: 9, version: 2 });
      expect(await db.order.count({ where: { userId } })).toBe(1);
      expect(
        await db.orderItem.count({ where: { orderId: response.body.id } }),
      ).toBe(2);
    });

    it('reserves the last promotion use once and rolls back the losing basket', async () => {
      const products = await Promise.all([createProduct(), createProduct()]);
      const promo = await db.promoCode.create({
        data: {
          code: randomUUID().toUpperCase(),
          type: 'FIXED',
          value: 1000,
          usageLimit: 1,
          startsAt: new Date('2020-01-01'),
          expiresAt: new Date('2099-01-01'),
        },
      });
      const results = await queuedRace(
        promo.id,
        products.map(
          (product) => () =>
            post('/orders', customerToken, {
              items: [{ productId: product.id, size: 'S', quantity: 1 }],
              promoCode: promo.code,
            }),
        ),
        'PromoCode',
      );
      expect(results.map((r) => r.status)).toEqual([201, 422]);
      expect(results[1].body.code).toBe('PROMO_USAGE_EXCEEDED');
      expect(
        (await db.promoCode.findUniqueOrThrow({ where: { id: promo.id } }))
          .usedCount,
      ).toBe(1);
      expect(
        (await db.product.findUniqueOrThrow({ where: { id: products[0].id } }))
          .stock,
      ).toBe(9);
      expect(
        await db.product.findUniqueOrThrow({ where: { id: products[1].id } }),
      ).toMatchObject({ stock: 10, version: 0 });
      expect(await db.order.count({ where: { userId } })).toBe(1);
      expect(
        await db.orderItem.count({ where: { productId: products[1].id } }),
      ).toBe(0);
    });

    it.each([0, 1000, null])(
      'applies a percent discount cap of %s consistently in preview and order',
      async (maxDiscount) => {
        const product = await createProduct();
        const promo = await db.promoCode.create({
          data: {
            code: randomUUID().toUpperCase(),
            type: 'PERCENT',
            value: 10,
            maxDiscount,
            startsAt: new Date('2020-01-01'),
            expiresAt: new Date('2099-01-01'),
          },
        });
        const items = [{ productId: product.id, size: 'S', quantity: 1 }];
        const preview = await post('/promotions/validate', customerToken, {
          code: promo.code,
          items,
        }).expect(200);
        expect(
          (await db.promoCode.findUniqueOrThrow({ where: { id: promo.id } }))
            .usedCount,
        ).toBe(0);
        const order = await post('/orders', customerToken, {
          promoCode: promo.code,
          items,
        }).expect(201);
        const expected = maxDiscount ?? 3500;
        expect(order.body.discountAmount).toBe(expected);
        expect(preview.body.discountAmount).toBe(expected);
        expect(order.body.total).toBe(35000 - expected);
        expect(preview.body.totalAfterDiscount).toBe(order.body.total);
      },
    );

    it('rejects an expired promotion without retaining stock or creating an order', async () => {
      const product = await createProduct();
      const promo = await db.promoCode.create({
        data: {
          code: randomUUID().toUpperCase(),
          type: 'FIXED',
          value: 1000,
          startsAt: new Date('2000-01-01'),
          expiresAt: new Date('2001-01-01'),
        },
      });
      const items = [{ productId: product.id, size: 'S', quantity: 1 }];
      const preview = await post('/promotions/validate', customerToken, {
        code: promo.code,
        items,
      }).expect(422);
      const order = await post('/orders', customerToken, {
        promoCode: promo.code,
        items,
      }).expect(422);
      expect(preview.body.code).toBe('PROMO_EXPIRED');
      expect(order.body.code).toBe('PROMO_EXPIRED');
      expect(
        await db.product.findUniqueOrThrow({ where: { id: product.id } }),
      ).toMatchObject({ stock: 10, version: 0 });
      expect(await db.order.count({ where: { userId } })).toBe(0);
    });

    it.each(['SUCCESS', 'FAILED'])(
      'replays five simultaneous %s payments with only one gateway call',
      async (mockResult) => {
        const { orderId } = await fixture();
        const key = randomUUID();
        const charge = vi.spyOn(gateway, 'charge');
        const results = await queuedRace(
          orderId,
          Array.from(
            { length: 5 },
            () => () => pay(orderId, customerToken, key, mockResult),
          ),
        );
        const status = mockResult === 'SUCCESS' ? 201 : 402;
        for (const result of results) {
          expect(result.status).toBe(status);
          expect(result.body).toEqual(results[0].body);
        }
        expect(
          results.filter((r) => r.headers['idempotent-replayed'] === 'true'),
        ).toHaveLength(4);
        expect(charge).toHaveBeenCalledTimes(1);
        expect(await db.payment.count({ where: { orderId } })).toBe(1);
        expect(await db.loyaltyTransaction.count({ where: { orderId } })).toBe(
          mockResult === 'SUCCESS' ? 1 : 0,
        );
        expect(
          (await db.user.findUniqueOrThrow({ where: { id: userId } }))
            .loyaltyPoints,
        ).toBe(mockResult === 'SUCCESS' ? 535 : 500);
        const saved = await db.payment.findUniqueOrThrow({
          where: { idempotencyKey: key },
        });
        expect(saved.responseSnapshot).toEqual(results[0].body);
      },
    );

    it('rejects concurrent different keys for the same order without charging twice', async () => {
      const { orderId } = await fixture();
      const charge = vi.spyOn(gateway, 'charge');
      const results = await queuedRace(orderId, [
        () => pay(orderId),
        () => pay(orderId),
      ]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
      expect(['PAYMENT_IN_PROGRESS', 'INVALID_TRANSITION']).toContain(
        results.find((r) => r.status === 409)!.body.code,
      );
      expect(charge).toHaveBeenCalledTimes(1);
      expect(await db.payment.count({ where: { orderId } })).toBe(1);
    });

    it('recovers a unique-key collision between two different orders as 422', async () => {
      const first = await fixture();
      const second = await fixture();
      const key = randomUUID();
      const charge = vi.spyOn(gateway, 'charge');
      // Both requests see no key before trying to INSERT, on separate order locks.
      const results = await queuedRace(
        0,
        [
          () => pay(first.orderId, customerToken, key),
          () => pay(second.orderId, customerToken, key),
        ],
        'PaymentTable',
      );
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 422,
      ]);
      expect(results.find((r) => r.status === 422)!.body.code).toBe(
        'IDEMPOTENCY_KEY_REUSED',
      );
      expect(charge).toHaveBeenCalledTimes(1);
      expect(await db.payment.count({ where: { idempotencyKey: key } })).toBe(
        1,
      );
    });

    it.each([{ method: 'CARD' }, { mockResult: 'FAILED' }])(
      'rejects a reused key with changed body %j',
      async (change) => {
        const { orderId } = await fixture();
        const key = randomUUID();
        const charge = vi.spyOn(gateway, 'charge');
        await pay(orderId, customerToken, key).expect(201);
        const response = await post('/payments', customerToken, {
          orderId,
          method: 'WALLET',
          mockResult: 'SUCCESS',
          ...change,
        })
          .set('Idempotency-Key', key)
          .expect(422);
        expect(response.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
        expect(charge).toHaveBeenCalledTimes(1);
      },
    );

    it('waits up to three seconds for PROCESSING and can replay after that request completes', async () => {
      const { orderId } = await fixture();
      const key = randomUUID();
      const started = deferred();
      const release = deferred();
      const charge = vi
        .spyOn(gateway, 'charge')
        .mockImplementationOnce(async () => {
          started.resolve();
          await release.promise;
          return { success: true, providerRef: 'TEST-DELAYED' };
        });
      const first = pay(orderId, customerToken, key).then((r) => r);
      try {
        await Promise.race([started.promise, first]);
        const before = Date.now();
        const waiting = await pay(orderId, customerToken, key).expect(409);
        expect(Date.now() - before).toBeGreaterThanOrEqual(2900);
        expect(waiting.body.code).toBe('PAYMENT_IN_PROGRESS');
      } finally {
        release.resolve();
        await first;
      }
      const replay = await pay(orderId, customerToken, key).expect(201);
      expect(replay.body).toEqual((await first).body);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(charge).toHaveBeenCalledTimes(1);
    }, 10000);

    it('persists and replays unexpected mock gateway failures instead of leaving PROCESSING', async () => {
      const { orderId } = await fixture();
      const key = randomUUID();
      const charge = vi
        .spyOn(gateway, 'charge')
        .mockRejectedValueOnce(new Error('Gateway timeout'));
      const first = await pay(orderId, customerToken, key).expect(402);
      const replay = await pay(orderId, customerToken, key).expect(402);
      expect(replay.body).toEqual(first.body);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(charge).toHaveBeenCalledTimes(1);
      expect(
        (await db.payment.findUniqueOrThrow({ where: { idempotencyKey: key } }))
          .status,
      ).toBe('FAILED');
      await post(`/orders/${orderId}/cancel`, customerToken).expect(200);
    });

    it('preserves the historical payment snapshot after a refund', async () => {
      const { orderId } = await fixture();
      const key = randomUUID();
      const first = await pay(orderId, customerToken, key).expect(201);
      await post(`/orders/${orderId}/cancel`, customerToken).expect(200);
      const replay = await pay(orderId, customerToken, key).expect(201);
      expect(replay.body).toEqual(first.body);
      expect(
        (await db.order.findUniqueOrThrow({ where: { id: orderId } })).status,
      ).toBe('CANCELLED');
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: userId } }))
          .loyaltyPoints,
      ).toBe(500);
    });

    it('shares production validation and exposes the replay header to the frontend', async () => {
      const product = await createProduct();
      const invalid = await post('/orders', customerToken, {
        items: [{ productId: product.id, size: 'S', quantity: 1, price: 1 }],
      }).expect(400);
      expect(invalid.body).toMatchObject({
        code: 'VALIDATION_ERROR',
        path: '/api/orders',
        details: expect.any(Array),
      });
      expect(await db.order.count({ where: { userId } })).toBe(0);
      const response = await request(app.getHttpServer())
        .get('/api/products')
        .set('Origin', 'http://localhost:3000')
        .expect(200);
      expect(response.headers['access-control-expose-headers']).toContain(
        'Idempotent-Replayed',
      );
    });

    it('rounds loyalty down for 110700 VND and reverses it on cancellation', async () => {
      const product = await createProduct(10, 110700);
      const order = await post('/orders', customerToken, {
        items: [{ productId: product.id, size: 'S', quantity: 1 }],
      }).expect(201);
      const payment = await pay(order.body.id).expect(201);
      expect(payment.body.order.pointsEarned).toBe(110);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: userId } }))
          .loyaltyPoints,
      ).toBe(610);
      await post(`/orders/${order.body.id}/cancel`, customerToken).expect(200);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: userId } }))
          .loyaltyPoints,
      ).toBe(500);
      expect(
        (await db.product.findUniqueOrThrow({ where: { id: product.id } }))
          .stock,
      ).toBe(10);
    });

    it('accepts only one of two simultaneous barista status changes', async () => {
      const { orderId } = await fixture();
      await pay(orderId).expect(201);
      const results = await queuedRace(orderId, [
        () => prepare(orderId),
        () => prepare(orderId),
      ]);
      expect(results.map((response) => response.status)).toEqual([200, 409]);
      expect(results[1].body.code).toBe('INVALID_TRANSITION');
      expect(
        (await db.order.findUniqueOrThrow({ where: { id: orderId } })).status,
      ).toBe('PREPARING');
    });
  },
);
