import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { sourceLoader, memoryStorage } from "./load-source.mjs";

for (const [paymentStatus, orderStatus, successful] of [
  ["SUCCESS", "PAID", true],
  ["SUCCESS", "PENDING", false],
  ["NEEDS_REFUND", "CANCELLED", false],
  ["PROCESSING", "PENDING", false],
]) {
  test(`VNPAY return ${paymentStatus}/${orderStatus} displays the backend-confirmed outcome`, async () => {
    const storage = memoryStorage();
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
    }, { window: { sessionStorage: storage } });
    const { CheckoutFlow } = load("src/lib/checkout-flow.ts");
    const flow = new CheckoutFlow(storage);
    flow.save(1, { cartKey: "cart", phase: "redirecting", order: { id: 7 } });
    const Content = load("src/app/payment/vnpay-return/page.tsx").default().props.children.type;
    Content();
    effects.splice(0).forEach(effect => effect());
    await new Promise(setImmediate);
    index = 0;
    const rendered = JSON.stringify(Content());
    assert.equal(rendered.includes("Giao dịch VNPAY hoàn tất!"), successful);
    assert.equal(flow.read(1) === null, successful);
    assert.equal(refreshed, successful);
  });
}
