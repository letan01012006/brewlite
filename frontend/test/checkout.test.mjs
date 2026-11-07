import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceLoader, memoryStorage, deferred } from "./load-source.mjs";

const load = sourceLoader();
const { CheckoutFlow } = load("src/lib/checkout-flow.ts");
const { ApiError } = load("src/lib/api/client.ts");
const order = {
  id: 100,
  total: 45000,
  subtotal: 50000,
  discountAmount: 5000,
  pointsEarned: 0,
  status: "PENDING",
  items: [],
  payments: [],
};
const success = {
  payment: { method: "CARD" },
  order: { id: 100, status: "PAID", total: 45000, pointsEarned: 45 },
};

test("confirmed failure retries the SAME order with a NEW key", async () => {
  const calls = [];
  const flow = new CheckoutFlow(memoryStorage(), async (path, options) => {
    calls.push({ path, body: options?.body && JSON.parse(options.body) });
    if (path === "/orders" || path === "/orders/100") return order;
    if (calls.filter((c) => c.path === "/payments").length === 1)
      throw new ApiError("Declined", 402, "PAYMENT_FAILED");
    return success;
  });
  await flow.prepare(1, "cart", {});
  await assert.rejects(flow.pay(1, "CARD", "FAILED"));
  await flow.prepare(1, "cart", {});
  const paid = await flow.pay(1, "CARD", "SUCCESS");
  const attempts = calls.filter((c) => c.path === "/payments");
  assert.equal(calls.filter((c) => c.path === "/orders").length, 1);
  assert.equal(attempts[0].body.orderId, attempts[1].body.orderId);
  assert.notEqual(
    attempts[0].body.idempotencyKey,
    attempts[1].body.idempotencyKey,
  );
  assert.equal(paid.order.pointsEarned, 45);
});

for (const failure of [
  new Error("Offline"),
  new ApiError("Processing", 409, "PAYMENT_IN_PROGRESS"),
  new ApiError("Gateway", 502, "UNKNOWN"),
]) {
  test(`unknown payment (${failure.message}) survives reload and replays exact body`, async () => {
    const storage = memoryStorage();
    const attempts = [];
    const api = async (path, options) => {
      if (path !== "/payments") return order;
      attempts.push(options.body);
      if (attempts.length === 1) throw failure;
      return success;
    };
    const flow = new CheckoutFlow(storage, api);
    await flow.prepare(1, "cart", {});
    await assert.rejects(flow.pay(1, "CARD", "SUCCESS"));
    const restored = new CheckoutFlow(storage, api);
    await restored.pay(1, "WALLET", "FAILED");
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0], attempts[1]);
    assert.equal(restored.read(1).paidMethod, "CARD");
  });
}

test("lost success response is reconciled from order without another payment", async () => {
  let charged = false;
  let requests = 0;
  const flow = new CheckoutFlow(memoryStorage(), async (path) => {
    if (path === "/orders") return order;
    if (path === "/orders/100")
      return charged
        ? {
            ...order,
            status: "PREPARING",
            pointsEarned: 45,
            payments: [{ status: "SUCCESS", method: "CARD" }],
          }
        : order;
    requests++;
    charged = true;
    throw new Error("Response lost");
  });
  await flow.prepare(1, "cart", {});
  await assert.rejects(flow.pay(1, "CARD", "SUCCESS"));
  const paid = await flow.pay(1, "WALLET", "FAILED");
  assert.equal(requests, 1);
  assert.equal(paid.phase, "paid");
  assert.equal(paid.paidMethod, "CARD");
});

test("ambiguous order creation is not automatically repeated after reload", async () => {
  const storage = memoryStorage();
  let requests = 0;
  const api = async () => {
    requests++;
    throw new Error("Response lost");
  };
  await assert.rejects(new CheckoutFlow(storage, api).prepare(1, "cart", {}));
  await assert.rejects(new CheckoutFlow(storage, api).prepare(1, "cart", {}));
  assert.equal(requests, 1);
});

