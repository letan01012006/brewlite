import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader, memoryStorage, deferred } from './load-source.mjs';

const product = { id: 1, name: 'Coffee', price: 10000, stock: 0, inventoryMode: 'INGREDIENT', toppings: [], sizes: [{ size: 'S', surcharge: 0 }] };
const input = { product, size: 'S', quantity: 1, selectedToppings: [] };
function fixture(apiFetch) {
  const load = sourceLoader({ '@/lib/api/client': { apiFetch, ApiError: class extends Error {} } }, { window: {}, localStorage: memoryStorage() });
  const store = load('src/store/cart-store.ts').useCartStore;
  store.getState().hydrate(1);
  return store;
}
test('27 ingredient availability replaces legacy product.stock and rejects excess without changing cart', async () => {
  const requests = [];
  const store = fixture(async (path, options) => {
    assert.equal(path, '/inventory/availability');
    const items = JSON.parse(options.body).items; requests.push(items);
    return { available: items.reduce((n,i) => n+i.quantity,0) <= 2, shortages: [], lines: [] };
  });
  assert.equal(await store.getState().addItemChecked(input), true);
  assert.equal(await store.getState().updateQuantityChecked(store.getState().items[0].id, 3), false);
  assert.equal(store.getState().items[0].quantity, 1);
  assert.match(store.getState().cartError, /nguyên liệu/);
  assert.equal(requests[1][0].quantity, 3);
});
test('28 shared ingredients validate the entire basket including size and toppings', async () => {
  const store = fixture(async (_, options) => {
    const items = JSON.parse(options.body).items;
    return { available: items.length < 2, shortages: [], lines: [] };
  });
  assert.equal(await store.getState().addItemChecked(input), true);
  assert.equal(await store.getState().addItemChecked({ ...input, product: { ...product, id: 2 } }), false);
  assert.equal(store.getState().items.length, 1);
  assert.match(store.getState().cartError, /toàn bộ giỏ hàng/);
});
test('late inventory success cannot restore items after account switch or cart edits', async () => {
  const pending = deferred(); const store = fixture(() => pending.promise);
  const adding = store.getState().addItemChecked(input);
  store.getState().hydrate(2);
  pending.resolve({ available: true, shortages: [], lines: [] });
  assert.equal(await adding, false);
  assert.equal(store.getState().ownerId, 2);
  assert.equal(store.getState().items.length, 0);
});
test('29 refresh preserves ingredient selections on shortage or network failure and blocks checkout', async () => {
  let fail = false;
  const store = fixture(async path => {
    if (path.startsWith('/products')) return product;
    if (fail) throw new Error('Offline');
    return { available: false, shortages: [], lines: [] };
  });
  store.getState().addItem(input);
  assert.equal(await store.getState().refreshCart(), false);
  assert.equal(store.getState().items[0].quantity, 1);
  assert.match(store.getState().cartError, /nguyên liệu/);
  fail = true;
  assert.equal(await store.getState().refreshCart(), false);
  assert.equal(store.getState().items[0].quantity, 1);
});

test('barista stock form validates quantities per unit and sends idempotency key', async () => {
  const calls = [];
  const load = sourceLoader({ '@/lib/api/client': { apiFetch: async (path, options) => { calls.push([path, options]); return {}; }, ApiError: class extends Error {} } }, { window: {}, localStorage: memoryStorage() });
  const api = load('src/lib/api/inventory.ts');
  assert.equal(api.validQuantity('10.5', 'GRAM'), true);
  assert.equal(api.validQuantity('10.1234', 'GRAM'), false);
  assert.equal(api.validQuantity('1.5', 'PIECE'), false);
  assert.equal(api.validQuantity('-3', 'PIECE'), false);
  assert.equal(api.validQuantity('-3', 'PIECE', true), true);
  assert.equal(api.validQuantity('0', 'GRAM', true), false);
  await api.postStock('receipts', { ingredientId: 1, quantity: '5', reason: 'r' }, 'k-1');
  assert.equal(calls[0][0], '/inventory/receipts');
  assert.equal(calls[0][1].headers['Idempotency-Key'], 'k-1');
  await api.getMovements({ ingredientId: 7, page: 2 });
  assert.equal(calls[1][0], '/inventory/movements?ingredientId=7&page=2&limit=20');
});
