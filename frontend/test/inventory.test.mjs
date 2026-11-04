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

test('calculates real uncapped cup counts per recipe size and topping servings from available stock', async () => {
  const calls = [];
  const load = sourceLoader({ '@/lib/api/client': { apiFetch: async (path, options) => { calls.push([path, options]); return {}; }, ApiError: class extends Error {} } }, { window: {}, localStorage: memoryStorage() });
  const api = load('src/lib/api/inventory.ts');

  assert.equal(api.calculateToppingServings('2000.000', '50.000'), 40);
  assert.equal(api.calculateToppingServings('19.000', '50.000'), 0);
  assert.equal(api.calculateToppingServings('1000', null), null);

  const stockMap = new Map([
    [1, { id: 1, name: 'Cà phê hạt', unit: 'GRAM', stockQuantity: '2000', reservedQuantity: '0', availableQuantity: '2000', isActive: true }],
    [2, { id: 2, name: 'Sữa đặc', unit: 'MILLILITRE', stockQuantity: '6000', reservedQuantity: '0', availableQuantity: '6000', isActive: true }],
  ]);
  const res = api.calculateRecipeCups(
    [{ ingredientId: 1, quantity: '16' }, { ingredientId: 2, quantity: '20' }],
    stockMap,
    true,
  );
  assert.equal(res.configured, true);
  assert.equal(res.maxCups, 125); // 2000 / 16 = 125 (> 20, not capped at 20)
  assert.equal(res.missing.length, 0);

  await api.getMovements({ ingredientId: 3, kind: 'ADJUSTMENT', from: '2026-11-01', to: '2026-11-04', page: 1, limit: 12 });
  assert.equal(calls[0][0], '/inventory/movements?ingredientId=3&kind=ADJUSTMENT&from=2026-11-01&to=2026-11-04&page=1&limit=12');
});

