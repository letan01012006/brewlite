import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceLoader, memoryStorage } from "./load-source.mjs";

const load = sourceLoader();
const {
  pointsEarnedFor,
  pointsToDiscountVnd,
  WELCOME_POINTS,
  VND_PER_LOYALTY_POINT,
  POINTS_STEP,
  VND_PER_STEP,
} = load("src/lib/loyalty.ts");
const { CheckoutFlow } = load("src/lib/checkout-flow.ts");
const { maxRedeemablePoints } = load("src/lib/loyalty.ts");

test("maximum points rounds balances, preserves excess and respects the VNPAY minimum", () => {
  for (const [balance, total, expected] of [
    [162, 90000, 160],
    [2000, 30000, 600],
    [19, 30000, 0],
    [139, 10000, 100],
    [200, 10000, 200],
    [1000, 10500, 100],
    [1000, 4000, 80],
    [60, 4000, 0],
    [1000, 4500, 0],
    [100, 0, 0],
    [0, 50000, 0],
    [NaN, 50000, 0],
    [100, Infinity, 0],
  ])
    assert.equal(
      maxRedeemablePoints(balance, total),
      expected,
      `${balance} points / ${total} VND`,
    );

  for (let total = 0; total <= 60000; total += 500) {
    for (let balance = 0; balance < 1400; balance += 37) {
      const used = maxRedeemablePoints(balance, total);
      const discount = pointsToDiscountVnd(used);
      assert.equal(used % 20, 0);
      assert.ok(used <= balance && discount <= total);
      if (used > 0)
        assert.ok(total - discount === 0 || total - discount >= 5000);
      const nextDiscount = pointsToDiscountVnd(used + 20);
      assert.ok(
        used + 20 > balance ||
          nextDiscount > total ||
          (total - nextDiscount > 0 && total - nextDiscount < 5000),
      );
    }
  }
});

test("loyalty rules: 1000 welcome points and 1 point per 1.000 VND (floor)", () => {
  assert.equal(WELCOME_POINTS, 1000);
  assert.equal(VND_PER_LOYALTY_POINT, 1000);
  assert.equal(POINTS_STEP, 20);
  assert.equal(VND_PER_STEP, 1000);
  assert.equal(pointsEarnedFor(0), 0);
  assert.equal(pointsEarnedFor(-5000), 0);
  assert.equal(pointsEarnedFor(999), 0);
  assert.equal(pointsEarnedFor(1000), 1);
  assert.equal(pointsEarnedFor(45900), 45);
  assert.equal(pointsEarnedFor(50000), 50);
  assert.equal(pointsEarnedFor(110700), 110);
});

test("points redemption conversion: 20 points = 1.000 VND", () => {
  assert.equal(pointsToDiscountVnd(0), 0);
  assert.equal(pointsToDiscountVnd(-20), 0);
  assert.equal(pointsToDiscountVnd(19), 0);
  assert.equal(pointsToDiscountVnd(20), 1000);
  assert.equal(pointsToDiscountVnd(39), 1000);
  assert.equal(pointsToDiscountVnd(40), 2000);
  assert.equal(pointsToDiscountVnd(100), 5000);
  assert.equal(pointsToDiscountVnd(1000), 50000);
});

test("checkout flow: VNPAY payment returns paymentUrl and sets phase to redirecting", async () => {
  const order = {
    id: 99,
    total: 50000,
    subtotal: 50000,
    discountAmount: 0,
    status: "PENDING",
    pointsEarned: 0,
    items: [],
  };

  const vnpaySuccessResponse = {
    payment: {
      id: 10,
      method: "VNPAY",
      status: "PROCESSING",
      amount: 50000,
      paymentUrl:
        "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_TxnRef=123",
      expiresAt: "2026-11-05T10:00:00Z",
    },
    order: {
      id: 99,
      status: "PENDING",
      total: 50000,
      pointsEarned: 0,
    },
  };

  const calls = [];
  const flow = new CheckoutFlow(memoryStorage(), async (path, options) => {
    calls.push({ path, body: options?.body && JSON.parse(options.body) });
    if (path === "/orders" || path === "/orders/99") return order;
    if (path === "/payments") return vnpaySuccessResponse;
    throw new Error(`Unexpected path ${path}`);
  });

  await flow.prepare(1, "cart-key-vnpay", {});
  const session = await flow.pay(1, "VNPAY", "SUCCESS");

  assert.equal(session.phase, "redirecting");
  assert.equal(session.paymentUrl, vnpaySuccessResponse.payment.paymentUrl);
  assert.equal(calls.filter((c) => c.path === "/payments").length, 1);
  const paymentCall = calls.find((c) => c.path === "/payments");
  assert.equal(paymentCall.body.method, "VNPAY");
  assert.equal(paymentCall.body.orderId, 99);
  assert.equal(Object.hasOwn(paymentCall.body, "mockResult"), false);
  assert.ok(paymentCall.body.idempotencyKey);
});

