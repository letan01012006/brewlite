import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { sourceLoader, memoryStorage, deferred, walk } from "./load-source.mjs";

// A handler-level render harness, not a browser/layout test. Real source,
// checkout persistence, cart store and API sequencing run together.
function harness(
  api,
  storage = memoryStorage(),
  { balance = 0, search = "", product = item.product } = {},
) {
  let index = 0;
  const slots = [];
  const effects = [];
  const user = {
    id: 1,
    fullName: "Test",
    loyaltyPoints: balance,
    role: "CUSTOMER",
  };
  const mocks = {
    react: {
      ...React,
      useState: (initial) => {
        const i = index++;
        if (!(i in slots))
          slots[i] = typeof initial === "function" ? initial() : initial;
        return [
          slots[i],
          (value) => {
            slots[i] = typeof value === "function" ? value(slots[i]) : value;
          },
        ];
      },
      useRef: (initial) => {
        const i = index++;
        return (slots[i] ??= { current: initial });
      },
      useEffect: (effect, deps) => {
        const i = index++;
        const previous = slots[i];
        if (!previous || deps.some((value, n) => value !== previous[n]))
          effects.push(effect);
        slots[i] = deps;
      },
    },
    "next/link": "a",
    "next/navigation": { useRouter: () => ({ push() {} }) },
    "@/lib/api/client": {
      apiFetch: (path, options) =>
        path.startsWith("/products/")
          ? Promise.resolve({ ...product, toppings: [] })
          : api(path, options),
      ApiError: class extends Error {},
    },
  };
  const authState = {
    user,
    token: "test",
    initAuth() {},
    refreshUser: async () => {
      authState.refreshed = true;
    },
    isLoading: false,
  };
  const authStore = (selector) => (selector ? selector(authState) : authState);
  authStore.getState = () => authState;
  mocks["@/store/auth-store"] = { useAuthStore: authStore };
  const redirects = [];
  const load = sourceLoader(mocks, {
    URLSearchParams,
    window: {
      sessionStorage: storage,
      location: { search, assign: (url) => redirects.push(url) },
    },
  });
  const store = load("src/store/cart-store.ts").useCartStore;
  store.getState().hydrate(1);
  const cart = (selector) =>
    selector ? selector(store.getState()) : store.getState();
  cart.getState = store.getState;
  mocks["@/store/cart-store"] = { useCartStore: cart };
  const Page = load("src/app/checkout/page.tsx").default().props.children.type;
  const render = () => {
    index = 0;
    return Page();
  };
  const mount = async () => {
    render();
    effects.splice(0).forEach((effect) => effect());
    await new Promise(setImmediate);
    return render();
  };
  return { store, load, render, mount, storage, authState, redirects };
}
const payButton = (tree) =>
  walk(
    tree,
    (node) =>
      node.type === "button" && node.props.onClick?.name === "handlePayOrder",
  )[0];
const item = {
  product: { id: 1, name: "Coffee", price: 50000, stock: 100 },
  size: "S",
  selectedToppings: [],
  quantity: 1,
};
const order = {
  id: 7,
  status: "PENDING",
  total: 45000,
  subtotal: 50000,
  discountAmount: 5000,
  pointsEarned: 0,
  items: [
    { id: 1, productName: "Coffee", size: "S", qty: 1, lineTotal: 50000 },
  ],
  payments: [],
};
const success = {
  payment: { method: "WALLET" },
  order: { id: 7, total: 45000, pointsEarned: 45, status: "PAID" },
};

