import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { signParams } from '../src/payments/vnpay/vnpay.util.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `brewlite_test_vnpay_${randomUUID().replaceAll('-', '')}`;

describe.skipIf(!databaseUrl)('VNPAY Sandbox and Loyalty Points Ledger (E2E)', () => {
  let admin: PrismaClient;
  let db: PrismaClient;
  let app: INestApplication;
  let schemaCreated = false;
  let userId: number;
  let customerToken: string;
  const hashSecret = process.env.VNPAY_HASH_SECRET || 'SECRET_KEY_TEST';

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
          max: 10,
          application_name: schema,
          options: `-c search_path=${schema}`,
        },
        { schema },
      ),
    });

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

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    if (schemaCreated) {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await admin?.$disconnect();
  });

  beforeEach(async () => {
    const user = await db.user.create({
      data: {
        email: `${randomUUID()}@vnpay-test.example`,
        fullName: 'VNPAY Test Customer',
        passwordHash: 'hashed',
        role: 'CUSTOMER',
        loyaltyPoints: 1000, // 1000 points = 50.000 VND
      },
    });
    userId = user.id;
    customerToken = app.get(JwtService).sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
  });

  async function createOrder(total = 50000) {
    const product = await db.product.create({
      data: {
        name: `Product ${randomUUID().slice(0, 6)}`,
        category: 'Coffee',
        price: total,
        stock: 50,
        imageUrl: '/test.jpg',
      },
    });
    const res = await request(app.getHttpServer())
      .post('/api/orders')
      .auth(customerToken, { type: 'bearer' })
      .send({
        items: [{ productId: product.id, size: 'M', quantity: 1 }],
      })
      .expect(201);
    return res.body;
  }

  it('pays 100% using POINTS: deducts points, marks order PAID, creates REDEEM ledger entry, and awards 0 points', async () => {
    const order = await createOrder(50000); // 50.000 VND = 1000 points
    const idempotencyKey = randomUUID();

    const paymentRes = await request(app.getHttpServer())
      .post('/api/payments')
      .auth(customerToken, { type: 'bearer' })
      .set('Idempotency-Key', idempotencyKey)
      .send({
        orderId: order.id,
        method: 'POINTS',
        pointsUsed: 1000,
      })
      .expect(201);

    expect(paymentRes.body.payment.status).toBe('SUCCESS');
    expect(paymentRes.body.payment.amount).toBe(0);
    expect(paymentRes.body.payment.pointsUsed).toBe(1000);
    expect(paymentRes.body.payment.pointsAmount).toBe(50000);
    expect(paymentRes.body.order.status).toBe('PAID');
    expect(paymentRes.body.order.pointsEarned).toBe(0);

    // Verify user balance is 0
    const updatedUser = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(updatedUser.loyaltyPoints).toBe(0);

    // Verify LoyaltyTransaction
    const ledger = await db.loyaltyTransaction.findFirstOrThrow({
      where: { orderId: order.id, type: 'REDEEM' },
    });
    expect(ledger.points).toBe(-1000);
    expect(ledger.pointsAmount).toBe(50000);
  });

  it('initiates VNPAY payment with partial points, creates PROCESSING payment, holds points, and returns signed URL', async () => {
    const order = await createOrder(100000); // 100.000 VND
    const idempotencyKey = randomUUID();

    // Use 400 points = 20.000 VND -> cash = 80.000 VND
    const paymentRes = await request(app.getHttpServer())
      .post('/api/payments')
      .auth(customerToken, { type: 'bearer' })
      .set('Idempotency-Key', idempotencyKey)
      .send({
        orderId: order.id,
        method: 'VNPAY',
        pointsUsed: 400,
      })
      .expect(201);

    expect(paymentRes.body.payment.status).toBe('PROCESSING');
    expect(paymentRes.body.payment.amount).toBe(80000);
    expect(paymentRes.body.payment.pointsUsed).toBe(400);
    expect(paymentRes.body.payment.pointsAmount).toBe(20000);
    expect(paymentRes.body.paymentUrl).toContain('https://sandbox.vnpayment.vn');
    expect(paymentRes.body.paymentUrl).toContain('vnp_SecureHash=');

    // Points decremented from 1000 -> 600
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.loyaltyPoints).toBe(600);

    // REDEEM transaction exists
    const ledger = await db.loyaltyTransaction.findFirstOrThrow({
      where: { orderId: order.id, type: 'REDEEM' },
    });
    expect(ledger.points).toBe(-400);
  });

  it('handles VNPAY IPN webhook: verifies signature, confirms payment to SUCCESS and order to PAID', async () => {
    const order = await createOrder(80000);
    const idempotencyKey = randomUUID();

    const paymentRes = await request(app.getHttpServer())
      .post('/api/payments')
      .auth(customerToken, { type: 'bearer' })
      .set('Idempotency-Key', idempotencyKey)
      .send({
        orderId: order.id,
        method: 'VNPAY',
        pointsUsed: 0,
      })
      .expect(201);

    const gatewayTxnRef = paymentRes.body.payment.gatewayTxnRef;
    const ipnParams: Record<string, string> = {
      vnp_Amount: '8000000', // 80.000 VND * 100
      vnp_BankCode: 'NCB',
      vnp_CardType: 'ATM',
      vnp_OrderInfo: `Thanh toan don hang #${order.id}`,
      vnp_PayDate: '20261104180000',
      vnp_ResponseCode: '00',
      vnp_TmnCode: 'BREWLITE_TEST',
      vnp_TransactionNo: '14512345',
      vnp_TransactionStatus: '00',
      vnp_TxnRef: gatewayTxnRef,
    };
    const secureHash = signParams(ipnParams, hashSecret);
    ipnParams['vnp_SecureHash'] = secureHash;

    // Send IPN
    const ipnRes = await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(ipnParams)
      .expect(200);

    expect(ipnRes.body).toEqual({ RspCode: '00', Message: 'Confirm Success' });

    // Verify DB state
    const payment = await db.payment.findUniqueOrThrow({
      where: { gatewayTxnRef },
    });
    expect(payment.status).toBe('SUCCESS');
    expect(payment.gatewayTransactionNo).toBe('14512345');

    const updatedOrder = await db.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(updatedOrder.status).toBe('PAID');

    // Test duplicate replay IPN
    const replayRes = await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(ipnParams)
      .expect(200);
    expect(replayRes.body).toEqual({
      RspCode: '02',
      Message: 'Order already confirmed',
    });
  });

  it('rejects tampered IPN signature with RspCode 97', async () => {
    const ipnParams = {
      vnp_Amount: '8000000',
      vnp_TxnRef: 'NON_EXISTENT_OR_TAMPERED',
      vnp_ResponseCode: '00',
      vnp_SecureHash: 'invalid_tampered_hash_1234567890',
    };

    const res = await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(ipnParams)
      .expect(200);

    expect(res.body).toEqual({ RspCode: '97', Message: 'Invalid signature' });
  });

  it('refunds used points when customer cancels payment on VNPAY (code 24)', async () => {
    const order = await createOrder(70000);
    const idempotencyKey = randomUUID();

    // Use 400 points (20.000 VND discount -> 50.000 VND VNPAY)
    const paymentRes = await request(app.getHttpServer())
      .post('/api/payments')
      .auth(customerToken, { type: 'bearer' })
      .set('Idempotency-Key', idempotencyKey)
      .send({
        orderId: order.id,
        method: 'VNPAY',
        pointsUsed: 400,
      })
      .expect(201);

    // Initial 1000 - 400 = 600
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).loyaltyPoints).toBe(600);

    const gatewayTxnRef = paymentRes.body.payment.gatewayTxnRef;
    const ipnParams: Record<string, string> = {
      vnp_Amount: '5000000',
      vnp_ResponseCode: '24', // Customer cancelled
      vnp_TransactionNo: '14599999',
      vnp_TxnRef: gatewayTxnRef,
    };
    ipnParams['vnp_SecureHash'] = signParams(ipnParams, hashSecret);

    const ipnRes = await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(ipnParams)
      .expect(200);

    expect(ipnRes.body).toEqual({ RspCode: '00', Message: 'Confirm Success' });

    // Payment marked FAILED, Order marked PAYMENT_FAILED
    const payment = await db.payment.findUniqueOrThrow({ where: { gatewayTxnRef } });
    expect(payment.status).toBe('FAILED');

    const updatedOrder = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updatedOrder.status).toBe('PAYMENT_FAILED');

    // Points restored back to 1000!
    const restoredUser = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(restoredUser.loyaltyPoints).toBe(1000);

    // REFUND ledger entry exists
    const refundLedger = await db.loyaltyTransaction.findFirstOrThrow({
      where: { orderId: order.id, type: 'REFUND' },
    });
    expect(refundLedger.points).toBe(400);
  });
});