test("restored VNPAY attempts drop the legacy mock field without changing the key", async () => {
  const order = {
    id: 99,
    status: "PENDING",
    total: 50000,
    payments: [{ method: "VNPAY", status: "PROCESSING" }],
  };
  const storage = memoryStorage();
  storage.setItem(
    "brewlite_checkout_v1_1",
    JSON.stringify({
      cartKey: "existing-cart",
      phase: "paying",
      order,
      attempt: {
        orderId: 99,
        method: "VNPAY",
        mockResult: "SUCCESS",
        idempotencyKey: "existing-vnpay-key",
        bankCode: "NCB",
        pointsUsed: 100,
      },
    }),
  );
  let sent;
  const flow = new CheckoutFlow(storage, async (path, options) => {
    if (path !== "/payments") return order;
    sent = JSON.parse(options.body);
    assert.equal(options.headers["Idempotency-Key"], "existing-vnpay-key");
    return {
      payment: { method: "VNPAY", status: "PROCESSING", paymentUrl: "https://vnpay.test/pay" },
      order,
    };
  });

  const session = await flow.pay(1, "VNPAY");
  assert.equal(Object.hasOwn(sent, "mockResult"), false);
  assert.equal(sent.idempotencyKey, "existing-vnpay-key");
  assert.equal(sent.bankCode, "NCB");
  assert.equal(sent.pointsUsed, 100);
  assert.equal(session.phase, "redirecting");
  assert.equal(flow.read(1).attempt.mockResult, undefined);
});

test("checkout flow: POINTS 100% completes immediately without gateway redirect", async () => {
  const order = {
    id: 101,
    total: 20000,
    subtotal: 20000,
    discountAmount: 0,
    status: "PENDING",
    pointsEarned: 0,
    items: [],
  };

  const pointsSuccessResponse = {
    payment: {
      id: 15,
      method: "POINTS",
      status: "SUCCESS",
      amount: 0,
      pointsUsed: 400,
      pointsAmount: 20000,
    },
    order: {
      id: 101,
      status: "PAID",
      total: 20000,
      pointsEarned: 0,
    },
  };

  const calls = [];
  const flow = new CheckoutFlow(memoryStorage(), async (path, options) => {
    calls.push({ path, body: options?.body && JSON.parse(options.body) });
    if (path === "/orders" || path === "/orders/101") return order;
    if (path === "/payments") return pointsSuccessResponse;
    throw new Error(`Unexpected path ${path}`);
  });

  await flow.prepare(1, "cart-key-points", {});
  const session = await flow.pay(1, "POINTS", "SUCCESS", undefined, 400);

  assert.equal(session.phase, "paid");
  assert.equal(session.order?.status, "PAID");
  assert.equal(session.paymentUrl, undefined);
  const paymentCall = calls.find((c) => c.path === "/payments");
  assert.equal(paymentCall.body.method, "POINTS");
  assert.equal(paymentCall.body.pointsUsed, 400);
  assert.equal(Object.hasOwn(paymentCall.body, "mockResult"), false);
});