test("changed server total requires another explicit click before payment", async () => {
  const calls = [];
  const h = harness(async (path) => {
    calls.push(path);
    return path === "/payments" ? success : order;
  });
  h.store.getState().addItem(item);
  await h.mount();
  await payButton(h.render()).props.onClick();
  assert.deepEqual(calls, ["/orders"]);
  const confirmation = payButton(h.render());
  assert.ok(JSON.stringify(confirmation.props.children).includes("45.000"));
  await confirmation.props.onClick();
  assert.deepEqual(calls, ["/orders", "/orders/7", "/payments"]);
  assert.equal(h.store.getState().items.length, 0);
  assert.equal(h.authState.refreshed, true);
  assert.equal(h.storage.getItem("brewlite_checkout_v1_1"), null);
  assert.ok(JSON.stringify(h.render()).includes("45"));
});

test("double click cannot create or pay twice while request is running", async () => {
  const pending = deferred();
  const calls = [];
  const h = harness(async (path) => {
    calls.push(path);
    if (path === "/orders") return pending.promise;
    return path === "/payments" ? success : { ...order, total: 50000 };
  });
  h.store.getState().addItem(item);
  await h.mount();
  const button = payButton(h.render());
  const first = button.props.onClick();
  const second = button.props.onClick();
  pending.resolve({ ...order, total: 50000 });
  await Promise.all([first, second]);
  assert.equal(calls.filter((path) => path === "/orders").length, 1);
  assert.equal(calls.filter((path) => path === "/payments").length, 1);
});

test("reload restores reserved order with empty cart and never creates another", async () => {
  const calls = [];
  const h = harness(async (path) => {
    calls.push(path);
    return path === "/payments" ? success : order;
  });
  const { CheckoutFlow } = h.load("src/lib/checkout-flow.ts");
  await new CheckoutFlow(h.storage).prepare(1, "original-cart", {});
  await h.mount();
  const button = payButton(h.render());
  assert.ok(button);
  await button.props.onClick();
  assert.equal(calls.filter((path) => path === "/orders").length, 1);
  assert.equal(calls.filter((path) => path === "/payments").length, 1);
});

test("checkout is blocked while a promotion request is pending", async () => {
  const calls = [];
  const h = harness(async (path) => {
    calls.push(path);
    return order;
  });
  h.store.getState().addItem(item);
  h.store.setState({ isValidatingPromo: true });
  await h.mount();
  const button = payButton(h.render());
  assert.equal(button.props.disabled, true);
  await button.props.onClick();
  assert.equal(calls.length, 0);
});

test("removing a free disallowed topping requires another confirmation before creating an order", async () => {
  const calls = [];
  const h = harness(async (path) => {
    calls.push(path);
    return path === "/payments"
      ? { ...success, order: { ...success.order, total: 50000 } }
      : { ...order, total: 50000, discountAmount: 0 };
  });
  h.store
    .getState()
    .addItem({
      ...item,
      selectedToppings: [{ id: 71, name: "Free old topping", price: 0 }],
    });
  await h.mount();
  await payButton(h.render()).props.onClick();
  assert.deepEqual(calls, []);
  assert.equal(h.store.getState().getTotal(), 50000);
  assert.equal(h.store.getState().items[0].selectedToppings.length, 0);
  assert.ok(JSON.stringify(h.render()).includes("bấm thanh toán lần nữa"));
  await payButton(h.render()).props.onClick();
  assert.equal(calls.filter((path) => path === "/orders").length, 1);
  assert.equal(calls.filter((path) => path === "/payments").length, 1);
});

const pointsSwitch = (tree) =>
  walk(tree, (node) => node.props?.role === "switch")[0];
const pointsSummary = (tree) =>
  JSON.stringify(walk(tree, (node) => node.props?.id === "points-summary")[0]);

