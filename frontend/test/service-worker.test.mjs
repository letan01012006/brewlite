import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function worker({ cached, fetch, put = async () => {}, keys = [] } = {}) {
  const handlers = {};
  const deleted = [];
  const cache = { match: async () => cached, put, addAll: async () => {} };
  vm.runInNewContext(fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self: { location: { origin: 'https://brew.test' }, addEventListener: (name, fn) => handlers[name] = fn, clients: { claim: async () => {} } },
    caches: { open: async () => cache, keys: async () => keys, delete: async (key) => deleted.push(key) },
    fetch, URL, Response,
  });
  function request(overrides = {}) {
    let response;
    const background = [];
    handlers.fetch({
      request: { url: 'https://brew.test/asset.js', method: 'GET', destination: 'script', mode: 'cors', ...overrides },
      respondWith: (value) => response = value,
      waitUntil: (value) => background.push(value),
    });
    return { response, background };
  }
  return { request, handlers, deleted };
}

test('uncached asset fetches once and returns original response even if cache writing fails', async () => {
  let calls = 0;
  const sw = worker({ fetch: async () => { calls++; return new Response('asset'); }, put: async () => { throw new Error('quota'); } });
  const { response, background } = sw.request();
  assert.equal(await (await response).text(), 'asset');
  await Promise.all(background);
  assert.equal(calls, 1);
});

test('cached assets stay available offline, navigation gets the standalone fallback', async () => {
  const sw = worker({ cached: new Response('offline-content'), fetch: async () => { throw new Error('offline'); } });
  const asset = sw.request();
  assert.equal(await (await asset.response).text(), 'offline-content');
  await Promise.all(asset.background);
  const navigation = worker({ cached: new Response('offline-page'), fetch: async () => { throw new Error('offline'); } }).request({ mode: 'navigate' });
  assert.equal(await (await navigation.response).text(), 'offline-page');
});

test('API, mutations, other origins and RSC are not cached or given offline HTML', () => {
  const sw = worker({ fetch: () => { throw new Error('must bypass'); } });
  for (const request of [
    { url: 'https://brew.test/api/products' },
    { method: 'POST' },
    { url: 'https://images.example/coffee.jpg' },
    { destination: '', url: 'https://brew.test/menu?_rsc=123' },
  ]) assert.equal(sw.request(request).response, undefined);
});

test('activation removes only obsolete BrewLite caches', async () => {
  const sw = worker({ keys: ['another-app', 'brewlite-pwa-v1', 'brewlite-pwa-v1.0.2'] });
  let work;
  sw.handlers.activate({ waitUntil: (promise) => work = promise });
  await work;
  assert.deepEqual(sw.deleted, ['brewlite-pwa-v1']);
});
