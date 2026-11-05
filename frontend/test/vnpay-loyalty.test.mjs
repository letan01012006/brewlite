import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceLoader, memoryStorage } from "./load-source.mjs";

const load = sourceLoader();
const { pointsEarnedFor, WELCOME_POINTS, VND_PER_LOYALTY_POINT } = load("src/lib/loyalty.ts");
const { CheckoutFlow } = load("src/lib/checkout-flow.ts");

test("loyalty rules: 500 welcome points and 1 point per 1.000 VND (floor)", () => {
  assert.equal(WELCOME_POINTS, 500);
  assert.equal(VND_PER_LOYALTY_POINT, 1000);
  assert.equal(pointsEarnedFor(0), 0);
  assert.equal(pointsEarnedFor(-5000), 0);
  assert.equal(pointsEarnedFor(999), 0);
  assert.equal(pointsEarnedFor(1000), 1);
  assert.equal(pointsEarnedFor(45900), 45);
  assert.equal(pointsEarnedFor(50000), 50);
  assert.equal(pointsEarnedFor(110700), 110);
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
      paymentUrl: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_TxnRef=123",
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
  const session = await flow.pay(1, "VNPAY");

  assert.equal(session.phase, "redirecting");
  assert.equal(session.paymentUrl, vnpaySuccessResponse.payment.paymentUrl);
  assert.equal(calls.filter((c) => c.path === "/payments").length, 1);
  const paymentCall = calls.find((c) => c.path === "/payments");
  assert.equal(paymentCall.body.method, "VNPAY");
  assert.equal(paymentCall.body.orderId, 99);
  assert.ok(paymentCall.body.idempotencyKey);
});