test("a definitive rejected order can be corrected and submitted again", async () => {
  let requests = 0;
  const flow = new CheckoutFlow(memoryStorage(), async () => {
    if (++requests === 1) throw new ApiError("Stock", 409, "OUT_OF_STOCK");
    return order;
  });
  await assert.rejects(flow.prepare(1, "cart", {}));
  await flow.prepare(1, "corrected", {});
  assert.equal(requests, 2);
});

test("creation marker prevents concurrent double submission", async () => {
  const pending = deferred();
  let requests = 0;
  const flow = new CheckoutFlow(memoryStorage(), () => {
    requests++;
    return pending.promise;
  });
  const first = flow.prepare(1, "cart", {});
  await assert.rejects(flow.prepare(1, "cart", {}));
  pending.resolve(order);
  await first;
  assert.equal(requests, 1);
});

test("storage failure stops mutations and sessions are isolated per account", async () => {
  let requests = 0;
  const unavailable = {
    ...memoryStorage(),
    setItem: () => {
      throw new Error("Storage unavailable");
    },
  };
  await assert.rejects(
    new CheckoutFlow(unavailable, async () => {
      requests++;
      return order;
    }).prepare(1, "cart", {}),
  );
  assert.equal(requests, 0);
  const flow = new CheckoutFlow(memoryStorage(), async () => order);
  await flow.prepare(1, "cart", {});
  assert.equal(flow.read(2), null);
});

test("unknown creation can be recovered by fetching an existing order", async () => {
  const flow = new CheckoutFlow(memoryStorage(), async (path) => {
    if (path === "/orders") throw new Error("Offline");
    assert.equal(path, "/orders/100");
    return order;
  });
  await assert.rejects(flow.prepare(1, "cart", {}));
  const session = await flow.recover(1, 100);
  assert.equal(session.order.id, 100);
});

test("lost cancellation response keeps session until cancellation is confirmed", async () => {
  let cancelled = false;
  let mutations = 0;
  const flow = new CheckoutFlow(memoryStorage(), async (path) => {
    if (path === "/orders") return order;
    if (path.endsWith("/cancel")) {
      mutations++;
      cancelled = true;
      throw new Error("Offline");
    }
    return { ...order, status: cancelled ? "CANCELLED" : "PENDING" };
  });
  await flow.prepare(1, "cart", {});
  await assert.rejects(flow.cancel(1));
  assert.ok(flow.read(1));
  await flow.cancel(1);
  assert.equal(flow.read(1), null);
  assert.equal(mutations, 1);
});

test("a cancelled order cannot be paid; a different cart can create a new order", async () => {
  const calls = [];
  const flow = new CheckoutFlow(memoryStorage(), async (path) => {
    calls.push(path);
    return path === "/orders" ? order : { ...order, status: "CANCELLED" };
  });
  await flow.prepare(1, "cart", {});
  await assert.rejects(flow.pay(1, "CARD", "SUCCESS"));
  await flow.prepare(1, "different-cart", {});
  assert.equal(calls.filter((path) => path === "/orders").length, 2);
  assert.equal(calls.filter((path) => path === "/payments").length, 0);
});

test("a recovered processing order waits instead of starting a new payment", async () => {
  let payments = 0;
  const flow = new CheckoutFlow(memoryStorage(), async (path) => {
    if (path === "/payments") payments++;
    return { ...order, payments: [{ status: "PROCESSING" }] };
  });
  await flow.prepare(1, "cart", {});
  await assert.rejects(flow.pay(1, "CARD", "SUCCESS"));
  assert.equal(payments, 0);
});

