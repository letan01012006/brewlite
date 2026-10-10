import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { sourceLoader, memoryStorage, deferred, walk } from "./load-source.mjs";

// A handler-level render harness, not a browser/layout test. Real source,
// checkout persistence, cart store and API sequencing run together.
function harness(api, storage = memoryStorage()) {
  let index = 0;
  const slots = [];
  const effects = [];
  const user = { id: 1, fullName: "Test", loyaltyPoints: 0, role: "CUSTOMER" };
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
          ? Promise.resolve({ ...item.product, toppings: [] })
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
  const load = sourceLoader(mocks, { window: { sessionStorage: storage } });
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
    await Promise.resolve();
    return render();
  };
  return { store, load, render, mount, storage, authState };
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
