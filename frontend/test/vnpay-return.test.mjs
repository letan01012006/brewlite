import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { sourceLoader, memoryStorage } from "./load-source.mjs";

for (const [paymentStatus, orderStatus, successful] of [
  ["SUCCESS", "PAID", true],
  ["SUCCESS", "PENDING", false],
  ["NEEDS_REFUND", "CANCELLED", false],
  ["PROCESSING", "PENDING", false],
  ["FAILED", "PAYMENT_FAILED", false],
  ["EXPIRED", "PENDING", false],
  ["CANCELLED", "PENDING", false],
]) {
  test(`VNPAY return ${paymentStatus}/${orderStatus} displays the backend-confirmed outcome`, async () => {
    const storage = memoryStorage();
    const cartStorage = memoryStorage();
    const slots = [];
    const effects = [];
    let index = 0;
    let refreshed = false;
    const load = sourceLoader({
      react: {
        ...React,
        useState(initial) {
          const slot = index++;
          if (!(slot in slots)) slots[slot] = initial;
          return [slots[slot], value => { slots[slot] = value; }];
        },
        useEffect(effect) { effects.push(effect); },
      },
      "next/link": "a",
      "next/navigation": { useSearchParams: () => new URLSearchParams("vnp_TxnRef=ref") },
      "@/store/auth-store": { useAuthStore: () => ({
        user: { id: 1 }, token: "token", isLoading: false,
        initAuth() {}, refreshUser: async () => { refreshed = true; },
      }) },
      "@/lib/api/client": {
        ApiError: class extends Error {},
        apiFetch: async () => ({
          payment: { status: paymentStatus, amount: 50000, method: "VNPAY" },
          order: { id: 7, status: orderStatus, total: 50000 },
        }),
      },
    }, { window: { sessionStorage: storage }, localStorage: cartStorage });
    const cart = load('src/store/cart-store.ts').useCartStore;
    cart.getState().hydrate(1);
    const coffee = { product: { id: 1, name: 'Coffee', price: 50000, stock: 100 }, size: 'S', selectedToppings: [], quantity: 2 };
    cart.getState().addItem(coffee);
    const { CheckoutFlow } = load("src/lib/checkout-flow.ts");
    const flow = new CheckoutFlow(storage);
    const original = { cartKey: 'cart', phase: 'redirecting', order: { id: 7 }, purchase: cart.getState().capturePurchase() };
    flow.save(1, original);
    cart.getState().addItem({ ...coffee, quantity: 1 });
    cart.getState().addItem({ ...coffee, product: { ...coffee.product, id: 2, name: 'Tea' }, quantity: 1 });
    const Content = load("src/app/payment/vnpay-return/page.tsx").default().props.children.type;
    Content();
    effects.splice(0).forEach(effect => effect());
    await new Promise(setImmediate);
    index = 0;
    const rendered = JSON.stringify(Content());
    assert.equal(rendered.includes("Giao dịch VNPAY hoàn tất!"), successful);
    assert.equal(flow.read(1) === null, successful);
    assert.equal(refreshed, successful || ['FAILED', 'EXPIRED', 'CANCELLED'].includes(paymentStatus));
    assert.equal(cart.getState().getTotalItemCount(), successful ? 2 : 4);
    assert.equal(cart.getState().items.find(item => item.product.id === 1).quantity, successful ? 1 : 3);
    assert.equal(cart.getState().items.find(item => item.product.id === 2).quantity, 1);
    if (successful) {
      // Even a stale checkout snapshot after reload cannot consume newer items.
      cart.getState().deactivate();
      cart.getState().hydrate(1);
      flow.save(1, original);
      effects.splice(0).forEach(effect => effect());
      await new Promise(setImmediate);
      assert.equal(cart.getState().getTotalItemCount(), 2);
      assert.equal(cart.getState().completedOrderIds.filter(id => id === 7).length, 1);
      assert.equal(flow.read(1), null);
    }
  });
}