for (const phase of ["ready", "failed", "redirecting", "paying"]) {
  test(`a new cart can create an identical basket while the old order is ${phase}`, async () => {
    let created = 0;
    const calls = [];
    const flow = new CheckoutFlow(memoryStorage(), async (path) => {
      calls.push(path);
      return { ...order, id: ++created };
    });
    const first = await flow.prepare(1, "same-basket", {});
    const attempt = {
      orderId: 1,
      method: "VNPAY",
      idempotencyKey: "old-key",
      pointsUsed: 100,
    };
    flow.save(1, { ...first, phase, attempt });
    flow.beginCart(1);
    const second = await flow.prepare(1, "same-basket", {});
    assert.equal(second.order.id, 2);
    assert.deepEqual(calls, ["/orders", "/orders"]);
    assert.equal(flow.read(1, 1).attempt.idempotencyKey, "old-key");
    assert.equal(flow.read(1, 1).phase, phase);
    assert.equal(flow.read(2, 1), null);
    const resumed = flow.startOrder(1, first.order);
    assert.equal(resumed.order.id, 1);
    assert.equal(resumed.attempt.idempotencyKey, "old-key");
    assert.equal(flow.read(1, 2).order.id, 2);
  });
}

test("a changed basket does not silently reuse an unpaid order", async () => {
  let created = 0;
  const flow = new CheckoutFlow(memoryStorage(), async () => ({
    ...order,
    id: ++created,
  }));
  await flow.prepare(1, "first-basket", {});
  const next = await flow.prepare(1, "new-basket", {});
  assert.equal(next.order.id, 2);
  assert.equal(flow.read(1, 1).order.id, 1);
});

test("beginning a new cart preserves an ambiguous creation marker", async () => {
  const flow = new CheckoutFlow(memoryStorage());
  flow.save(1, { cartKey: "unknown", phase: "creating" });
  assert.throws(() => flow.beginCart(1), /lịch sử đơn hàng/);
  assert.equal(flow.read(1).phase, "creating");
});

test("late VNPAY responses and callbacks cannot replace a newer checkout", async () => {
  const pending = deferred();
  let created = 0;
  const flow = new CheckoutFlow(memoryStorage(), async (path) => {
    if (path === "/orders") return { ...order, id: ++created };
    if (path === "/orders/1") return { ...order, id: 1 };
    return pending.promise;
  });
  await flow.prepare(1, "cart-1", {});
  const payment = flow.pay(1, "VNPAY");
  await new Promise(setImmediate);
  flow.beginCart(1);
  await flow.prepare(1, "cart-2", {});
  pending.resolve({
    payment: { method: "VNPAY", paymentUrl: "https://vnpay.test/1" },
    order: { ...order, id: 1 },
  });
  await payment;
  assert.equal(flow.read(1).order.id, 2);
  assert.equal(flow.read(1, 1).phase, "redirecting");
  flow.resetAttempt(1, 1);
  assert.equal(flow.read(1).order.id, 2);
  flow.clear(1, 1);
  assert.equal(flow.read(1).order.id, 2);
  assert.equal(flow.read(1, 1), null);
});

test("a VNPAY order recovered in another tab resumes its existing URL without a new charge", async () => {
  let mutations = 0;
  const pendingOrder = {
    ...order,
    payments: [
      {
        status: "PROCESSING",
        method: "VNPAY",
        paymentUrl: "https://vnpay.test/existing",
        expiresAt: "2999-01-01T00:00:00Z",
      },
    ],
  };
  const flow = new CheckoutFlow(memoryStorage(), async (path, options) => {
    if (options?.method === "POST") mutations++;
    return pendingOrder;
  });
  flow.startOrder(1, pendingOrder);
  const resumed = await flow.pay(1, "VNPAY");
  assert.equal(resumed.paymentUrl, "https://vnpay.test/existing");
  assert.equal(mutations, 0);
});

test("an explicit retry cannot replace an unknown payment's key or points", async () => {
  const attempts = [];
  const flow = new CheckoutFlow(memoryStorage(), async (path, options) => {
    if (path !== "/payments") return order;
    attempts.push(options.body);
    throw new Error("Response lost");
  });
  flow.startOrder(1, order);
  await assert.rejects(flow.pay(1, "VNPAY", undefined, undefined, 100));
  await assert.rejects(flow.pay(1, "VNPAY", undefined, undefined, 0, true));
  assert.equal(attempts[0], attempts[1]);
});