test('getProductsCatalog paginates with limit=50&includeInactive=true, distinguishes ADJUSTMENT delta labels, and blocks paused products in cart', async () => {
  const calls = [];
  class MockApiError extends Error {
    constructor(message, statusCode) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  const load = sourceLoader(
    {
      '@/lib/api/client': {
        ApiError: MockApiError,
        apiFetch: async (path, options) => {
          calls.push([path, options]);
          if (path === '/products?limit=50&page=1&includeInactive=true') {
            return {
              data: [{ id: 1, name: 'Cà phê đen', isActive: true }],
              meta: { total: 2, page: 1, limit: 50, totalPages: 2 },
            };
          }
          if (path === '/products?limit=50&page=2&includeInactive=true') {
            return {
              data: [{ id: 2, name: 'Bạc xỉu', isActive: false }],
              meta: { total: 2, page: 2, limit: 50, totalPages: 2 },
            };
          }
          if (path === '/products/2/status') {
            return { id: 2, name: 'Bạc xỉu', isActive: JSON.parse(options.body).isActive };
          }
          if (path === '/products/toppings') {
            return [
              { id: 10, name: 'Trân châu đen', price: 10000 },
              { id: 11, name: 'Thạch dừa', price: 8000 },
            ];
          }
          if (path === '/products/toppings/10/recipe') {
            return { id: 10, ingredientId: 5, quantityPerServing: '50.000' };
          }
          if (path === '/products/toppings/11/recipe') {
            throw new MockApiError('Topping chưa có công thức định lượng', 404);
          }
          if (path.startsWith('/inventory/movements?')) {
            return { data: [], meta: { total: 0, page: 1, limit: 12, totalPages: 1 } };
          }
          throw new MockApiError('Unexpected path: ' + path, 400);
        },
      },
    },
    { window: {}, localStorage: memoryStorage() },
  );

  const api = load('src/lib/api/inventory.ts');
  const catalog = await api.getProductsCatalog();
  assert.deepEqual(
    Array.from(catalog, (p) => p.id),
    [1, 2],
  );
  assert.deepEqual(
    calls.slice(0, 2).map((c) => c[0]),
    [
      '/products?limit=50&page=1&includeInactive=true',
      '/products?limit=50&page=2&includeInactive=true',
    ],
  );

  // Movement label: positive ADJUSTMENT -> "Điều chỉnh tăng", negative ADJUSTMENT -> "Ghi nhận hao hụt"
  assert.equal(api.getMovementTypeLabel({ kind: 'ADJUSTMENT', stockDelta: '50.000' }), 'Điều chỉnh tăng');
  assert.equal(api.getMovementTypeLabel({ kind: 'ADJUSTMENT', stockDelta: '+50' }), 'Điều chỉnh tăng');
  assert.equal(api.getMovementTypeLabel({ kind: 'ADJUSTMENT', stockDelta: '-50.000' }), 'Ghi nhận hao hụt');
  assert.equal(api.getMovementTypeLabel({ kind: 'RECEIPT', stockDelta: '100.000' }), 'Nhập kho');
  assert.equal(api.getMovementTypeLabel({ kind: 'HOLD', stockDelta: '0' }), 'Giữ cho đơn');
  assert.equal(api.getMovementTypeLabel({ kind: 'CONSUME', stockDelta: '-16.000' }), 'Tiêu hao pha chế');
  assert.equal(api.getMovementTypeLabel({ kind: 'RELEASE', stockDelta: '0' }), 'Hoàn trả từ đơn');

  // Movement filter query params for ADJUSTMENT_POSITIVE and ADJUSTMENT_NEGATIVE
  await api.getMovements({ kind: 'ADJUSTMENT_POSITIVE', page: 1, limit: 12 });
  assert.equal(calls.at(-1)[0], '/inventory/movements?kind=ADJUSTMENT_POSITIVE&page=1&limit=12');
  await api.getMovements({ kind: 'ADJUSTMENT_NEGATIVE', page: 1, limit: 12 });
  assert.equal(calls.at(-1)[0], '/inventory/movements?kind=ADJUSTMENT_NEGATIVE&page=1&limit=12');

  // Toggle product selling status
  const updated = await api.updateProductStatus(2, true);
  assert.equal(updated.isActive, true);

  // Paused product (isActive: false) cannot be added to cart
  const rules = load('src/lib/cart-rules.ts');
  assert.throws(
    () => rules.makeItem({ ...product, isActive: false }, 'S', [], 1),
    /tạm dừng bán/,
  );

  const toppings = await api.getPreparedToppings();
  assert.equal(toppings.length, 2);
  assert.equal(toppings[0].ingredientId, 5);
  assert.equal(toppings[0].quantityPerServing, '50.000');
  assert.equal(toppings[1].ingredientId, null);
  assert.equal(toppings[1].quantityPerServing, null);
});

test('ingredient pause/reactivate: calculateRecipeCups marks paused, calculateToppingServings blocks paused topping, updateIngredient sends PATCH', async () => {
  const calls = [];
  const load = sourceLoader(
    {
      '@/lib/api/client': {
        ApiError: class extends Error {},
        apiFetch: async (path, options) => {
          calls.push([path, options]);
          if (path.startsWith('/inventory/ingredients/')) {
            const body = JSON.parse(options.body);
            return { id: 1, name: 'Sữa đặc', isActive: body.isActive };
          }
          return {};
        },
      },
    },
    { window: {}, localStorage: memoryStorage() },
  );
  const api = load('src/lib/api/inventory.ts');

  const stockMap = new Map([
    [1, { id: 1, name: 'Cà phê hạt', unit: 'GRAM', stockQuantity: '2000', reservedQuantity: '0', availableQuantity: '2000', isActive: true }],
    [2, { id: 2, name: 'Sữa tươi', unit: 'MILLILITRE', stockQuantity: '5000', reservedQuantity: '0', availableQuantity: '5000', isActive: false }],
  ]);

  // Recipe with active coffee and paused milk
  const res = api.calculateRecipeCups(
    [{ ingredientId: 1, quantity: '15' }, { ingredientId: 2, quantity: '30' }],
    stockMap,
    true,
  );
  assert.equal(res.configured, true);
  assert.equal(res.hasPausedIngredient, true);
  assert.equal(res.maxCups, 0);
  assert.equal(res.missing.length, 1);
  assert.equal(res.missing[0].isPaused, true);
  assert.equal(res.missing[0].name, 'Sữa tươi');

  // Topping servings with paused ingredient
  assert.equal(api.calculateToppingServings('1000.000', '20.000', false), 0);
  assert.equal(api.calculateToppingServings('1000.000', '20.000', true), 50);

  // updateIngredient calls PATCH
  const patched = await api.updateIngredient(2, { isActive: true });
  assert.equal(patched.isActive, true);
  assert.equal(calls[0][0], '/inventory/ingredients/2');
  assert.equal(calls[0][1].method, 'PATCH');
  assert.equal(calls[0][1].body, JSON.stringify({ isActive: true }));
});
