import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader } from './load-source.mjs';

const { safeRedirect } = sourceLoader()('src/lib/safe-redirect.ts');

for (const path of ['/', '/menu', '/menu?openProduct=3']) {
  test(`safeRedirect preserves local path ${path}`, () => {
    assert.equal(safeRedirect(path), path);
  });
}

for (const raw of [
  '//evil.com', 'https://evil.com', '/\\evil.com', '', null,
  '/menu\t', '/menu\n', '/menu\u0000', '/menu\u007f', '/menu\u0085',
]) {
  test(`safeRedirect rejects ${JSON.stringify(raw)}`, () => {
    assert.equal(safeRedirect(raw), '/');
  });
}
