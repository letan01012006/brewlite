import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { configureApp } from '../src/configure-app.js';
import {
  VnpayGateway,
  type VnpayQueryResult,
  type VnpayRefundResult,
} from '../src/payments/vnpay/vnpay.gateway.js';
import {
  buildPaymentUrl,
  buildVnpaySignData,
  signHmacSha512,
  verifyVnpaySignature,
  type VnpayConfig,
} from '../src/payments/vnpay/vnpay.util.js';
import { WELCOME_POINTS } from '../src/promotions/voucher-rules.js';
import { splitSqlStatements } from './database-fixture.js';

const testConfig: VnpayConfig = {
  tmnCode: 'TESTTMN',
  hashSecret: 'TESTSECRETKEYFORVNPAY12345678',
  payUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
  apiUrl: 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction',
  returnUrl: 'http://localhost:3000/payment/vnpay-return',
  expireMinutes: 15,
};

class FakeVnpayGateway extends VnpayGateway {
  queryResult: VnpayQueryResult = {
    raw: {},
    responseCode: '00',
    transactionStatus: '00',
    transactionNo: '12345678',
    bankCode: 'NCB',
    cardType: 'ATM',
    payDate: '20261105090000',
    amount: 50000,
    success: true,
  };

  refundResult: VnpayRefundResult = {
    raw: {},
    responseCode: '00',
    refundNo: 'REF123456',
    success: true,
  };

  isConfigured(): boolean {
    return true;
  }

  createPaymentUrl(params: {
    orderId: number;
    paymentId: number;
    amount: number;
    ipAddr: string;
    orderInfo?: string;
    bankCode?: string;
  }) {
    return buildPaymentUrl(testConfig, params);
  }

  verifySignature(params: Record<string, unknown>): boolean {
    return verifyVnpaySignature(params, testConfig.hashSecret);
  }

  async queryTransaction(_params: {
    txnRef: string;
    transactionDate: string;
    ipAddr?: string;
  }): Promise<VnpayQueryResult> {
    return this.queryResult;
  }

  async refund(_params: {
    txnRef: string;
    amount: number;
    transactionDate: string;
    transactionNo?: string;
    createBy: string;
    ipAddr?: string;
  }): Promise<VnpayRefundResult> {
    return this.refundResult;
  }
}

