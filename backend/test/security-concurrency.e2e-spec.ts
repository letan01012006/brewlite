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
import { seedDemoCatalog } from '../prisma/demo-catalog.js';
import { PricingService } from '../src/common/pricing/pricing.service.js';
import { DEMO_PRODUCT_TOPPINGS } from '../prisma/demo-product-toppings.js';

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDollarQuote = false;
  let inSingleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      current += char;
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        current += '*/';
        i++;
        continue;
      }
      current += char;
      continue;
    }

    if (!inDollarQuote && !inSingleQuote) {
      if (char === '-' && nextChar === '-') {
        inLineComment = true;
        current += '--';
        i++;
        continue;
      }
      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        current += '/*';
        i++;
        continue;
      }
    }

    if (!inSingleQuote && char === '$' && nextChar === '$') {
      inDollarQuote = !inDollarQuote;
      current += '$$';
      i++;
      continue;
    }

    if (!inDollarQuote && char === "'") {
      if (nextChar === "'") {
        current += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (!inDollarQuote && !inSingleQuote && char === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }

    current += char;
  }
  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}

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
    let legacyProductId: number;
    let legacyUserId: number;
    let legacyOrderId: number;

    beforeAll(async () => {
      const source = new URL(process.env.DATABASE_URL!);
      const target = new URL(databaseUrl!);
      if (source.hostname === target.hostname && (source.port || '5432') === (target.port || '5432') && source.pathname === target.pathname) throw new Error('Use a dedicated test database.');
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
        if (entry.name === '20261103153000_product_toppings') {
          // Simulate an upgrade: real rows exist before the relation migration.
          const product = await db.product.create({
            data: {
              id: 901, name: 'Cà phê sữa', price: 37000, stock: 23, version: 9,
              category: 'Cà phê', imageUrl: '/legacy.jpg',
            }
          });
          legacyProductId = product.id;
          await db.topping.createMany({
            data: [
              { id: 501, name: 'Kem cheese', price: 7777 },
              { id: 702, name: 'Thạch', price: 4321 },
            ]
          });
          // This intentionally runs against the pre-auth schema. Do not use a
          // generated User projection containing columns from later migrations.
          const [user] = await db.$queryRaw<Array<{ id: number }>>`
            INSERT INTO "User" (email,"fullName","passwordHash","loyaltyPoints")
            VALUES ('legacy@test.example','Legacy','unchanged',123) RETURNING id
          `;
          legacyUserId = user.id;
          const order = await db.order.create({
            data: {
              userId: user.id, subtotal: 50000, total: 50000,
              items: {
                create: {
                  productId: product.id, productName: product.name, size: 'S', qty: 1,
                  unitPrice: 50000, lineTotal: 50000, toppings: [{ id: 501, name: 'Old snapshot', price: 13000 }]
                }
              },
            }
          });
          legacyOrderId = order.id;
        }
        const sql = await readFile(
          resolve(migrations, entry.name, 'migration.sql'),
          'utf8',
        );
        for (const statement of splitSqlStatements(sql)) {
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

    async function createProduct(stock = 10, price = 35000) {
      const ingredient = await db.ingredient.create({ data: { code: randomUUID(), name: randomUUID(), unit: 'GRAM', stockQuantity: stock } });
      return db.product.create({
        data: {
          name: randomUUID(),
          category: 'Coffee',
          price,
          stock,
          imageUrl: '/test.jpg',
          recipes: { create: (['S', 'M', 'L'] as const).map(size => ({ size, isActive: true, ingredients: { create: { ingredientId: ingredient.id, unit: 'GRAM', quantity: 1 } } })) },
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
      target: 'Order' | 'Product' | 'Ingredient' | 'PromoCode' | 'PaymentTable' = 'Order',
    ) {
      const locked = deferred();
      const release = deferred();
      const blocker = db.$transaction(
        async (tx) => {
          if (target === 'Ingredient') {
            await tx.$queryRaw`SELECT "id" FROM "Ingredient" WHERE "id" = ${orderId} FOR UPDATE`;
          } else if (target === 'Product') {
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

    it.each(['/products', '/products/toppings', '/toppings'])(
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
        ).toBe(10);
        expect(
          (await db.user.findUniqueOrThrow({ where: { id: userId } }))
            .loyaltyPoints,
        ).toBe(500);
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
      // Simulate legacy order with EARN to test points reversal
      await db.user.update({
        where: { id: userId },
        data: { loyaltyPoints: 535 },
      });
      const earnTx = await db.loyaltyTransaction.create({
        data: {
          userId,
          orderId,
          points: 35,
          type: 'EARN',
          eventKey: `legacy:loyalty:${orderId}`,
        },
      });
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
      const reloadedEarn = await db.loyaltyTransaction.findUniqueOrThrow({
        where: { id: earnTx.id },
      });
      expect(reloadedEarn.reversedAt).not.toBeNull();
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
        ).toBe(10);
        expect(
          (await db.user.findUniqueOrThrow({ where: { id: userId } }))
            .loyaltyPoints,
        ).toBe(500);
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
      await request(app.getHttpServer())
        .patch(`/api/orders/${orderId}/status`)
        .auth(baristaToken, { type: 'bearer' })
        .send({ status: 'PREPARING' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/orders/${orderId}/status`)
        .auth(baristaToken, { type: 'bearer' })
        .send({ status: 'READY' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/orders/${orderId}/status`)
        .auth(baristaToken, { type: 'bearer' })
        .send({ status: 'COMPLETED' })
        .expect(200);
      expect(await db.loyaltyTransaction.count({ where: { orderId, type: 'EARN' } })).toBe(1);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: userId } }))
          .loyaltyPoints,
      ).toBe(535);
    });

    it.each([5, 10])('admits only %i of ten simultaneous payments while PENDING holds no stock', async stock => {
      const product = await createProduct(stock);
      const recipe = await db.productRecipe.findUniqueOrThrow({ where: { productId_size: { productId: product.id, size: 'S' } }, include: { ingredients: true } });
      const ingredientId = recipe.ingredients[0].ingredientId;
      const pending = await Promise.all(Array.from({ length: 10 }, () => post('/orders', customerToken, { items: [{ productId: product.id, size: 'S', quantity: 1 }] }).expect(201)));
      expect((await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } })).reservedQuantity.toString()).toBe('0');
      const results = await queuedRace(ingredientId, pending.map(row => () => pay(row.body.id)), 'Ingredient');
      expect(results.filter(r => r.status === 201)).toHaveLength(stock);
      expect(results.filter(r => r.status === 402)).toHaveLength(10 - stock);
      const saved = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
      expect(saved.stockQuantity.toString()).toBe(String(stock));
      expect(saved.reservedQuantity.toString()).toBe(String(stock));
      expect(await db.inventoryReservation.count({ where: { items: { some: { ingredientId } } } })).toBe(stock);
      expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(stock);
    }, 20000);

    it('rolls back the entire basket when its second product is out of stock', async () => {
      const first = await createProduct(10);
      const second = await createProduct(0);
      const result = await post('/orders', customerToken, {
        items: [
          { productId: first.id, size: 'S', quantity: 2 },
          { productId: second.id, size: 'S', quantity: 1 },
        ],
      }).expect(409);
      expect(result.body.code).toBe('INSUFFICIENT_INGREDIENTS');
      expect(
        await db.product.findUniqueOrThrow({ where: { id: first.id } }),
      ).toMatchObject({ stock: 10, version: 0 });
      expect(await db.order.count({ where: { userId } })).toBe(0);
      expect(await db.orderItem.count({ where: { productId: first.id } })).toBe(
        0,
      );
    });

    it('freezes a consistent basket price when the catalog changes during creation', async () => {
      const first = await createProduct(); const second = await createProduct();
      const pricing = app.get(PricingService); const original = pricing.calculate.bind(pricing);
      vi.spyOn(pricing, 'calculate').mockImplementationOnce(async (...args) => {
        const result = await original(...args);
        await db.product.update({ where: { id: second.id }, data: { price: 36000, version: { increment: 1 } } });
        return result;
      });
      const response = await post('/orders', customerToken, { items: [{ productId: first.id, size: 'S', quantity: 1 }, { productId: second.id, size: 'S', quantity: 1 }] }).expect(201);
      expect(response.body.total).toBe(70000);
      expect(response.body.items.every((i: { recipeSnapshot: unknown }) => i.recipeSnapshot !== null)).toBe(true);
      expect(await db.product.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ stock: 10, version: 1, price: 36000 });
      expect(await db.order.count({ where: { userId } })).toBe(1);
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
      ).toBe(10);
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
        expect(await db.loyaltyTransaction.count({ where: { orderId } })).toBe(0);
        expect(
          (await db.user.findUniqueOrThrow({ where: { id: userId } }))
            .loyaltyPoints,
        ).toBe(500);
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
      await pay(order.body.id).expect(201);
      // Giả lập đơn hàng cũ đã có điểm EARN để kiểm thử thu hồi
      await db.user.update({
        where: { id: userId },
        data: { loyaltyPoints: 610 },
      });
      const earnTx = await db.loyaltyTransaction.create({
        data: {
          userId,
          orderId: order.body.id,
          points: 110,
          type: 'EARN',
          eventKey: `legacy:loyalty:${order.body.id}`,
        },
      });
      await post(`/orders/${order.body.id}/cancel`, customerToken).expect(200);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: userId } }))
          .loyaltyPoints,
      ).toBe(500);
      const reloadedEarn = await db.loyaltyTransaction.findUniqueOrThrow({
        where: { id: earnTx.id },
      });
      expect(reloadedEarn.reversedAt).not.toBeNull();
      expect(
        (await db.product.findUniqueOrThrow({ where: { id: product.id } }))
          .stock,
      ).toBe(10);
    });

    it('backfills legacy demo rows once and repeated seeds preserve manager edits, IDs, stock and history', async () => {
      const old = await db.product.findUniqueOrThrow({ where: { id: legacyProductId }, include: { toppings: true } });
      expect(old).toMatchObject({ id: legacyProductId, stock: 23, version: 9, price: 37000 });
      expect(old.toppings.map((t) => t.id).sort((a, b) => a - b)).toEqual([501, 702]);
      await seedDemoCatalog(db);
      for (const [name, allowed] of Object.entries(DEMO_PRODUCT_TOPPINGS)) {
        const product = await db.product.findUniqueOrThrow({ where: { name }, include: { toppings: true } });
        expect(product.toppings.map((t) => t.name).sort()).toEqual([...allowed].sort());
      }
      await db.product.update({ where: { id: legacyProductId }, data: { toppings: { set: [] } } });
      await seedDemoCatalog(db);
      await seedDemoCatalog(db);
      const updated = await db.product.findUniqueOrThrow({ where: { id: legacyProductId }, include: { toppings: true } });
      expect(updated).toMatchObject({ price: 37000, stock: 23, version: 9, toppings: [] });
      expect(await db.product.count({ where: { name: 'Cà phê sữa' } })).toBe(1);
      expect(await db.topping.findUniqueOrThrow({ where: { id: 501 } })).toMatchObject({ name: 'Kem cheese', price: 7777 });
      expect(await db.user.findUniqueOrThrow({ where: { id: legacyUserId } })).toMatchObject({ loyaltyPoints: 123, passwordHash: 'unchanged' });
      const history = await db.order.findUniqueOrThrow({ where: { id: legacyOrderId }, include: { items: true } });
      expect(history).toMatchObject({ total: 50000, subtotal: 50000 });
      expect(history.items[0].toppings).toEqual([{ id: 501, name: 'Old snapshot', price: 13000 }]);
    });

    async function toppingFixture() {
      const [a, b, c] = await Promise.all([createProduct(), createProduct(), createProduct()]);
      const toppingIngredient = await db.ingredient.create({ data: { code: randomUUID(), name: randomUUID(), unit: 'GRAM', stockQuantity: 100 } });
      const mapping = { ingredientId: toppingIngredient.id, quantityPerServing: 1 };
      const [x, y, inactive] = await Promise.all([
        db.topping.create({ data: { name: `X-${randomUUID()}`, price: 5000, ...mapping } }),
        db.topping.create({ data: { name: `Y-${randomUUID()}`, price: 7000, ...mapping } }),
        db.topping.create({ data: { name: `Inactive-${randomUUID()}`, price: 3000, isActive: false } }),
      ]);
      await db.product.update({ where: { id: a.id }, data: { toppings: { connect: [{ id: x.id }, { id: inactive.id }] } } });
      await db.product.update({ where: { id: b.id }, data: { toppings: { connect: { id: y.id } } } });
      return { a, b, c, x, y, inactive };
    }

    it('returns only the linked active toppings in public product detail and paginated/search/category lists', async () => {
      const { a, b, c, x, y } = await toppingFixture();
      for (const [p, ids] of [[a, [x.id]], [b, [y.id]], [c, []]] as const) {
        const detail = await request(app.getHttpServer()).get(`/api/products/${p.id}`).expect(200);
        expect(detail.body.toppings.map((t: { id: number }) => t.id)).toEqual(ids);
        expect(detail.body.sizes).toEqual([{ size: 'S', surcharge: 0 }, { size: 'M', surcharge: 5000 }, { size: 'L', surcharge: 10000 }]);
        expect(detail.body).not.toHaveProperty('version');
        expect(detail.body.isActive).toBe(true);
        const list = await request(app.getHttpServer()).get(`/api/products?search=${p.name}&category=Coffee&limit=1&page=1`).expect(200);
        expect(list.body.meta).toMatchObject({ total: 1, page: 1, limit: 1 });
        expect(list.body.data[0].toppings).toEqual(detail.body.toppings);
        expect(list.body.data[0]).not.toHaveProperty('version');
      }
      await db.product.update({ where: { id: a.id }, data: { isActive: false } });
      await request(app.getHttpServer()).get(`/api/products/${a.id}`).expect(404);
    });

    it('prices A + X, rejects A + Y in orders and promotions with no side effects, and accepts C without toppings', async () => {
      const { a, c, x, y, inactive } = await toppingFixture();
      const promo = await db.promoCode.create({
        data: {
          code: randomUUID().toUpperCase(), type: 'FIXED', value: 1000,
          usedCount: 2, startsAt: new Date('2020-01-01'), expiresAt: new Date('2099-01-01')
        }
      });
      const validItem = { productId: a.id, size: 'M', quantity: 2, toppingIds: [x.id] };
      const preview = await post('/promotions/validate', customerToken, { code: promo.code, items: [validItem] }).expect(200);
      expect(preview.body.subtotal).toBe(90000);
      const created = await post('/orders', customerToken, { items: [validItem] }).expect(201);
      expect(created.body).toMatchObject({ subtotal: 90000, total: 90000 });
      expect(created.body.items[0]).toMatchObject({ unitPrice: 45000, lineTotal: 90000, toppings: [{ id: x.id, name: x.name, price: 5000 }] });
      const empty = await post('/orders', customerToken, { items: [{ productId: c.id, size: 'S', quantity: 1 }] }).expect(201);
      expect(empty.body.items[0].toppings).toEqual([]);
      const before = await db.product.findMany({ where: { id: { in: [a.id, c.id] } } });
      const count = await db.order.count({ where: { userId } });
      for (const ids of [[y.id], [inactive.id], [2147483647], [x.id, x.id], [x.id, y.id, inactive.id, 2147483647]]) {
        const bad = { ...validItem, toppingIds: ids };
        await post('/orders', customerToken, { items: [{ productId: c.id, size: 'S', quantity: 1 }, bad], promoCode: promo.code }).expect(400);
        await post('/promotions/validate', customerToken, { code: promo.code, items: [bad] }).expect(400);
      }
      expect(await db.order.count({ where: { userId } })).toBe(count);
      expect(await db.product.findMany({ where: { id: { in: [a.id, c.id] } } })).toEqual(before);
      expect((await db.promoCode.findUniqueOrThrow({ where: { id: promo.id } })).usedCount).toBe(2);
      expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).loyaltyPoints).toBe(500);
      // Existing orders keep names, prices and total even after catalog changes.
      await db.topping.update({ where: { id: x.id }, data: { name: `Renamed-${randomUUID()}`, price: 1, isActive: false } });
      await db.product.update({ where: { id: a.id }, data: { toppings: { set: [] }, price: 1 } });
      const charge = vi.spyOn(gateway, 'charge');
      await pay(created.body.id).expect(201);
      expect(charge).toHaveBeenCalledWith(expect.objectContaining({ amount: 90000 }));
      const history = await db.order.findUniqueOrThrow({ where: { id: created.body.id }, include: { items: true } });
      expect(history.total).toBe(90000);
      expect(history.items[0].toppings).toEqual([{ id: x.id, name: x.name, price: 5000 }]);
    });

    it('requires BARISTA for atomic assignment, accepts more than 3 configured toppings, and [] clears all', async () => {
      const { a, x, y, inactive } = await toppingFixture();
      const patch = (body: object, token?: string) => {
        const call = request(app.getHttpServer()).patch(`/api/products/${a.id}/toppings`).send(body);
        return token ? call.auth(token, { type: 'bearer' }) : call;
      };
      await patch({ toppingIds: [y.id] }).expect(401);
      await patch({ toppingIds: [y.id] }, customerToken).expect(403);
      const original = await db.product.findUniqueOrThrow({ where: { id: a.id }, include: { toppings: { orderBy: { id: 'asc' } } } });
      await patch({}, baristaToken).expect(400);
      await patch({ toppingIds: null }, baristaToken).expect(400);
      for (const ids of [[x.id, 2147483647], [x.id, inactive.id], [x.id, x.id], [-1], [2147483648], [1.5], ['1']]) {
        await patch({ toppingIds: ids }, baristaToken).expect(400);
        const name = randomUUID();
        await post('/products', baristaToken, { name, category: 'Coffee', price: 10000, toppingIds: ids }).expect(400);
        expect(await db.product.findUnique({ where: { name } })).toBeNull();
      }
      expect(await db.product.findUniqueOrThrow({ where: { id: a.id }, include: { toppings: { orderBy: { id: 'asc' } } } })).toEqual(original);
      const extra = await Promise.all([1, 2].map(() => db.topping.create({ data: { name: randomUUID(), price: 0 } })));
      const ids = [x.id, y.id, ...extra.map((t) => t.id)];
      const assigned = await patch({ toppingIds: ids }, baristaToken).expect(200);
      expect(assigned.body.toppings.map((t: { id: number }) => t.id).sort((a: number, b: number) => a - b)).toEqual([...ids].sort((a, b) => a - b));
      const created = await post('/products', baristaToken, { name: randomUUID(), category: 'Coffee', price: 10000, toppingIds: ids }).expect(201);
      expect(created.body.toppings).toHaveLength(4);
      const noToppings = await post('/products', baristaToken, { name: randomUUID(), category: 'Coffee', price: 10000 }).expect(201);
      expect(noToppings.body.toppings).toEqual([]);
      expect((await patch({ toppingIds: [] }, baristaToken).expect(200)).body.toppings).toEqual([]);
    });

    it.each(['/products/toppings', '/toppings'])('%s validates names/integer prices and handles duplicate names as 409', async (path) => {
      for (const body of [{ name: '  ', price: 0 }, { name: randomUUID(), price: -1 }, { name: randomUUID(), price: 1.5 }, { name: randomUUID(), price: 2147483648 }])
        await post(path, baristaToken, body).expect(400);
      const name = randomUUID();
      await post(path, baristaToken, { name: ` ${name} `, price: 0 }).expect(201);
      const duplicate = await post(path, baristaToken, { name, price: 0 }).expect(409);
      expect(duplicate.body.code).toBe('TOPPING_ALREADY_EXISTS');
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
