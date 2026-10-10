import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceLoader, memoryStorage, deferred } from "./load-source.mjs";

const product = {
  id: 1,
  name: "Coffee",
  price: 50000,
  stock: 100,
  toppings: [],
};
const input = { product, size: "S", quantity: 1, selectedToppings: [] };
function fixture(storage = memoryStorage(), apiFetch = async () => product) {
  const load = sourceLoader(
    { "@/lib/api/client": { apiFetch, ApiError: class extends Error {} } },
    { window: {}, localStorage: storage },
  );
  const store = load("src/store/cart-store.ts").useCartStore;
  store.getState().hydrate(null);
  return { store, storage, load };
}

test("guest selections merge into a returning account without exceeding its limits", () => {
  const { store } = fixture();
  store.getState().hydrate(1);
  store.getState().addItem({ ...input, quantity: 15 });
  store.getState().deactivate();
  store.getState().hydrate(null);
  store.getState().addItem({ ...input, quantity: 10 });
  store.getState().hydrate(1);
  assert.equal(store.getState().items[0].quantity, 15);
  assert.ok(store.getState().notice);
  store.getState().deactivate();
  store.getState().hydrate(null);
  assert.equal(store.getState().items[0].quantity, 10);
  store.getState().updateQuantity(store.getState().items[0].id, 5);
  store.getState().hydrate(1);
  assert.equal(store.getState().items[0].quantity, 20);
});

test("blocked cart persistence keeps the current selections and shows a notice", () => {
  const storage = {
    ...memoryStorage(),
    setItem() {
      throw new Error("Full");
    },
  };
  const { store } = fixture(storage);
  assert.equal(store.getState().addItem(input), true);
  assert.equal(store.getState().items.length, 1);
  assert.ok(store.getState().notice);
  store.getState().hydrate(1);
  assert.equal(store.getState().items.length, 1);
});

test("merge never exceeds 20 per line, and rejected adds do not mutate the cart", () => {
  const { store } = fixture();
  assert.equal(store.getState().addItem({ ...input, quantity: 15 }), true);
  assert.equal(store.getState().addItem({ ...input, quantity: 10 }), false);
  assert.equal(store.getState().items[0].quantity, 15);
  assert.equal(store.getState().addItem({ ...input, quantity: 5 }), true);
  assert.equal(store.getState().items[0].quantity, 20);
});

test("stock counts all sizes, toppings and notes; quantity updates enforce bounds", () => {
  const { store } = fixture();
  const scarce = { ...product, stock: 5 };
  store.getState().addItem({ ...input, product: scarce, quantity: 3 });
  assert.equal(
    store
      .getState()
      .addItem({ ...input, product: scarce, size: "M", quantity: 3 }),
    false,
  );
  assert.equal(
    store
      .getState()
      .addItem({ ...input, product: scarce, size: "M", quantity: 2 }),
    true,
  );
  const id = store.getState().items[0].id;
  assert.equal(store.getState().updateQuantity(id, 4), false);
  for (const quantity of [21, -1, 1.5, NaN])
    assert.equal(store.getState().updateQuantity(id, quantity), false);
  assert.equal(store.getState().updateQuantity(id, 0), true);
});

test("30-line limit allows merges but rejects line 31", () => {
  const { store } = fixture();
  for (let index = 0; index < 30; index++)
    assert.equal(
      store.getState().addItem({ ...input, note: `note ${index}` }),
      true,
    );
  assert.equal(store.getState().addItem({ ...input, note: "note 31" }), false);
  assert.equal(store.getState().addItem({ ...input, note: "note 0" }), true);
  assert.equal(store.getState().items.length, 30);
});

test("reload retains selections and notes but never trusts persisted discount or line totals", () => {
  const { store, storage } = fixture();
  store.getState().addItem({
    ...input,
    size: "L",
    quantity: 2,
    note: "Less ice",
    selectedToppings: [{ id: 1, name: "Pearl", price: 3000 }],
  });
  store.getState().setPromo("BREW10", 12600);
  const snapshot = JSON.parse(storage.getItem("brewlite_cart_v1_guest"));
  snapshot.items[0].lineTotal = 1;
  snapshot.discountAmount = 999999;
  storage.setItem("brewlite_cart_v1_guest", JSON.stringify(snapshot));
  const restored = fixture(storage).store.getState();
  assert.equal(restored.items[0].quantity, 2);
  assert.equal(restored.items[0].note, "Less ice");
  assert.equal(restored.getSubtotal(), 126000);
  assert.equal(restored.discountAmount, 0);
  assert.equal(restored.promoCode, "BREW10");
});

test("carts stay separate between accounts and guest cart transfers to a new account", () => {
  const { store } = fixture();
  store.getState().addItem(input);
  store.getState().hydrate(1);
  assert.equal(store.getState().items.length, 1);
  store.getState().deactivate();
  store.getState().hydrate(2);
  assert.equal(store.getState().items.length, 0);
  store.getState().addItem({ ...input, quantity: 2 });
  store.getState().deactivate();
  store.getState().hydrate(1);
  assert.equal(store.getState().items[0].quantity, 1);
  store.getState().deactivate();
  store.getState().hydrate(null);
  assert.equal(store.getState().items.length, 0);
});

test("corrupt storage and invalid saved quantities cannot break hydration", () => {
  const storage = memoryStorage();
  storage.setItem("brewlite_cart_v1_guest", "{broken");
  assert.equal(fixture(storage).store.getState().isHydrated, true);
  storage.setItem(
    "brewlite_cart_v1_guest",
    JSON.stringify({ items: [null, { ...input, quantity: 200 }] }),
  );
  assert.equal(fixture(storage).store.getState().items.length, 0);
});

test("refresh updates price, removes unavailable toppings and clamps total stock across variants", async () => {
  const { store } = fixture(memoryStorage(), async () => ({
    ...product,
    price: 60000,
    stock: 3,
    toppings: [],
  }));
  store.getState().addItem({
    ...input,
    quantity: 2,
    selectedToppings: [{ id: 1, price: 3000 }],
  });
  store.getState().addItem({ ...input, size: "M", quantity: 2 });
  assert.equal(await store.getState().refreshCart(), true);
  const state = store.getState();
  assert.equal(state.getTotalItemCount(), 3);
  assert.equal(state.items[0].selectedToppings.length, 0);
  assert.equal(state.getSubtotal(), 185000);
  assert.ok(state.notice);
});

test("failed refresh preserves selections; late refresh cannot overwrite an edited cart", async () => {
  const pending = deferred();
  const { store } = fixture(memoryStorage(), () => pending.promise);
  store.getState().addItem(input);
  const refresh = store.getState().refreshCart();
  store.getState().updateQuantity(store.getState().items[0].id, 2);
  pending.resolve(product);
  assert.equal(await refresh, false);
  assert.equal(store.getState().items[0].quantity, 2);
  const offline = fixture(memoryStorage(), async () => {
    throw new Error("Offline");
  }).store;
  offline.getState().addItem(input);
  assert.equal(await offline.getState().refreshCart(), false);
  assert.equal(offline.getState().items.length, 1);
  assert.ok(offline.getState().cartError);
});
