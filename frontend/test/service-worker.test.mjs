import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { sourceLoader, memoryStorage } from './load-source.mjs';

const origin = 'https://brew.test';
const scriptURL = origin + '/sw.js';

function registration({ scope = origin + '/', active = scriptURL, waiting = null, installing = null, fail = false } = {}) {
  return {
    scope,
    active: active && { scriptURL: active },
    waiting: waiting && { scriptURL: waiting },
    installing: installing && { scriptURL: installing },
    calls: 0,
    async unregister() { this.calls++; if (fail) throw new Error('denied'); return true; },
  };
}

function cleanup({ registrations = [], keys = [], deniedRegistrations = false, deniedCaches = false, failDelete = false, supported = true } = {}) {
  const deleted = [];
  const localStorage = memoryStorage();
  const sessionStorage = memoryStorage();
  for (const [key, value] of [['brewlite_token', 'token'], ['brewlite_cart_user-1', 'basket'], ['brewlite_theme', 'dark']]) localStorage.setItem(key, value);
  sessionStorage.setItem('checkout-user-1', 'pending-payment-key');
  const document = { cookie: 'session=keep-me' };
  let reloads = 0;
  const navigator = supported ? {
    serviceWorker: {
      async getRegistrations() { if (deniedRegistrations) throw new Error('denied'); return registrations; },
      register() { assert.fail('must never register a worker'); },
    },
  } : {};
  const window = {
    location: { origin, reload() { reloads++; } },
    ...(supported ? { caches: {
      async keys() { if (deniedCaches) throw new Error('denied'); return keys; },
      async delete(key) { deleted.push(key); if (failDelete) throw new Error('quota'); return true; },
    } } : {}),
  };
  const run = sourceLoader({}, { window, navigator, URL, localStorage, sessionStorage, document })('src/lib/legacy-pwa-cleanup.ts').cleanupLegacyPwa;
  return { run, deleted, localStorage, sessionStorage, document, reloads: () => reloads };
}

test('cleanup removes only the exact BrewLite script and root scope, including waiting/installing workers', async () => {
  const own = [
    registration(),
    registration({ active: null, waiting: scriptURL }),
    registration({ active: null, installing: scriptURL }),
  ];
  const others = [
    registration({ active: origin + '/other/sw.js' }),
    registration({ scope: origin + '/other/' }),
    registration({ active: origin + '/sw.js?owner=other' }),
    registration({ active: 'https://another.test/sw.js' }),
    registration({ waiting: origin + '/replacement.js' }),
    registration({ active: null }),
  ];
  const state = cleanup({ registrations: [...own, ...others], keys: ['another-app', 'brewlite-pwa-v1', 'brewlite-pwa-v1.0.2', 'brewlite-cart'] });
  await state.run();
  assert.deepEqual(own.map((item) => item.calls), [1, 1, 1]);
  assert.deepEqual(others.map((item) => item.calls), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(state.deleted, ['brewlite-pwa-v1', 'brewlite-pwa-v1.0.2']);
});

test('cleanup preserves account, cart, theme, cookies and pending checkout without a reload; repeated runs are safe', async () => {
  const state = cleanup({ registrations: [registration()], keys: ['brewlite-pwa-v1'] });
  await state.run();
  await state.run();
  assert.equal(state.localStorage.getItem('brewlite_token'), 'token');
  assert.equal(state.localStorage.getItem('brewlite_cart_user-1'), 'basket');
  assert.equal(state.localStorage.getItem('brewlite_theme'), 'dark');
  assert.equal(state.sessionStorage.getItem('checkout-user-1'), 'pending-payment-key');
  assert.equal(state.document.cookie, 'session=keep-me');
  assert.equal(state.reloads(), 0);
});

test('fresh profiles, unsupported APIs and denied storage do not break the website', async () => {
  await cleanup().run();
  await cleanup({ supported: false }).run();
  const cacheOnly = cleanup({ deniedRegistrations: true, keys: ['brewlite-pwa-v1'] });
  await cacheOnly.run();
  assert.deepEqual(cacheOnly.deleted, ['brewlite-pwa-v1']);
  const own = registration();
  await cleanup({ registrations: [own], deniedCaches: true }).run();
  assert.equal(own.calls, 1);
  const afterFailure = registration();
  await cleanup({ registrations: [registration({ fail: true }), afterFailure], keys: ['brewlite-pwa-v1'], failDelete: true }).run();
  assert.equal(afterFailure.calls, 1);
});

function worker({ deniedCaches = false, deniedClaim = false, scope = origin + '/' } = {}) {
  const handlers = {};
  const calls = [];
  vm.runInNewContext(fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    URL,
    self: {
      location: { origin },
      registration: { scope, async unregister() { calls.push('unregister'); } },
      addEventListener: (name, fn) => handlers[name] = fn,
      async skipWaiting() { calls.push('skipWaiting'); },
      clients: { async claim() { calls.push('claim'); if (deniedClaim) throw new Error('denied'); } },
    },
    caches: {
      async keys() { if (deniedCaches) throw new Error('denied'); return ['other-app', 'brewlite-pwa-v1', 'brewlite-pwa-v1.0.2']; },
      async delete(key) { calls.push(key); },
    },
  });
  async function dispatch(name) {
    let work;
    handlers[name]({ waitUntil: (value) => work = value });
    await work;
  }
  return { calls, handlers, dispatch };
}

test('retirement worker activates immediately, clears only BrewLite caches and unregisters without intercepting requests', async () => {
  const state = worker();
  await state.dispatch('install');
  await state.dispatch('activate');
  assert.deepEqual(state.calls, ['skipWaiting', 'brewlite-pwa-v1', 'brewlite-pwa-v1.0.2', 'claim', 'unregister']);
  assert.deepEqual(Object.keys(state.handlers).sort(), ['activate', 'install']);
});

test('retirement worker still unregisters if cache access or claiming fails; other scopes are untouched', async () => {
  const denied = worker({ deniedCaches: true });
  await denied.dispatch('activate');
  assert.deepEqual(denied.calls, ['claim', 'unregister']);
  const deniedClaim = worker({ deniedClaim: true });
  await assert.rejects(deniedClaim.dispatch('activate'), /denied/);
  assert.equal(deniedClaim.calls.at(-1), 'unregister');
  const otherScope = worker({ scope: origin + '/other/' });
  await otherScope.dispatch('activate');
  assert.deepEqual(otherScope.calls, []);
});
