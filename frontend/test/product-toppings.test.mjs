import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { sourceLoader, deferred, walk } from './load-source.mjs';

// Exercises actual page/modal handlers. This is not a browser or visual test.
function hooks() {
  let index = 0;
  let timerId = 0;
  const slots = [];
  const effects = [];
  const timers = new Map();
  const same = (a, b) => a && b && a.length === b.length && a.every((v, n) => v === b[n]);
  const react = {
    ...React,
    useState(initial) {
      const i = index++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useMemo(callback, deps) {
      const i = index++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: callback() };
      return slots[i].value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(callback, deps) {
      const i = index++;
      if (!same(slots[i]?.deps, deps)) effects.push(() => {
        slots[i]?.cleanup?.();
        slots[i] = { deps, cleanup: callback() };
      });
    },
  };
  return {
    react,
    globals: {
      URLSearchParams,
      setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); },
    },
    render(callback) { index = 0; return callback(); },
    async flush() {
      effects.splice(0).forEach((effect) => effect());
      const tasks = [...timers.values()];
      timers.clear();
      tasks.forEach((task) => task());
      await new Promise((resolve) => setImmediate(resolve));
    },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

const a = { id: 11, name: 'A', price: 35000, stock: 20, category: 'Coffee' };
const b = { ...a, id: 29, name: 'B' };
const x = { id: 71, name: 'X', price: 5000 };
const y = { id: 88, name: 'Y', price: 7000 };
const detail = (product, toppings = [x]) => ({
  ...product, description: 'Fresh detail', toppings,
  sizes: [{ size: 'S', surcharge: 123 }, { size: 'M', surcharge: 8765 }, { size: 'L', surcharge: 22222 }],
});
class ApiError extends Error {
  constructor(message, statusCode) { super(message); this.statusCode = statusCode; }
}

function menu(api, { guest = false, query = '' } = {}) {
  const h = hooks();
  const auth = { user: guest ? null : { id: 1 } };
  const routes = [];
  const router = { push(path) { routes.push(path); }, replace(path) { routes.push(path); } };
  let params = new URLSearchParams(query);
  const load = sourceLoader({
    react: h.react,
    'next/navigation': { useRouter: () => router, useSearchParams: () => params },
    '@/store/auth-store': { useAuthStore: (selector) => selector(auth) },
    '@/lib/api/client': { apiFetch: api, ApiError },
    '@/lib/api/pagination': { allProducts: async () => [a, b] },
    '@/components/products/product-card': { ProductCard: 'product-card' },
    '@/components/products/product-modal': { ProductModal: 'product-modal' },
    '@/components/ui/pagination': { Pagination: 'pagination' },
  }, h.globals);
  const Content = load('src/app/(shop)/menu/page.tsx').default().props.children.type;
  const render = () => h.render(() => Content());
  return { ...h, render, auth, routes, setQuery(value) { params = new URLSearchParams(value); } };
}
const modal = (tree) => walk(tree, (n) => n.type === 'product-modal')[0];
const card = (tree, id) => walk(tree, (n) => n.type === 'product-card' && n.props.product.id === id)[0];

test('A then B loads product-specific details; a late response A cannot replace modal B', async () => {
  const late = deferred();
  const calls = [];
  const h = menu((path, options) => {
    calls.push({ path, signal: options.signal });
    return path.endsWith('/11') ? late.promise : Promise.resolve(detail(b, [y]));
  });
  h.render(); await h.flush();
  card(h.render(), a.id).props.onSelect(a);
  assert.equal(modal(h.render()).props.isOpen, false);
  assert.equal(walk(h.render(), (n) => n.props?.role === 'status').length, 1);
  card(h.render(), b.id).props.onSelect(b);
  await h.flush();
  assert.equal(modal(h.render()).props.product.id, b.id);
  assert.equal(modal(h.render()).props.product.toppings[0].id, y.id);
  assert.equal(calls[0].signal.aborted, true);
  late.resolve(detail(a)); await h.flush();
  assert.equal(modal(h.render()).props.product.id, b.id);
  assert.deepEqual(calls.map((call) => call.path), ['/products/11', '/products/29']);
  h.unmount();
});

test('post-login openProduct uses the detail endpoint even for a product absent from the current catalog', async () => {
  const paths = [];
  const h = menu(async (path) => { paths.push(path); return detail({ ...a, id: 999 }, []); }, { guest: true });
  h.render(); await h.flush();
  card(h.render(), a.id).props.onSelect(a);
  assert.ok(h.routes[0].includes(encodeURIComponent('/menu?openProduct=11')));
  assert.deepEqual(paths, []);
  h.auth.user = { id: 2 };
  h.setQuery('openProduct=999'); h.render(); await h.flush();
  assert.deepEqual(paths, ['/products/999']);
  assert.equal(modal(h.render()).props.product.id, 999);
  assert.equal(modal(h.render()).props.product.description, 'Fresh detail');
  assert.equal(modal(h.render()).props.product.toppings.length, 0);
  assert.equal(h.routes.at(-1), '/menu');
  h.unmount();
});

test('deleted/inactive detail displays an error without opening stale data; retry fetches the same product', async () => {
  let fail = true;
  const h = menu(async () => { if (fail) throw new ApiError('Gone', 404); return detail(a); });
  h.render(); await h.flush();
  card(h.render(), a.id).props.onSelect(a); await h.flush();
  assert.equal(modal(h.render()).props.isOpen, false);
  assert.ok(JSON.stringify(walk(h.render(), (n) => n.props?.role === 'alert')[0]).includes('ngừng bán'));
  fail = false;
  walk(h.render(), (n) => n.type === 'button' && n.props.children === 'Thử tải lại')[0].props.onClick();
  await h.flush();
  assert.equal(modal(h.render()).props.product.id, a.id);
  h.unmount();
});

function selection(product) {
  const h = hooks();
  const added = [];
  const alerts = [];
  const load = sourceLoader({
    react: h.react,
    'next/navigation': { useRouter: () => ({ push() {} }) },
    '@/store/auth-store': { useAuthStore: (selector) => selector({ user: { id: 1 } }) },
    '@/store/cart-store': { useCartStore: () => ({
      items: [], isHydrated: true, cartError: null,
      async addItemChecked(input) { added.push(input); return true; },
    }) },
    '@/components/ui/modal': { Modal: 'dialog' },
  }, { ...h.globals, alert: (message) => alerts.push(message) });
  const outer = load('src/components/products/product-modal.tsx').ProductModal({ product, isOpen: true, onClose() {} });
  return { ...h, added, alerts, render: () => h.render(() => outer.type(outer.props)) };
}

test('modal reads custom API size surcharges and only product toppings; caps each selection at 3', () => {
  const h = selection(detail(a, [x, y, { id: 91, name: 'Z', price: 1 }, { id: 92, name: 'W', price: 2 }]));
  let tree = h.render();
  assert.ok(JSON.stringify(tree).includes('+8.765'));
  assert.ok(JSON.stringify(tree).includes('43.765'));
  for (let n = 0; n < 4; n++) {
    tree = h.render();
    walk(tree, (node) => node.type === 'input' && node.props.type === 'checkbox')[n].props.onChange();
  }
  assert.equal(h.alerts.length, 1);
  tree = h.render();
  walk(tree, (n) => n.type === 'button' && n.props.onClick?.name === 'handleAddToCart')[0].props.onClick();
  assert.equal(h.added[0].selectedToppings.length, 3);
  assert.equal(h.added[0].size, 'M');
});

test('modal with no allowed toppings still supports API sizes, quantity and adding to cart', () => {
  const h = selection(detail(a, []));
  let tree = h.render();
  assert.equal(walk(tree, (n) => n.type === 'input' && n.props.type === 'checkbox').length, 0);
  walk(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Tăng số lượng')[0].props.onClick();
  tree = h.render();
  walk(tree, (n) => n.type === 'button' && n.props.onClick?.name === 'handleAddToCart')[0].props.onClick();
  assert.equal(h.added[0].quantity, 2);
  assert.equal(h.added[0].selectedToppings.length, 0);
});
