import { randomUUID } from 'node:crypto';
import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { databaseFixture, type DatabaseFixture } from './database-fixture.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { OrderExpiryJob } from '../src/orders/order-expiry.job.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { MockPaymentService } from '../src/payments/mock-payment.service.js';
import { VnpayGateway } from '../src/payments/vnpay/vnpay.gateway.js';
import { buildPaymentUrl } from '../src/payments/vnpay/vnpay.util.js';

describe('Voucher expiry and zero-total orders: PostgreSQL and HTTP', () => {
  let f: DatabaseFixture;
  beforeAll(async () => {
    f = await databaseFixture();
  }, 35000);
  afterAll(async () => {
    await f?.close();
  });
  afterEach(() => vi.restoreAllMocks());

  async function catalog(value = 5000, usageLimit = 1, stock = '1000') {
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
        price: 50000,
        category: 'Voucher test',
        imageUrl: '/test',
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
        value,
        usageLimit,
        startsAt: new Date('2020-01-01'),
        expiresAt: new Date('2099-01-01'),
      },
    });
    return {
      ingredient,
      product,
      promo,
      body: {
        items: [{ productId: product.id, size: 'S', quantity: 1 }],
        promoCode: promo.code,
      },
    };
  }
  const post = (body: object, key = randomUUID()) =>
    f
      .api('post', '/orders', f.customer.token)
      .set('Idempotency-Key', key)
      .send(body);
  const cancel = (id: number) =>
    f.api('post', `/orders/${id}/cancel`, f.customer.token);
  const expire = () => f.app.get(OrderExpiryJob).runExpiry();
  async function age(id: number) {
    await f.db.order.update({
      where: { id },
      data: { createdAt: new Date(Date.now() - 16 * 60000) },
    });
  }
  const used = async (id: number) =>
    (await f.db.promoCode.findUniqueOrThrow({ where: { id } })).usedCount;
  function gateway() {
    const service = f.app.get(VnpayGateway);
    vi.spyOn(service, 'isConfigured').mockReturnValue(true);
    const link = vi
      .spyOn(service, 'createPaymentUrl')
      .mockImplementation((params) =>
        buildPaymentUrl(
          {
            tmnCode: 'TESTTMN',
            hashSecret: 'TESTSECRET',
            payUrl: 'https://vnpay.test/pay',
            apiUrl: 'https://vnpay.test/api',
            returnUrl: 'http://localhost/payment/vnpay-return',
          },
          params,
        ),
      );
    const query = vi
      .spyOn(service, 'queryTransaction')
      .mockResolvedValue({ raw: {}, success: false, responseCode: '99' });
    return { query, link };
  }
  async function startPayment(orderId: number, pointsUsed = 0) {
    const response = await f
      .api('post', '/payments', f.customer.token)
      .set('Idempotency-Key', randomUUID())
      .send({ orderId, method: 'VNPAY', pointsUsed })
      .expect(201);
    return f.db.payment.findUniqueOrThrow({
      where: { id: response.body.payment.id },
    });
  }
  async function expirePayment(id: number) {
    await f.db.payment.update({
      where: { id },
      data: {
        gatewayCreatedAt: new Date(Date.now() - 20 * 60000),
        expiresAt: new Date(Date.now() - 60000),
      },
    });
  }

  it('the last voucher slot is usable again after an abandoned order expires', async () => {
    const { promo, body } = await catalog();
    const key = randomUUID();
    const first = await post(body, key).expect(201);
    await post(body).expect(422);
    await age(first.body.id);
    await expire();
    expect(
      await f.db.order.findUniqueOrThrow({ where: { id: first.body.id } }),
    ).toMatchObject({ status: 'CANCELLED', promoReleasedAt: expect.any(Date) });
    expect(await used(promo.id)).toBe(0);
    const second = await post(body).expect(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect(await used(promo.id)).toBe(1);
    expect((await post(body, key).expect(201)).body.status).toBe('CANCELLED');
    await expire();
    expect(await used(promo.id)).toBe(1);
  });

  it('concurrent expiry workers and cancellation release one voucher slot only once', async () => {
    const { promo, body } = await catalog();
    const first = await post(body).expect(201);
    await age(first.body.id);
    const orders = f.app.get(OrdersService);
    const results = await Promise.all([
      orders.expirePendingOrders(),
      orders.expirePendingOrders(),
      cancel(first.body.id),
    ]);
    expect([200, 409]).toContain(results[2].status);
    await Promise.all([
      orders.expirePendingOrders(),
      orders.expirePendingOrders(),
    ]);
    expect(await used(promo.id)).toBe(0);
    expect(
      (await f.db.order.findUniqueOrThrow({ where: { id: first.body.id } }))
        .promoReleasedAt,
    ).not.toBeNull();
  });

  it('an unknown VNPAY outcome retains the voucher and points until confirmed unpaid', async () => {
    const { promo, body } = await catalog();
    const { query } = gateway();
    await f.db.user.update({
      where: { id: f.customer.id },
      data: { loyaltyPoints: 1000 },
    });
    const first = await post(body).expect(201);
    const payment = await startPayment(first.body.id, 100);
    await age(first.body.id);
    await expirePayment(payment.id);
    await expire();
    expect(query).toHaveBeenCalled();
    expect(await used(promo.id)).toBe(1);
    expect(
      await f.db.order.findUniqueOrThrow({ where: { id: first.body.id } }),
    ).toMatchObject({ status: 'PENDING', promoReleasedAt: null });
    expect(
      (await f.db.user.findUniqueOrThrow({ where: { id: f.customer.id } }))
        .loyaltyPoints,
    ).toBe(900);
    query.mockResolvedValue({
      raw: {},
      success: false,
      responseCode: '00',
      transactionStatus: '01',
      amount: payment.amount,
    });
    await expire();
    await expire();
    expect(await used(promo.id)).toBe(0);
    expect(
      (await f.db.payment.findUniqueOrThrow({ where: { id: payment.id } }))
        .status,
    ).toBe('EXPIRED');
    expect(
      (await f.db.user.findUniqueOrThrow({ where: { id: f.customer.id } }))
        .loyaltyPoints,
    ).toBe(1000);
    expect(
      await f.db.loyaltyTransaction.count({
        where: { paymentId: payment.id, type: 'REFUND' },
      }),
    ).toBe(1);
  });

  it('cancellation racing expiry with an unknown gateway result defers voucher release until reconciliation', async () => {
    const { promo, body } = await catalog();
    const { query } = gateway();
    const first = await post(body).expect(201);
    const payment = await startPayment(first.body.id);
    await age(first.body.id);
    await expirePayment(payment.id);
    const orders = f.app.get(OrdersService);
    const results = await Promise.all([
      cancel(first.body.id), orders.expirePendingOrders(), orders.expirePendingOrders(),
    ]);
    expect(results[0].status).toBe(200);
    await expire();
    expect(await used(promo.id)).toBe(1);
    expect(
      (await f.db.order.findUniqueOrThrow({ where: { id: first.body.id } }))
        .promoReleasedAt,
    ).toBeNull();
    query.mockResolvedValue({
      raw: {},
      success: false,
      responseCode: '00',
      transactionStatus: '01',
      amount: payment.amount,
    });
    await expire();
    await expire();
    expect(await used(promo.id)).toBe(0);
    await post(body).expect(201);
    // Late collection uses the existing refund path and cannot release the new use.
    const payments = f.app.get(PaymentsService);
    const late = () =>
      payments.settlePayment({
        paymentId: payment.id,
        gatewayResult: {
          success: true,
          responseCode: '00',
          transactionStatus: '00',
          transactionNo: `LATE_${payment.id}`,
          source: 'IPN',
        },
      });
    await Promise.all([late(), late()]);
    await expire();
    expect(await used(promo.id)).toBe(1);
    expect(
      (await f.db.order.findUniqueOrThrow({ where: { id: first.body.id } }))
        .status,
    ).toBe('CANCELLED');
    expect(
      (await f.db.payment.findUniqueOrThrow({ where: { id: payment.id } }))
        .status,
    ).toBe('NEEDS_REFUND');
    expect(
      await f.db.paymentRefund.count({ where: { paymentId: payment.id } }),
    ).toBe(1);
  });

  it('a live VNPAY link is retained; confirmed collection at expiry pays the order and retains the voucher', async () => {
    const { promo, body } = await catalog();
    const { query } = gateway();
    const first = await post(body).expect(201);
    const payment = await startPayment(first.body.id);
    await age(first.body.id);
    await expire();
    expect(query).not.toHaveBeenCalled();
    expect(await used(promo.id)).toBe(1);
    await expirePayment(payment.id);
    query.mockResolvedValue({
      raw: {},
      success: true,
      responseCode: '00',
      transactionStatus: '00',
      transactionNo: `PAID_${payment.id}`,
      amount: payment.amount,
    });
    await expire();
    expect(
      (await f.db.order.findUniqueOrThrow({ where: { id: first.body.id } }))
        .status,
    ).toBe('PAID');
    expect(await used(promo.id)).toBe(1);
  });

  it.each(['FIXED', 'PERCENT'] as const)(
    'a validated %s voucher pays a zero-total order once and consumes its one hold in preparation',
    async (type) => {
      const { promo, body, ingredient } = await catalog(50000);
      if (type === 'PERCENT')
        await f.db.promoCode.update({
          where: { id: promo.id },
          data: { type, value: 100 },
        });
      const { link } = gateway();
      const charge = vi.spyOn(f.app.get(MockPaymentService), 'charge');
      const before = (
        await f.db.user.findUniqueOrThrow({ where: { id: f.customer.id } })
      ).loyaltyPoints;
      const key = randomUUID();
      const [first, second] = await Promise.all([
        post(body, key),
        post(body, key),
      ]);
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(first.body).toEqual(second.body);
      expect(first.body).toMatchObject({
        status: 'PAID',
        total: 0,
        discountAmount: 50000,
        pointsEarned: 0,
      });
      const orderId = first.body.id;
      await post(body, key).expect(201);
      await age(orderId);
      await expire();
      expect(await used(promo.id)).toBe(1);
      expect(await f.db.order.count({ where: { promoCode: promo.code } })).toBe(
        1,
      );
      expect(await f.db.payment.count({ where: { orderId } })).toBe(0);
      expect(link).not.toHaveBeenCalled();
      expect(charge).not.toHaveBeenCalled();
      expect(
        (await f.db.user.findUniqueOrThrow({ where: { id: f.customer.id } }))
          .loyaltyPoints,
      ).toBe(before);
      expect(
        await f.db.loyaltyTransaction.findMany({ where: { orderId } }),
      ).toMatchObject([{ type: 'EARN', points: 0 }]);
      expect(
        await f.db.inventoryReservation.findMany({ where: { orderId } }),
      ).toMatchObject([{ status: 'HELD' }]);
      expect(
        await f.db.inventoryMovement.count({
          where: { orderId, kind: 'HOLD' },
        }),
      ).toBe(1);
      const prepare = () =>
        f
          .api('patch', `/orders/${orderId}/status`, f.barista.token)
          .send({ status: 'PREPARING' });
      const prepared = await Promise.all([prepare(), prepare()]);
      expect(
        prepared.map((result) => result.status).sort((a, b) => a - b),
      ).toEqual([200, 409]);
      expect(
        await f.db.inventoryMovement.count({
          where: { orderId, kind: 'CONSUME' },
        }),
      ).toBe(1);
      expect(
        (
          await f.db.ingredient.findUniqueOrThrow({
            where: { id: ingredient.id },
          })
        ).stockQuantity.toString(),
      ).toBe('980');
    },
  );

  it('two zero-total orders competing for the last ingredients admit only one and roll back the losing voucher claim', async () => {
    const { promo, body } = await catalog(50000, 2, '20');
    const results = await Promise.all([post(body), post(body)]);
    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([201, 409]);
    expect(results.find((result) => result.status === 409)!.body.code).toBe(
      'INSUFFICIENT_INGREDIENTS',
    );
    expect(await used(promo.id)).toBe(1);
    expect(await f.db.order.count({ where: { promoCode: promo.code } })).toBe(
      1,
    );
  });

  it('an expired full-discount voucher cannot create a paid order or consume its usage', async () => {
    const { promo, body } = await catalog(50000);
    await f.db.promoCode.update({
      where: { id: promo.id },
      data: { expiresAt: new Date('2020-01-02') },
    });
    expect((await post(body).expect(422)).body.code).toBe('PROMO_EXPIRED');
    expect(await used(promo.id)).toBe(0);
    expect(await f.db.order.count({ where: { promoCode: promo.code } })).toBe(
      0,
    );
  });
});