test("maximum-points switch recalculates when balance, promo or cart changes and turns off", async () => {
  const h = harness(async () => order, memoryStorage(), { balance: 162 });
  h.store.getState().addItem(item);
  await h.mount();
  assert.equal(
    walk(h.render(), (node) => node.props?.type === "range").length,
    0,
  );
  assert.equal(pointsSwitch(h.render()).props.checked, false);
  pointsSwitch(h.render()).props.onChange({ target: { checked: true } });
  assert.ok(pointsSummary(h.render()).includes("160"));
  assert.ok(pointsSummary(h.render()).includes("8.000"));

  h.store.getState().setPromo("TEN", 40000);
  assert.ok(pointsSummary(h.render()).includes("100"));
  assert.ok(pointsSummary(h.render()).includes("5.000"));
  h.authState.user = { ...h.authState.user, loyaltyPoints: 70 };
  assert.ok(pointsSummary(h.render()).includes("60"));
  assert.ok(pointsSummary(h.render()).includes("3.000"));
  h.store.getState().updateQuantity(h.store.getState().items[0].id, 2);
  h.store.getState().setPromo(null, 0);
  h.authState.user = { ...h.authState.user, loyaltyPoints: 1239 };
  assert.ok(pointsSummary(h.render()).includes("1.220"));
  assert.ok(pointsSummary(h.render()).includes("61.000"));
  pointsSwitch(h.render()).props.onChange({ target: { checked: false } });
  assert.equal(pointsSwitch(h.render()).props.checked, false);
  assert.ok(!pointsSummary(h.render()).includes("61.000"));
});

test("maximum points pays exactly the order value and leaves surplus points untouched", async () => {
  const calls = [];
  const fullOrder = {
    ...order,
    total: 30000,
    subtotal: 30000,
    discountAmount: 0,
  };
  const h = harness(
    async (path, options) => {
      calls.push({ path, body: options?.body && JSON.parse(options.body) });
      return path === "/payments"
        ? {
            payment: { method: "POINTS", status: "SUCCESS" },
            order: { ...fullOrder, total: 0, status: "PAID" },
          }
        : fullOrder;
    },
    memoryStorage(),
    { balance: 2000, product: { ...item.product, price: 30000 } },
  );
  h.store
    .getState()
    .addItem({ ...item, product: { ...item.product, price: 30000 } });
  await h.mount();
  pointsSwitch(h.render()).props.onChange({ target: { checked: true } });
  assert.ok(pointsSummary(h.render()).includes("600"));
  assert.ok(pointsSummary(h.render()).includes("1.400"));
  await payButton(h.render()).props.onClick();
  const payment = calls.find((c) => c.path === "/payments");
  assert.equal(payment.body.method, "POINTS");
  assert.equal(payment.body.pointsUsed, 600);
  assert.equal(h.store.getState().items.length, 0);
});

test("new cart checkout does not pay the previously failed order", async () => {
  const calls = [];
  const freshOrder = { ...order, id: 8, total: 50000, discountAmount: 0 };
  const h = harness(async (path) => {
    calls.push(path);
    return path === "/payments"
      ? { ...success, order: { ...freshOrder, status: "PAID" } }
      : freshOrder;
  });
  const { CheckoutFlow } = h.load("src/lib/checkout-flow.ts");
  const flow = new CheckoutFlow(h.storage);
  flow.save(1, {
    cartKey: "old-basket",
    phase: "failed",
    order: { ...order, status: "PAYMENT_FAILED" },
  });
  h.store.getState().addItem(item);
  await h.mount();
  await payButton(h.render()).props.onClick();
  assert.deepEqual(calls, ["/orders", "/orders/8", "/payments"]);
  assert.equal(flow.read(1, 7).order.status, "PAYMENT_FAILED");
});

test("resuming held points does not subtract them twice from the displayed total", async () => {
  const heldOrder = {
    ...order,
    discountAmount: 10000,
    total: 40000,
    payments: [
      {
        status: "PROCESSING",
        method: "VNPAY",
        pointsUsed: 100,
        pointsAmount: 5000,
        paymentUrl: "https://vnpay.test/held",
      },
    ],
  };
  const h = harness(async () => heldOrder, memoryStorage(), {
    balance: 400,
    search: "?orderId=7",
  });
  await h.mount();
  assert.equal(pointsSwitch(h.render()).props.checked, true);
  assert.equal(pointsSwitch(h.render()).props.disabled, true);
  assert.ok(pointsSummary(h.render()).includes("100"));
  assert.ok(
    JSON.stringify(payButton(h.render()).props.children).includes("40.000"),
  );
});

