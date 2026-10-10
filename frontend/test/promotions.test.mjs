import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceLoader, deferred } from "./load-source.mjs";

function fixture() {
  const requests = [];
  const load = sourceLoader({
    "@/lib/api/client": {
      ApiError: Error,
      apiFetch: async (_path, options) => {
        const pending = deferred();
        requests.push({ ...pending, body: JSON.parse(options.body) });
        return pending.promise;
      },
    },
  });
  const store = load("src/store/cart-store.ts").useCartStore;
  store.getState().hydrate(null);
  const item = {
    product: { id: 1, price: 50000, stock: 100 },
    size: "S",
    quantity: 2,
    selectedToppings: [],
  };
  store.getState().addItem(item);
  return { store, requests, item };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("quantity changes validate the NEW basket; older responses cannot overwrite it", async () => {
  const { store, requests } = fixture();
  const initial = store.getState().validatePromo("BREW10");
  const id = store.getState().items[0].id;
  store.getState().updateQuantity(id, 1);
  assert.equal(requests[1].body.items[0].quantity, 1);
  assert.equal(store.getState().discountAmount, 0);
  assert.equal(store.getState().isValidatingPromo, true);
  requests[1].resolve({ code: "BREW10", discountAmount: 5000 });
  await flush();
  requests[0].resolve({ code: "BREW10", discountAmount: 10000 });
  await initial;
  assert.equal(store.getState().discountAmount, 5000);
  assert.equal(store.getState().isValidatingPromo, false);
});

for (const action of ["remove", "clear", "remove-code"]) {
  test(`pending validation cannot resurrect a promotion after ${action}`, async () => {
    const { store, requests } = fixture();
    const pending = store.getState().validatePromo("BREW10");
    if (action === "remove")
      store.getState().removeItem(store.getState().items[0].id);
    else if (action === "clear") store.getState().clearCart();
    else store.getState().setPromo(null, 0);
    requests[0].resolve({ code: "BREW10", discountAmount: 10000 });
    await pending;
    assert.equal(store.getState().promoCode, null);
    assert.equal(store.getState().discountAmount, 0);
    assert.equal(store.getState().isValidatingPromo, false);
  });
}

test("adding from menu revalidates promotion even when cart page is unmounted", async () => {
  const { store, requests, item } = fixture();
  const pending = store.getState().validatePromo("BREW10");
  requests[0].resolve({ code: "BREW10", discountAmount: 10000 });
  await pending;
  store.getState().addItem({ ...item, quantity: 1 });
  assert.equal(requests[1].body.items[0].quantity, 3);
  assert.equal(store.getState().discountAmount, 0);
  requests[1].resolve({ code: "BREW10", discountAmount: 15000 });
  await flush();
  assert.equal(store.getState().discountAmount, 15000);
});

test("new code wins even if the old request fails last", async () => {
  const { store, requests } = fixture();
  const first = store.getState().validatePromo("OLD");
  const second = store.getState().validatePromo("NEW");
  requests[1].resolve({ code: "NEW", discountAmount: 3000 });
  await second;
  requests[0].reject(new Error("Expired"));
  await first;
  assert.equal(store.getState().promoCode, "NEW");
  assert.equal(store.getState().discountAmount, 3000);
  assert.equal(store.getState().promoError, null);
});

test("invalid promotion after a reduction clears discount and explains failure", async () => {
  const { store, requests } = fixture();
  const first = store.getState().validatePromo("BREW10");
  requests[0].resolve({ code: "BREW10", discountAmount: 10000 });
  await first;
  store.getState().updateQuantity(store.getState().items[0].id, 1);
  requests[1].reject(new Error("Minimum value not met"));
  await flush();
  assert.equal(store.getState().promoCode, null);
  assert.equal(store.getState().discountAmount, 0);
  assert.equal(store.getState().isValidatingPromo, false);
  assert.equal(store.getState().promoError, "Minimum value not met");
});