test("checkout flow: retry after redirect/failure generates fresh idempotencyKey", async () => {
  const order = {
    id: 102,
    total: 50000,
    subtotal: 50000,
    discountAmount: 0,
    status: "PENDING",
    pointsEarned: 0,
    items: [],
  };

  const keysUsed = [];
  const flow = new CheckoutFlow(memoryStorage(), async (path, options) => {
    if (path === "/orders" || path === "/orders/102") return order;
    if (path === "/payments") {
      const body = JSON.parse(options.body);
      keysUsed.push(body.idempotencyKey);
      return {
        payment: {
          id: keysUsed.length,
          method: "VNPAY",
          status: "PROCESSING",
          amount: 50000,
          paymentUrl: `https://vnpay.test/pay?key=${body.idempotencyKey}`,
        },
        order: { id: 102, status: "PENDING", total: 50000 },
      };
    }
    throw new Error(`Unexpected path ${path}`);
  });

  await flow.prepare(1, "cart-key-retry", {});
  // First attempt
  const s1 = await flow.pay(1, "VNPAY");
  assert.equal(s1.phase, "redirecting");
  const firstKey = keysUsed[0];

  // User cancelled on VNPAY and came back -> resetAttempt is called
  flow.resetAttempt(1);
  const restored = flow.read(1);
  assert.equal(restored?.attempt, undefined);
  assert.equal(restored?.phase, "ready");

  // Second attempt ("Thử lại thanh toán")
  const s2 = await flow.pay(1, "VNPAY");
  const secondKey = keysUsed[1];
  assert.notEqual(
    firstKey,
    secondKey,
    "Must generate a brand new idempotencyKey for retry",
  );
  assert.equal(s2.phase, "redirecting");
});

test("checkout flow: new cart after cancelled order creates fresh order without stale ID", async () => {
  let createdOrderId = 100;
  const storage = memoryStorage();
  const flow = new CheckoutFlow(storage, async (path) => {
    if (path === "/orders") {
      createdOrderId++;
      return {
        id: createdOrderId,
        total: 30000,
        subtotal: 30000,
        discountAmount: 0,
        status: "PENDING",
        pointsEarned: 0,
        items: [],
      };
    }
    throw new Error(`Unexpected path ${path}`);
  });

  // Order 1
  const s1 = await flow.prepare(1, "cart-1", {});
  assert.equal(s1.order.id, 101);

  // User cancelled order 1 -> storage cleared / new cart
  flow.clear(1);

  // User adds new items and prepares cart-2
  const s2 = await flow.prepare(1, "cart-2", {});
  assert.equal(s2.order.id, 102);
  assert.notEqual(s2.order.id, 101);
});


test("VNPAY without a payment URL waits for backend confirmation and keeps its retry key", async () => {
  const order = { id: 203, status: "PENDING", total: 50000, payments: [] };
  const keys = [];
  let confirmed = false;
  const flow = new CheckoutFlow(memoryStorage(), async (path, options) => {
    if (path !== "/payments") return order;
    keys.push(options.headers["Idempotency-Key"]);
    return {
      payment: { method: "VNPAY", status: confirmed ? "SUCCESS" : "PROCESSING" },
      order: { ...order, status: confirmed ? "PAID" : "PENDING" },
    };
  });
  await flow.prepare(1, "cart-vnpay", {});
  await assert.rejects(flow.pay(1, "VNPAY"));
  assert.equal(flow.read(1).phase, "paying");
  confirmed = true;
  assert.equal((await flow.pay(1, "VNPAY")).phase, "paid");
  assert.equal(keys[0], keys[1]);
});

for (const [paymentStatus, orderStatus] of [
  ["SUCCESS", "PENDING"], ["NEEDS_REFUND", "CANCELLED"],
  ["FAILED", "PAYMENT_FAILED"], ["PROCESSING", "PENDING"],
]) {
  test(`VNPAY ${paymentStatus}/${orderStatus} never reports checkout success`, async () => {
    const order = { id: 204, status: "PENDING", total: 50000, payments: [] };
    const flow = new CheckoutFlow(memoryStorage(), async (path) => path === "/payments"
      ? { payment: { method: "VNPAY", status: paymentStatus }, order: { ...order, status: orderStatus } }
      : order);
    await flow.prepare(1, "cart-unconfirmed", {});
    await assert.rejects(flow.pay(1, "VNPAY"));
    assert.notEqual(flow.read(1).phase, "paid");
  });
}


test("resuming checkout replaces a stale paid phase with the backend order status", () => {
  const flow = new CheckoutFlow(memoryStorage());
  flow.save(1, { cartKey: "stale-paid", phase: "paid", order: { id: 205, status: "PAID" } });
  const session = flow.startOrder(1, { id: 205, status: "PENDING" });
  assert.equal(session.phase, "ready");
});