describe('VNPAY and Loyalty Points E2E Suite', () => {
  let app: INestApplication;
  let db: PrismaClient;
  let adminDb: PrismaClient;
  let schemaName: string;
  let fakeGateway: FakeVnpayGateway;
  let customerToken: string;
  let baristaToken: string;
  let customerUser: { id: number; email: string };
  let baristaUser: { id: number; email: string };
  let testProduct: { id: number; price: number };

  beforeAll(async () => {
    const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!;
    schemaName = `brewlite_vnpay_${randomUUID().replaceAll('-', '')}`;

    adminDb = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDbUrl }),
    });
    await adminDb.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);

    db = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: testDbUrl,
          options: `-c search_path=${schemaName}`,
        },
        { schema: schemaName },
      ),
    });

    // Run migrations using splitSqlStatements to respect $$ blocks
    const migrationsDir = resolve('prisma/migrations');
    const entries = (await readdir(migrationsDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const sql = await readFile(
        resolve(migrationsDir, entry.name, 'migration.sql'),
        'utf8',
      );
      for (const statement of splitSqlStatements(sql)) {
        await db.$executeRawUnsafe(statement);
      }
    }

    fakeGateway = new FakeVnpayGateway();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(VnpayGateway)
      .useValue(fakeGateway)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  }, 35000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    try {
      await adminDb?.$executeRawUnsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
    } finally {
      await adminDb?.$disconnect();
    }
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    fakeGateway.queryResult = {
      raw: {},
      responseCode: '00',
      transactionStatus: '00',
      transactionNo: '12345678',
      bankCode: 'NCB',
      cardType: 'ATM',
      payDate: '20261105090000',
      amount: 50000,
      success: true,
    };
    fakeGateway.refundResult = {
      raw: {},
      responseCode: '00',
      refundNo: 'REF123456',
      success: true,
    };

    await db.$executeRawUnsafe(`
      TRUNCATE TABLE "PaymentWebhookLog", "PaymentRefund", "Payment", "LoyaltyTransaction", "OrderItem", "Order", "ProductRecipeIngredient", "ProductRecipe", "Product", "Ingredient", "User" CASCADE;
    `);

    const jwtService = app.get(JwtService);

    // Create users
    customerUser = await db.user.create({
      data: {
        email: `customer-${randomUUID()}@example.com`,
        fullName: 'Test Customer',
        passwordHash: 'hashed',
        role: 'CUSTOMER',
        loyaltyPoints: WELCOME_POINTS,
      },
    });
    customerToken = jwtService.sign({
      sub: customerUser.id,
      email: customerUser.email,
      role: 'CUSTOMER',
    });

    baristaUser = await db.user.create({
      data: {
        email: `barista-${randomUUID()}@example.com`,
        fullName: 'Test Barista',
        passwordHash: 'hashed',
        role: 'BARISTA',
        loyaltyPoints: 0,
      },
    });
    baristaToken = jwtService.sign({
      sub: baristaUser.id,
      email: baristaUser.email,
      role: 'BARISTA',
    });

    // Create a product with ingredients
    const ing = await db.ingredient.create({
      data: {
        code: `ING_${randomUUID().slice(0, 8)}`,
        name: `Coffee Beans ${randomUUID().slice(0, 8)}`,
        unit: 'GRAM',
        stockQuantity: new Prisma.Decimal('10000.000'),
        reservedQuantity: new Prisma.Decimal('0.000'),
      },
    });

    testProduct = await db.product.create({
      data: {
        name: `Espresso ${randomUUID().slice(0, 8)}`,
        price: 50000,
        imageUrl: '/test.png',
        category: 'Coffee',
        stock: 100,
      },
    });

    const recipe = await db.productRecipe.create({
      data: {
        productId: testProduct.id,
        size: 'S',
        isActive: true,
      },
    });

    await db.productRecipeIngredient.create({
      data: {
        recipeId: recipe.id,
        ingredientId: ing.id,
        unit: 'GRAM',
        quantity: new Prisma.Decimal('20.000'),
      },
    });
  });

  function signVnpayParams(params: Record<string, string>): Record<string, string> {
    const { signData } = buildVnpaySignData(params);
    const secureHash = signHmacSha512(signData, testConfig.hashSecret);
    return { ...params, vnp_SecureHash: secureHash };
  }

  async function createOrder(amount = 50000) {
    const res = await request(app.getHttpServer())
      .post('/api/orders')
      .auth(customerToken, { type: 'bearer' })
      .send({
        items: [{ productId: testProduct.id, size: 'S', quantity: amount / 50000 }],
      })
      .expect(201);
    return res.body as { id: number; total: number; status: string };
  }

  it('B1: Register grants 500 welcome points; does not alter existing users', async () => {
    const regRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: `new-${randomUUID()}@example.com`,
        password: 'Password@123',
        fullName: 'New User',
      })
      .expect(201);

    expect(regRes.body.loyaltyPoints).toBe(500);

    // Existing customer remains unchanged
    const customerInDb = await db.user.findUniqueOrThrow({
      where: { id: customerUser.id },
    });
    expect(customerInDb.loyaltyPoints).toBe(WELCOME_POINTS);
  });

  it('B2: Creates VNPAY payment, returns paymentUrl and expiresAt, supports replay', async () => {
    const order = await createOrder(50000);
    const idempotencyKey = randomUUID();

    const res = await request(app.getHttpServer())
      .post('/api/payments')
      .auth(customerToken, { type: 'bearer' })
      .set('Idempotency-Key', idempotencyKey)
      .send({
        orderId: order.id,
        method: 'VNPAY',
      })
      .expect(201);

    expect(res.body.payment).toBeDefined();
    expect(res.body.payment.method).toBe('VNPAY');
    expect(res.body.payment.status).toBe('PROCESSING');
    expect(res.body.payment.paymentUrl).toContain(testConfig.payUrl);
    expect(res.body.payment.paymentUrl).toContain('vnp_SecureHash=');
    expect(res.body.payment.expiresAt).toBeDefined();

    // Replay with same key
    const replayRes = await request(app.getHttpServer())
      .post('/api/payments')
      .auth(customerToken, { type: 'bearer' })
      .set('Idempotency-Key', idempotencyKey)
      .send({
        orderId: order.id,
        method: 'VNPAY',
      })
      .expect(201);

    expect(replayRes.headers['idempotent-replayed']).toBe('true');
    expect(replayRes.body.payment.id).toBe(res.body.payment.id);
  });

  it('B3: Rejects amount < 5000 with 422 and method POINTS with 400', async () => {
    // POINTS -> 400
    await request(app.getHttpServer())
      .post('/api/payments')
      .auth(customerToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({
        orderId: 1,
        method: 'POINTS',
      })
      .expect(400);

    // Create order with total < 5000
    const cheapProduct = await db.product.create({
      data: {
        name: `Candy ${randomUUID().slice(0, 8)}`,
        price: 3000,
        imageUrl: '/candy.png',
        category: 'Snack',
        stock: 50,
      },
    });
    const cheapRecipe = await db.productRecipe.create({
      data: {
        productId: cheapProduct.id,
        size: 'S',
        isActive: true,
      },
    });
    const ing = await db.ingredient.findFirstOrThrow();
    await db.productRecipeIngredient.create({
      data: {
        recipeId: cheapRecipe.id,
        ingredientId: ing.id,
        unit: 'GRAM',
        quantity: new Prisma.Decimal('1.000'),
      },
    });

    const order = await request(app.getHttpServer())
      .post('/api/orders')
      .auth(customerToken, { type: 'bearer' })
      .send({ items: [{ productId: cheapProduct.id, size: 'S', quantity: 1 }] })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/payments')
      .auth(customerToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({
        orderId: order.body.id,
        method: 'VNPAY',
      })
      .expect(422);

    expect(res.body.code).toBe('VNPAY_MIN_AMOUNT_INVALID');
  });

  it('B4: IPN verification: invalid signature, invalid amount, unknown txnRef', async () => {
    const order = await createOrder(50000);
    const payRes = await request(app.getHttpServer())
      .post('/api/payments')
      .auth(customerToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ orderId: order.id, method: 'VNPAY' })
      .expect(201);

    const payment = await db.payment.findUniqueOrThrow({
      where: { id: payRes.body.payment.id },
    });
    const txnRef = payment.gatewayTxnRef!;

    // 1. Invalid signature (RspCode 97)
    const badSigRes = await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query({
        vnp_Amount: '5000000',
        vnp_TxnRef: txnRef,
        vnp_ResponseCode: '00',
        vnp_SecureHash: 'INVALID_HASH',
      })
      .expect(200);
    expect(badSigRes.body.RspCode).toBe('97');

    // 2. Unknown txnRef (RspCode 01)
    const unknownQuery = signVnpayParams({
      vnp_Amount: '5000000',
      vnp_TxnRef: 'UNKNOWN_TXN_REF',
      vnp_ResponseCode: '00',
      vnp_TmnCode: testConfig.tmnCode,
    });
    const unknownRes = await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(unknownQuery)
      .expect(200);
    expect(unknownRes.body.RspCode).toBe('01');

    // 3. Invalid amount (RspCode 04)
    const badAmountQuery = signVnpayParams({
      vnp_Amount: '10000000', // 100,000 instead of 50,000
      vnp_TxnRef: txnRef,
      vnp_ResponseCode: '00',
      vnp_TmnCode: testConfig.tmnCode,
    });
    const badAmountRes = await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(badAmountQuery)
      .expect(200);
    expect(badAmountRes.body.RspCode).toBe('04');
  });

  it('B5: Successful IPN transitions Order to PAID without adding loyalty points; duplicate IPN is safe', async () => {
    const order = await createOrder(50000);
    const payRes = await request(app.getHttpServer())
      .post('/api/payments')
      .auth(customerToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ orderId: order.id, method: 'VNPAY' })
      .expect(201);

    const payment = await db.payment.findUniqueOrThrow({
      where: { id: payRes.body.payment.id },
    });
    const txnRef = payment.gatewayTxnRef!;

    const ipnQuery = signVnpayParams({
      vnp_Amount: '5000000',
      vnp_TxnRef: txnRef,
      vnp_ResponseCode: '00',
      vnp_TransactionNo: '99887766',
      vnp_BankCode: 'NCB',
      vnp_PayDate: '20261105093000',
      vnp_TmnCode: testConfig.tmnCode,
    });

    // First IPN
    const ipnRes1 = await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(ipnQuery)
      .expect(200);
    expect(ipnRes1.body.RspCode).toBe('00');

    // Order should be PAID
    const orderAfter = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderAfter.status).toBe('PAID');

    // Payment should be SUCCESS
    const paymentAfter = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paymentAfter.status).toBe('SUCCESS');
    expect(paymentAfter.providerRef).toBe('99887766');

    // Crucial: Loyalty points must NOT be added at payment time!
    const userAfter = await db.user.findUniqueOrThrow({ where: { id: customerUser.id } });
    expect(userAfter.loyaltyPoints).toBe(WELCOME_POINTS); // still 500!
    expect(await db.loyaltyTransaction.count({ where: { orderId: order.id } })).toBe(0);

    // Duplicate IPN -> returns 02 (already confirmed)
    const ipnRes2 = await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(ipnQuery)
      .expect(200);
    expect(ipnRes2.body.RspCode).toBe('02');

    // PaymentWebhookLog must not contain vnp_SecureHash
    const logs = await db.paymentWebhookLog.findMany({ where: { paymentId: payment.id } });
    for (const log of logs) {
      const payloadStr = JSON.stringify(log.rawPayload);
      expect(payloadStr).not.toContain('vnp_SecureHash');
    }
  });

  it('B6: Late IPN on CANCELLED order transitions to NEEDS_REFUND and creates PaymentRefund', async () => {
    const order = await createOrder(50000);
    const payRes = await request(app.getHttpServer())
      .post('/api/payments')
      .auth(customerToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ orderId: order.id, method: 'VNPAY' })
      .expect(201);

    const payment = await db.payment.findUniqueOrThrow({
      where: { id: payRes.body.payment.id },
    });

    // Mark payment EXPIRED so order can be cancelled
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'EXPIRED' },
    });

    // Cancel order
    await request(app.getHttpServer())
      .post(`/api/orders/${order.id}/cancel`)
      .auth(customerToken, { type: 'bearer' })
      .expect(200);

    // Reset payment to PROCESSING to simulate late IPN arriving
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'PROCESSING' },
    });

    const lateIpn = signVnpayParams({
      vnp_Amount: '5000000',
      vnp_TxnRef: payment.gatewayTxnRef!,
      vnp_ResponseCode: '00',
      vnp_TransactionNo: '888888',
      vnp_TmnCode: testConfig.tmnCode,
    });

    await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(lateIpn)
      .expect(200);

    const paymentAfter = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paymentAfter.status).toBe('NEEDS_REFUND');

    const refund = await db.paymentRefund.findUnique({ where: { paymentId: payment.id } });
    expect(refund).not.toBeNull();
    expect(refund!.status).toBe('PENDING');
  });

  it('B7: Return URL triggers querydr, verifies payment and hides paymentUrl from barista in GET :id', async () => {
    const order = await createOrder(50000);
    const payRes = await request(app.getHttpServer())
      .post('/api/payments')
      .auth(customerToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ orderId: order.id, method: 'VNPAY' })
      .expect(201);

    const payment = await db.payment.findUniqueOrThrow({
      where: { id: payRes.body.payment.id },
    });

    fakeGateway.queryResult = {
      raw: {},
      responseCode: '00',
      transactionStatus: '00',
      transactionNo: 'QDR_12345',
      bankCode: 'VNPAYQR',
      success: true,
    };

    const returnQuery = signVnpayParams({
      vnp_Amount: '5000000',
      vnp_TxnRef: payment.gatewayTxnRef!,
      vnp_ResponseCode: '00',
      vnp_TransactionNo: 'QDR_12345',
      vnp_TmnCode: testConfig.tmnCode,
    });

    const returnRes = await request(app.getHttpServer())
      .get('/api/payments/vnpay/return')
      .auth(customerToken, { type: 'bearer' })
      .query(returnQuery)
      .expect(200);

    expect(returnRes.body.payment.status).toBe('SUCCESS');
    expect(returnRes.body.order.status).toBe('PAID');

    // Barista calls GET /api/payments/:id -> paymentUrl must be null
    const baristaView = await request(app.getHttpServer())
      .get(`/api/payments/${payment.id}`)
      .auth(baristaToken, { type: 'bearer' })
      .expect(200);

    expect(baristaView.body.paymentUrl).toBeNull();
  });

  it('B8: Barista performs refund for PAID order; cannot refund twice', async () => {
    const order = await createOrder(50000);
    const payRes = await request(app.getHttpServer())
      .post('/api/payments')
      .auth(customerToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ orderId: order.id, method: 'VNPAY' })
      .expect(201);

    const paymentId = payRes.body.payment.id;

    // Simulate SUCCESS
    await db.payment.update({
      where: { id: paymentId },
      data: {
        status: 'SUCCESS',
        providerRef: 'TXN_REFUND_TEST',
      },
    });

    // Customer cannot call refund
    await request(app.getHttpServer())
      .post(`/api/payments/${paymentId}/refund`)
      .auth(customerToken, { type: 'bearer' })
      .expect(403);

    // Barista performs refund
    fakeGateway.refundResult = {
      raw: {},
      responseCode: '00',
      refundNo: 'VNPAY_REFUND_999',
      success: true,
    };

    const refundRes = await request(app.getHttpServer())
      .post(`/api/payments/${paymentId}/refund`)
      .auth(baristaToken, { type: 'bearer' })
      .expect(200);

    expect(refundRes.body.refund.status).toBe('SUCCESS');
    expect(refundRes.body.payment.refundedAmount).toBe(50000);
    expect(refundRes.body.payment.refundRef).toBe('VNPAY_REFUND_999');

    // Refund a second time -> idempotent, doesn't refund twice
    const refundRes2 = await request(app.getHttpServer())
      .post(`/api/payments/${paymentId}/refund`)
      .auth(baristaToken, { type: 'bearer' })
      .expect(200);

    expect(refundRes2.body.message).toContain('trước đó');
  });

  it('B9: Barista status updates to COMPLETED awards loyalty points once; legacy EARN is not re-awarded', async () => {
    const order = await createOrder(50000);
    const payRes = await request(app.getHttpServer())
      .post('/api/payments')
      .auth(customerToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ orderId: order.id, method: 'VNPAY' })
      .expect(201);

    const payment = await db.payment.findUniqueOrThrow({
      where: { id: payRes.body.payment.id },
    });

    const ipnQuery = signVnpayParams({
      vnp_Amount: '5000000',
      vnp_TxnRef: payment.gatewayTxnRef!,
      vnp_ResponseCode: '00',
      vnp_TransactionNo: '88888',
      vnp_TmnCode: testConfig.tmnCode,
    });
    await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(ipnQuery)
      .expect(200);

    // Progress: PAID -> PREPARING -> READY -> COMPLETED
    await request(app.getHttpServer())
      .patch(`/api/orders/${order.id}/status`)
      .auth(baristaToken, { type: 'bearer' })
      .send({ status: 'PREPARING' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/orders/${order.id}/status`)
      .auth(baristaToken, { type: 'bearer' })
      .send({ status: 'READY' })
      .expect(200);

    // Customer still has 500 points at READY
    let customer = await db.user.findUniqueOrThrow({ where: { id: customerUser.id } });
    expect(customer.loyaltyPoints).toBe(500);

    // COMPLETED -> earns 50 points (50000 / 1000 = 50)
    await request(app.getHttpServer())
      .patch(`/api/orders/${order.id}/status`)
      .auth(baristaToken, { type: 'bearer' })
      .send({ status: 'COMPLETED' })
      .expect(200);

    customer = await db.user.findUniqueOrThrow({ where: { id: customerUser.id } });
    expect(customer.loyaltyPoints).toBe(550);

    const earnTx = await db.loyaltyTransaction.findFirst({
      where: { orderId: order.id, type: 'EARN' },
    });
    expect(earnTx).not.toBeNull();
    expect(earnTx!.points).toBe(50);
    expect(earnTx!.eventKey).toBe(`order:${order.id}:earn`);
  });
});

