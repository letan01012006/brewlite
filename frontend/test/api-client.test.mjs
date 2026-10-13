import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader } from './load-source.mjs';

function client(fetch) {
  return sourceLoader({ '@/lib/auth-session': { accessToken: () => null, unauthorized() {} } }, { fetch })('src/lib/api/client.ts');
}

test('API uses the frontend origin and preserves POST payload and authorization', async () => {
  const { apiFetch } = client(async (url, options) => {
    assert.equal(url, '/api/payments');
    assert.equal(options.method, 'POST');
    assert.equal(options.body, '{"idempotencyKey":"same-key"}');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return new Response('{"ok":true}', { status: 200 });
  });
  assert.equal((await apiFetch('/payments', { method: 'POST', token: 'test-token', body: '{"idempotencyKey":"same-key"}' })).ok, true);
});

test('timed out payment request has unknown outcome and is not retried', async () => {
  let calls = 0;
  const { apiFetch } = client((_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  });
  await assert.rejects(apiFetch('/payments', { method: 'POST', body: '{}', timeoutMs: 10 }), (error) => error.code === 'TIMEOUT' && error.statusCode === 0);
  assert.equal(calls, 1);
});

test('timeout also covers a stalled response body', async () => {
  const { apiFetch } = client(async (_url, { signal }) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
  }));
  await assert.rejects(apiFetch('/products', { timeoutMs: 10 }), (error) => error.code === 'TIMEOUT');
});

test('caller cancellation remains cancellation, not a timeout or sign-out', async () => {
  const controller = new AbortController();
  const { apiFetch } = client((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason));
  }));
  const promise = apiFetch('/products', { signal: controller.signal });
  const reason = new Error('leaving page');
  controller.abort(reason);
  await assert.rejects(promise, (error) => error === reason);
});