test("the cart checkout button starts a fresh checkout even for identical items", async () => {
  const h = harness(async () => order);
  h.store.getState().addItem(item);
  const { CheckoutFlow } = h.load("src/lib/checkout-flow.ts");
  const { cartKey } = h.load("src/lib/order-payload.ts");
  const flow = new CheckoutFlow(h.storage);
  flow.save(1, {
    cartKey: cartKey(h.store.getState().items, null),
    phase: "redirecting",
    order,
  });
  const cartPage = h.load("src/app/cart/page.tsx").default();
  const button = walk(
    cartPage,
    (node) => node.props?.onClick?.name === "handleProceedToCheckout",
  )[0];
  button.props.onClick();
  assert.equal(flow.read(1), null);
  assert.equal(flow.read(1, 7).order.id, 7);
  assert.equal(h.store.getState().items.length, 1);
});

test("a delayed payment success does not empty a newer identical basket", async () => {
  const pending = deferred();
  const fullOrder = { ...order, total: 50000, discountAmount: 0 };
  const h = harness(async (path) =>
    path === "/payments" ? pending.promise : fullOrder,
  );
  h.store.getState().addItem(item);
  await h.mount();
  const payment = payButton(h.render()).props.onClick();
  await new Promise(setImmediate);
  assert.equal(h.store.getState().items.length, 0);
  h.store.getState().addItem(item);
  pending.resolve({ ...success, order: { ...fullOrder, status: "PAID" } });
  await payment;
  assert.equal(h.store.getState().items.length, 1);
});


test("an unconfirmed VNPAY response without a URL does not render checkout success", async () => {
  const fullOrder = { ...order, total: 50000, discountAmount: 0 };
  const h = harness(async (path) => path === "/payments"
    ? { payment: { method: "VNPAY", status: "PROCESSING" }, order: fullOrder }
    : fullOrder);
  h.store.getState().addItem(item);
  await h.mount();
  await payButton(h.render()).props.onClick();
  const { CheckoutFlow } = h.load("src/lib/checkout-flow.ts");
  assert.equal(new CheckoutFlow(h.storage).read(1).phase, "paying");
  assert.ok(payButton(h.render()));
  assert.equal(h.authState.refreshed, undefined);
  assert.equal(h.redirects.length, 0);
});

test("checkout reload shows retry for a lost order response and sends the saved request before payment", async () => {
  const storage = memoryStorage();
  const calls = [];
  let orderCalls = 0;
  const api = async (path, options) => {
    calls.push({ path, options });
    if (path === "/orders" && ++orderCalls === 1) throw new Error("Response lost");
    return order;
  };
  const first = harness(api, storage);
  first.store.getState().addItem(item);
  await first.mount();
  await payButton(first.render()).props.onClick();
  const creation = JSON.parse(storage.getItem("brewlite_checkout_v1_1")).creation;
  assert.ok(creation.idempotencyKey);

  const reloaded = harness(api, storage);
  reloaded.store.getState().addItem(item);
  await reloaded.mount();
  assert.equal(orderCalls, 1);
  const retry = walk(reloaded.render(), node => node.type === "button" &&
    JSON.stringify(node.props.children).includes("Thử lại tạo đơn"))[0];
  assert.equal(retry.props.disabled, false);
  await retry.props.onClick();
  const submitted = calls.filter(call => call.path === "/orders");
  assert.equal(submitted.length, 2);
  assert.equal(submitted[1].options.headers["Idempotency-Key"], creation.idempotencyKey);
  assert.equal(submitted[1].options.body, creation.body);
  assert.equal(calls.some(call => call.path === "/payments"), false);
  assert.equal(JSON.parse(storage.getItem("brewlite_checkout_v1_1")).order.id, order.id);
});
