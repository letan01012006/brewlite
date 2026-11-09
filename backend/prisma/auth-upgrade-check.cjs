// Restores a fresh database copy; never resets/drops databases or volumes.
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { writeFileSync } = require('node:fs');
const { Client } = require('pg');
const sourceUrl = process.env.DATABASE_URL;
const name = process.env.AUTH_UPGRADE_DATABASE_NAME || 'brewlite_auth_upgrade_' + Date.now();
assert.match(name, /^brewlite_auth_upgrade_[a-z0-9_]+$/);
const target = new URL(sourceUrl); const sourceName = decodeURIComponent(target.pathname.slice(1));
assert.notEqual(sourceName, name); target.pathname = '/' + name;
const adminUrl = new URL(sourceUrl); adminUrl.pathname = '/postgres';
const source = new Client({ connectionString: sourceUrl, options: '-c default_transaction_read_only=on' });
const admin = new Client({ connectionString: adminUrl.toString() });
const copy = new Client({ connectionString: target.toString() });
const container = process.env.AUTH_TEST_DB_CONTAINER || 'brewlite-db-1';
const user = decodeURIComponent(new URL(sourceUrl).username);
const quote = s => '"' + s.replaceAll('"', '""') + '"';
async function snapshot(client, projection) {
  if (!projection) {
    projection = {};
    for (const row of (await client.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name <> '_prisma_migrations' ORDER BY table_name,ordinal_position`)).rows)
      (projection[row.table_name] ??= []).push(row.column_name);
  }
  const tables = {};
  for (const [table, columns] of Object.entries(projection)) {
    const rows = (await client.query(`SELECT to_jsonb(t) AS row FROM (SELECT ${columns.map(quote).join(',')} FROM public.${quote(table)}) t ORDER BY to_jsonb(t)::text`)).rows;
    tables[table] = { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
  }
  return { projection, tables };
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { maxBuffer: 128 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${command}: ${result.error ?? ''} ${result.stderr?.toString()}`);
  return result.stdout;
}
(async () => {
  try {
    await source.connect(); await admin.connect();
    const before = await snapshot(source);
    const dump = run('docker', ['exec', container, 'pg_dump', '-U', user, '-Fc', '--no-owner', sourceName]);
    await admin.query('CREATE DATABASE ' + quote(name));
    run('docker', ['exec', '-i', container, 'pg_restore', '-U', user, '-d', name, '--no-owner', '--exit-on-error'], { input: dump });
    await copy.connect();
    assert.deepEqual((await snapshot(copy, before.projection)).tables, before.tables, 'Restored copy differs');
    const output = run(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: target.toString() }, encoding: 'utf8',
    });
    assert.deepEqual((await snapshot(copy, before.projection)).tables, before.tables, 'Migration changed old data');
    assert.deepEqual((await snapshot(source, before.projection)).tables, before.tables, 'Source changed during verification');
    const result = { status: 'PASS', copyDatabase: name, migration: '20261109090000_phone_auth_manager', sourceUnchanged: true, tables: before.tables, prismaOutput: output };
    if (process.env.AUTH_UPGRADE_REPORT) writeFileSync(process.env.AUTH_UPGRADE_REPORT, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await Promise.allSettled([copy.end(), source.end(), admin.end()]); }
})().catch(error => { console.error(error); process.exitCode = 1; });
