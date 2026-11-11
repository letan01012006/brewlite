// Read-only checks against the existing Compose database; never seeds or resets.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';

const [mode, file = '.local-backups/docker-compose-20261111/baseline.json'] = process.argv.slice(2);
assert.ok(['baseline', 'verify'].includes(mode), 'Usage: node scripts/compose-smoke.mjs baseline|verify [snapshot.json]');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const settings = parseEnv(readFileSync('backend/.env', 'utf8'));
const database = new URL(settings.DATABASE_URL);
const configuredExpiry = Number(settings.ORDER_PENDING_EXPIRE_MINUTES || 15);
const expiryMinutes = Number.isFinite(configuredExpiry) && configuredExpiry > 0 ? configuredExpiry : 15;
const sql = `SELECT json_build_object(
  'products', (SELECT json_build_object('count', count(*), 'digest', md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY id), ''))) FROM "Product" t),
  'ingredients', (SELECT json_build_object('count', count(*), 'digest', md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY id), ''))) FROM "Ingredient" t),
  'orders', (SELECT json_build_object('count', count(*), 'digest', md5(coalesce(string_agg((to_jsonb(t) - 'promoReleasedAt' - 'creationKey' - 'creationRequestHash')::text, E'\\n' ORDER BY id), ''))) FROM "Order" t),
  'orderRows', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'promoReleasedAt' - 'creationKey' - 'creationRequestHash' ORDER BY id), '[]') FROM "Order" t),
  'productId', (SELECT id FROM "Product" WHERE "isActive" ORDER BY id LIMIT 1),
  'ingredientId', (SELECT id FROM "Ingredient" ORDER BY id LIMIT 1),
  'orderId', (SELECT id FROM "Order" ORDER BY id LIMIT 1),
  'baristaId', (SELECT id FROM "User" WHERE role='BARISTA' AND (phone IS NULL OR "isPhoneVerified") ORDER BY id LIMIT 1)
);`;
const snapshot = JSON.parse(execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', decodeURIComponent(database.username), '-d', decodeURIComponent(database.pathname.slice(1)), '-XAt', '-v', 'ON_ERROR_STOP=1'], {
  input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
}));
const dbId = docker('compose', 'ps', '-q', 'db');
const mounts = JSON.parse(docker('inspect', dbId, '--format', '{{json .Mounts}}'));
const volume = mounts.find(mount => mount.Destination === '/var/lib/postgresql/data')?.Name;
assert.equal(volume, 'brewlite_pgdata', 'Must reuse the existing PostgreSQL volume');
if (mode === 'baseline') {
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n');
} else {
  const before = JSON.parse(readFileSync(file, 'utf8'));
  for (const table of ['products', 'ingredients']) {
    assert.ok(before[table].count > 0, `Existing ${table} must be present`);
    assert.deepEqual(snapshot[table], before[table], `${table} changed since baseline`);
  }
  assert.ok(before.orders.count > 0, 'Existing orders must be present');
  assert.equal(snapshot.orders.count, before.orders.count, 'Order count changed');
  const normalize = row => ({ ...row,
    createdAt: new Date(row.createdAt.replace(' ', 'T').replace(/Z?$/, 'Z')).toISOString(),
    updatedAt: new Date(row.updatedAt.replace(' ', 'T').replace(/Z?$/, 'Z')).toISOString(),
  });
  const current = new Map(snapshot.orderRows.map(row => [row.id, normalize(row)]));
  let expiredOrders = 0;
  for (const original of before.orderRows) {
    const old = normalize(original), row = current.get(old.id);
    assert.ok(row, `Existing order ${old.id} is missing`);
    if (row.status !== old.status) {
      assert.ok(['PENDING', 'PAYMENT_FAILED'].includes(old.status) && row.status === 'CANCELLED', `Unexpected status change for order ${old.id}`);
      assert.ok(Date.now() - Date.parse(old.createdAt) >= expiryMinutes * 60000, 'Only expired orders may close automatically');
      expiredOrders++;
    } else assert.equal(row.updatedAt, old.updatedAt, `Unexpected update to order ${old.id}`);
    const { status: oldStatus, updatedAt: oldUpdated, ...oldHistory } = old;
    const { status: newStatus, updatedAt: newUpdated, ...newHistory } = row;
    assert.deepEqual(newHistory, oldHistory, `Historical order fields changed for ${old.id}`);
  }
  const raw = docker('compose', 'ps', '--format', 'json');
  const services = raw.startsWith('[') ? JSON.parse(raw) : raw.split('\n').map(line => JSON.parse(line));
  for (const name of ['db', 'backend', 'frontend']) {
    const service = services.find(row => row.Service === name);
    assert.equal(service?.State, 'running', `${name} is not running`);
    assert.equal(service?.Health, 'healthy', `${name} is not healthy`);
  }
  const get = async (url, token, json = true) => {
    const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, url);
    return json ? response.json() : response.text();
  };
  assert.equal((await get('http://localhost:3000/api/health')).db, 'up');
  const swagger = await get('http://localhost:4000/api/docs', null, false);
  assert.match(swagger, /swagger-ui/i);
  await get('http://localhost:3000/menu', null, false);
  const product = await get(`http://localhost:3000/api/products/${snapshot.productId}`);
  assert.equal(product.id, snapshot.productId);
  // Use a short-lived token for an existing staff member, without changing users
  // or exposing the application's signing secret in command arguments/output.
  assert.ok(snapshot.baristaId, 'An existing verified BARISTA is required for private API checks');
  const token = docker('compose', 'exec', '-T', 'backend', 'node', '-e',
    "process.stdout.write(require('jsonwebtoken').sign({sub:Number(process.argv[1]),role:'BARISTA'},process.env.JWT_SECRET,{expiresIn:'5m'}))", String(snapshot.baristaId));
  const ingredient = await get(`http://localhost:3000/api/inventory/ingredients/${snapshot.ingredientId}`, token);
  assert.equal(ingredient.id, snapshot.ingredientId);
  const order = await get(`http://localhost:3000/api/orders/${snapshot.orderId}`, token);
  assert.equal(order.id, snapshot.orderId);
  console.log('PASS: all services healthy; frontend API proxy, Swagger and existing product/ingredient/order are readable; products/ingredients and historical order fields preserved.');
  if (expiredOrders) console.log(`${expiredOrders} pre-existing overdue orders were closed by the normal expiry job; no order was deleted.`);
}
console.log(JSON.stringify({ volume, products: snapshot.products.count, ingredients: snapshot.ingredients.count, orders: snapshot.orders.count }));
