import 'dotenv/config';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const { Client } = createRequire(import.meta.url)('pg');

const sourceUrl = process.env.DATABASE_URL;
const testUrl = process.env.TEST_DATABASE_URL;
const upgradeUrl = process.env.PAYMENT_UPGRADE_DATABASE_URL;
if (!sourceUrl || !testUrl || !upgradeUrl)
  throw new Error(
    'Set DATABASE_URL (read-only source), TEST_DATABASE_URL (separate test DB), PAYMENT_UPGRADE_DATABASE_URL (restored copy). No tests are skipped.',
  );
const names = [sourceUrl, testUrl, upgradeUrl].map((value) =>
  decodeURIComponent(new URL(value).pathname),
);
assert.equal(
  new Set(names).size,
  3,
  'Source, test and upgrade copy must use three distinct database names, even across host aliases',
);
for (const value of [testUrl, upgradeUrl])
  assert.ok(
    !new URL(value).searchParams.has('schema'),
    'Use database URLs without a schema override',
  );

const runId = randomUUID().replaceAll('-', '');
const freshSchema = `payment_fresh_${runId}`;
const oldSchema = `payment_old_${runId}`;
const firstMigration = '20261105090000_payment_enums';
const source = new Client({
  connectionString: sourceUrl,
  options: '-c default_transaction_read_only=on',
});
const admin = new Client({ connectionString: testUrl });
const fresh = new Client({
  connectionString: testUrl,
  options: `-c search_path=${freshSchema}`,
});
const old = new Client({
  connectionString: testUrl,
  options: `-c search_path=${oldSchema}`,
});
const copy = new Client({ connectionString: upgradeUrl });
let sourceSnapshot: Awaited<ReturnType<typeof snapshot>>;
let copiedSnapshot: Awaited<ReturnType<typeof snapshot>>;
let oldSnapshot: Awaited<ReturnType<typeof snapshot>>;
let oldColumns: Record<string, string[]>;
let copiedColumns: Record<string, string[]>;
const created: string[] = [];
let userId: number;

const ident = (s: string) => '"' + s.replaceAll('"', '""') + '"';
function cli(url: string, schema: string, args: string[], config?: string) {
  const target = new URL(url);
  target.searchParams.set('schema', schema);
  const result = spawnSync(
    process.execPath,
    [
      resolve('node_modules/prisma/build/index.js'),
      ...args,
      ...(config ? ['--config', config] : []),
    ],
    {
      env: { ...process.env, DATABASE_URL: target.toString() },
      encoding: 'utf8',
      timeout: 120000,
    },
  );
  assert.equal(
    result.status,
    0,
    `${args.join(' ')}: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout + result.stderr;
}
async function columns(db: any) {
  const result: Record<string, string[]> = {};
  for (const row of (
    await db.query(
      `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name<>'_prisma_migrations' ORDER BY table_name,ordinal_position`,
    )
  ).rows)
    (result[row.table_name] ??= []).push(row.column_name);
  return result;
}
async function snapshot(db: any, projection?: Record<string, string[]>) {
  const data: Record<string, unknown> = {};
  for (const [table, fields] of Object.entries(
    projection ?? (await columns(db)),
  )) {
    const rows = (
      await db.query(
        `SELECT to_jsonb(t) AS row FROM (SELECT ${fields.map(ident).join(',')} FROM ${ident(table)}) t ORDER BY to_jsonb(t)::text`,
      )
    ).rows;
    data[table] = rows.map((r: any) => r.row);
  }
  return data;
}
async function tx(fn: () => Promise<void>) {
  await fresh.query('BEGIN');
  try {
    await fn();
  } finally {
    await fresh.query('ROLLBACK');
  }
}
async function reject(
  sql: string,
  values: unknown[],
  code: string,
  constraint?: string,
) {
  await fresh.query('SAVEPOINT rejected_write');
  try {
    await fresh.query(sql, values);
    assert.fail(`Expected ${constraint ?? code}`);
  } catch (error: any) {
    assert.equal(error.code, code, error.message);
    if (constraint) assert.equal(error.constraint, constraint, error.message);
  } finally {
    await fresh.query('ROLLBACK TO SAVEPOINT rejected_write');
    await fresh.query('RELEASE SAVEPOINT rejected_write');
  }
}
async function order(total = 1000, owner = userId) {
  return (
    await fresh.query(
      `INSERT INTO "Order" ("userId",subtotal,total,"updatedAt") VALUES ($1,$2,$2,now()) RETURNING id`,
      [owner, total],
    )
  ).rows[0].id as number;
}
async function payment(
  orderId: number,
  method = 'VNPAY',
  status = 'PROCESSING',
  points = 0,
  amount = 1000,
) {
  return (
    await fresh.query(
      `INSERT INTO "Payment" ("orderId","idempotencyKey","requestHash",amount,method,status,"pointsUsed","updatedAt") VALUES ($1,$2,'hash',$3,$4,$5,$6,now()) RETURNING id`,
      [orderId, randomUUID(), amount, method, status, points],
    )
  ).rows[0].id as number;
}
async function ledger(
  orderId: number,
  paymentId: number | null,
  type: string,
  points: number,
  related: number | null = null,
  eventKey = randomUUID(),
) {
  return (
    await fresh.query(
      `INSERT INTO "LoyaltyTransaction" ("userId","orderId","paymentId",type,points,"relatedTransactionId","eventKey") VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [userId, orderId, paymentId, type, points, related, eventKey],
    )
  ).rows[0].id as number;
}

before(
  async () => {
    for (const db of [source, admin, fresh, old, copy]) await db.connect();
    assert.equal(
      (await source.query('SHOW transaction_read_only')).rows[0]
        .transaction_read_only,
      'on',
    );
    sourceSnapshot = await snapshot(source);
    copiedColumns = await columns(copy);
    copiedSnapshot = await snapshot(copy);
    assert.deepEqual(
      copiedSnapshot,
      sourceSnapshot,
      'Restored copy must match every source row before migration',
    );
    // Preserve historical records verbatim, including the two missing local migrations.
    const history = (
      await copy.query('SELECT * FROM "_prisma_migrations" ORDER BY id')
    ).rows;
    for (const schema of [freshSchema, oldSchema]) {
      assert.match(schema, /^payment_(fresh|old)_[a-f0-9]+$/);
      await admin.query(`CREATE SCHEMA ${ident(schema)}`);
      created.push(schema);
    }
    cli(testUrl!, freshSchema, ['migrate', 'deploy']);
    assert.match(
      cli(testUrl!, freshSchema, ['migrate', 'status']),
      /up to date/,
    );

    const temp = mkdtempSync(join(tmpdir(), 'brewlite-payment-legacy-'));
    mkdirSync(join(temp, 'migrations'));
    copyFileSync(
      resolve('prisma/migrations/migration_lock.toml'),
      join(temp, 'migrations/migration_lock.toml'),
    );
    for (const name of readdirSync(resolve('prisma/migrations')).filter(
      (n) => /^\d/.test(n) && n < firstMigration,
    )) {
      if (
        !readdirSync(resolve('prisma/migrations', name)).includes(
          'migration.sql',
        )
      )
        continue;
      mkdirSync(join(temp, 'migrations', name));
      copyFileSync(
        resolve('prisma/migrations', name, 'migration.sql'),
        join(temp, 'migrations', name, 'migration.sql'),
      );
    }
    const config = join(temp, 'prisma.config.ts');
    writeFileSync(
      config,
      `export default { schema: ${JSON.stringify(resolve('prisma/schema.prisma'))}, engine: 'classic', migrations: { path: ${JSON.stringify(join(temp, 'migrations'))} }, datasource: { url: process.env.DATABASE_URL } };`,
    );
    cli(testUrl!, oldSchema, ['migrate', 'deploy'], config);
    await old.query(
      `INSERT INTO "User" (email,"passwordHash","fullName","loyaltyPoints") VALUES ('legacy@db.test','unchanged','Legacy',321)`,
    );
    for (const [i, status] of ['PROCESSING', 'SUCCESS', 'FAILED'].entries()) {
      const id = (
        await old.query(
          `INSERT INTO "Order" ("userId",subtotal,total,"updatedAt") VALUES (1,1000,1000,now()) RETURNING id`,
        )
      ).rows[0].id;
      await old.query(
        `INSERT INTO "Payment" ("orderId","idempotencyKey","requestHash",amount,method,status,"refundedAt","refundedAmount","refundRef","updatedAt") VALUES ($1,$2,'oldhash',1000,$3,$4,$5,$6,$7,now())`,
        [
          id,
          `legacy-${i}`,
          i === 2 ? 'CARD' : 'WALLET',
          status,
          i === 1 ? new Date('2025-01-01') : null,
          i === 1 ? 1000 : 0,
          i === 1 ? 'OLD-REFUND' : null,
        ],
      );
      await old.query(
        `INSERT INTO "LoyaltyTransaction" ("userId","orderId",points,"reversedAt") VALUES (1,$1,$2,$3)`,
        [id, i === 0 ? 0 : 10, i === 1 ? new Date('2025-01-02') : null],
      );
    }
    oldColumns = await columns(old);
    oldSnapshot = await snapshot(old);
    cli(testUrl!, oldSchema, ['migrate', 'deploy']);
    cli(upgradeUrl!, 'public', ['migrate', 'deploy']);
    assert.deepEqual(
      (
        await copy.query(
          'SELECT * FROM "_prisma_migrations" WHERE migration_name < $1 ORDER BY id',
          [firstMigration],
        )
      ).rows,
      history,
    );
    assert.deepEqual(
      await snapshot(copy, copiedColumns),
      copiedSnapshot,
      'Upgrade must preserve every existing source column and row',
    );
    userId = (
      await fresh.query(
        `INSERT INTO "User" (email,"passwordHash","fullName","loyaltyPoints") VALUES ('payment@db.test','test-only','DB Test',100) RETURNING id`,
      )
    ).rows[0].id;
  },
  { timeout: 240000 },
);

after(async () => {
  if (sourceSnapshot)
    assert.deepEqual(
      await snapshot(source),
      sourceSnapshot,
      'Source data changed during tests',
    );
  for (const db of [fresh, old]) await db.end();
  // Test schemas/databases are retained for inspection; never drop a database.
  for (const db of [source, copy, admin]) await db.end();
  console.log(`Retained test schemas: ${created.join(', ')}`);
});

test('baseline upgrade preserves balances, reversedAt, refunds, old enums and every old row', async () => {
  assert.deepEqual(await snapshot(old, oldColumns), oldSnapshot);
  assert.equal(
    (await old.query('SELECT "loyaltyPoints" FROM "User"')).rows[0]
      .loyaltyPoints,
    321,
  );
  assert.ok(
    (await old.query('SELECT "gatewayTxnRef" FROM "Payment"')).rows.every(
      (r: any) => r.gatewayTxnRef === null,
    ),
  );
  assert.ok(
    (await old.query('SELECT "eventKey" FROM "LoyaltyTransaction"')).rows.every(
      (r: any) => /^legacy:loyalty:\d+$/.test(r.eventKey),
    ),
  );
});
test('real restored copy retains all source data and history', async () => {
  assert.deepEqual(await snapshot(copy, copiedColumns), copiedSnapshot);
});
test('money, balances, points and whole-order amount constraints reject invalid data', async () =>
  tx(async () => {
    const o = await order();
    await reject(
      'UPDATE "User" SET "loyaltyPoints"=-1 WHERE id=$1',
      [userId],
      '23514',
      'User_points_nonnegative',
    );
    await reject(
      `INSERT INTO "Payment" ("orderId","idempotencyKey","requestHash",amount,method,"updatedAt") VALUES ($1,'negative','h',-1,'VNPAY',now())`,
      [o],
      '23514',
      'Payment_valid_amounts',
    );
    await reject(
      `INSERT INTO "Payment" ("orderId","idempotencyKey","requestHash",amount,method,"updatedAt") VALUES ($1,'partial','h',500,'VNPAY',now())`,
      [o],
      '23503',
      'Payment_orderId_amount_fkey',
    );
    const p = await payment(o);
    await reject(
      'UPDATE "Payment" SET "pointsUsed"=1 WHERE id=$1',
      [p],
      '23514',
      'Payment_points_valid_amounts',
    );
    await reject(
      'UPDATE "Payment" SET "refundedAmount"=1001 WHERE id=$1',
      [p],
      '23514',
    );
    await reject(
      `UPDATE "Payment" SET method='POINTS' WHERE id=$1`,
      [p],
      '23514',
      'Payment_points_valid_amounts',
    );
    await reject(
      'UPDATE "Payment" SET "pointsUsed"=-1 WHERE id=$1',
      [p],
      '23514',
      'Payment_points_valid_amounts',
    );
  }));
test('gateway reference and provider transaction are unique when set; legacy NULLs coexist', async () =>
  tx(async () => {
    const a = await payment(await order());
    const b = await payment(await order());
    await fresh.query(
      'UPDATE "Payment" SET "gatewayTxnRef"=$2,"providerRef"=$3 WHERE id=$1',
      [a, 'GW-REF', 'VNP-TXN'],
    );
    await reject(
      'UPDATE "Payment" SET "gatewayTxnRef"=$2 WHERE id=$1',
      [b, 'GW-REF'],
      '23505',
      'Payment_gatewayTxnRef_key',
    );
    await reject(
      'UPDATE "Payment" SET "providerRef"=$2 WHERE id=$1',
      [b, 'VNP-TXN'],
      '23505',
      'Payment_method_providerRef_key',
    );
    await fresh.query(
      'UPDATE "Payment" SET "gatewayTxnRef"=NULL,"providerRef"=NULL WHERE id=$1',
      [a],
    );
    await reject(
      `UPDATE "Payment" SET "vnpCreateDate"='invalid' WHERE id=$1`,
      [a],
      '23514',
      'Payment_gateway_valid',
    );
    await reject(
      `UPDATE "Payment" SET "gatewayCreatedAt"=now(),"expiresAt"=now()-interval '1 hour' WHERE id=$1`,
      [a],
      '23514',
      'Payment_gateway_valid',
    );
  }));
test('active order uniqueness allows FAILED and late NEEDS_REFUND alongside SUCCESS', async () =>
  tx(async () => {
    const o = await order();
    const first = await payment(o);
    await reject(
      `INSERT INTO "Payment" ("orderId","idempotencyKey","requestHash",amount,method,"updatedAt") VALUES ($1,'second','h',1000,'VNPAY',now())`,
      [o],
      '23505',
      'Payment_one_active_per_order',
    );
    await fresh.query(`UPDATE "Payment" SET status='FAILED' WHERE id=$1`, [
      first,
    ]);
    await payment(o, 'POINTS', 'SUCCESS', 10);
    await fresh.query(
      `UPDATE "Payment" SET status='NEEDS_REFUND',"gatewayPayDate"=now() WHERE id=$1`,
      [first],
    );
    await payment(o, 'VNPAY', 'FAILED');
    assert.equal(
      (
        await fresh.query(
          'SELECT count(*)::int AS n FROM "Payment" WHERE "orderId"=$1',
          [o],
        )
      ).rows[0].n,
      3,
    );
  }));
test('payment idempotency key rejects repeat creates', async () =>
  tx(async () => {
    const p = await payment(await order());
    const key = (
      await fresh.query(
        'SELECT "idempotencyKey" AS key FROM "Payment" WHERE id=$1',
        [p],
      )
    ).rows[0].key;
    await reject(
      `INSERT INTO "Payment" ("orderId","idempotencyKey","requestHash",amount,method,"updatedAt") VALUES ($1,$2,'h',1000,'VNPAY',now())`,
      [await order(), key],
      '23505',
      'Payment_idempotencyKey_key',
    );
  }));
test('signed ledger supports earn, redeem, refund, revoke and rejects duplicate effects', async () =>
  tx(async () => {
    const o = await order();
    const p = await payment(o, 'POINTS', 'SUCCESS', 10);
    const earn = await ledger(o, p, 'EARN', 5);
    const spend = await ledger(o, p, 'REDEEM', -10);
    await ledger(o, p, 'REFUND', 10, spend);
    await ledger(o, p, 'REVOKE', -5, earn);
    assert.equal(
      (
        await fresh.query(
          'SELECT count(*)::int AS n FROM "LoyaltyTransaction" WHERE "orderId"=$1',
          [o],
        )
      ).rows[0].n,
      4,
    );
    await reject(
      `INSERT INTO "LoyaltyTransaction" ("userId","orderId","paymentId",type,points,"eventKey") VALUES ($1,$2,$3,'REDEEM',-10,'again')`,
      [userId, o, p],
      '23505',
      'LoyaltyTransaction_paymentId_type_key',
    );
    const event = (
      await fresh.query(
        'SELECT "eventKey" AS key FROM "LoyaltyTransaction" WHERE id=$1',
        [earn],
      )
    ).rows[0].key;
    await reject(
      `INSERT INTO "LoyaltyTransaction" ("userId","orderId",type,points,"eventKey") VALUES ($1,$2,'ADJUSTMENT',1,$3)`,
      [userId, o, event],
      '23505',
      'LoyaltyTransaction_eventKey_key',
    );
    await reject(
      `INSERT INTO "LoyaltyTransaction" ("userId","orderId",type,points,"eventKey") VALUES ($1,$2,'EARN',-1,'negative-earn')`,
      [userId, o],
      '23514',
      'LoyaltyTransaction_points_sign_check',
    );
    await reject(
      `INSERT INTO "LoyaltyTransaction" ("userId","orderId","paymentId",type,points,"eventKey") VALUES ($1,$2,$3,'REDEEM',1,'positive-spend')`,
      [userId, o, p],
      '23514',
      'LoyaltyTransaction_points_sign_check',
    );
  }));
test('ledger foreign keys reject wrong user, wrong order/payment and cross-order reversal', async () =>
  tx(async () => {
    const o = await order();
    const other = await order();
    const p = await payment(o, 'POINTS', 'SUCCESS', 10);
    const earn = await ledger(o, p, 'EARN', 1);
    const user2 = (
      await fresh.query(
        `INSERT INTO "User" (email,"passwordHash","fullName") VALUES ('other@db.test','x','Other') RETURNING id`,
      )
    ).rows[0].id;
    await reject(
      `INSERT INTO "LoyaltyTransaction" ("userId","orderId",type,points,"eventKey") VALUES ($1,$2,'ADJUSTMENT',1,'wrong-user')`,
      [user2, o],
      '23503',
      'LoyaltyTransaction_orderId_userId_fkey',
    );
    await reject(
      `INSERT INTO "LoyaltyTransaction" ("userId","orderId","paymentId",type,points,"eventKey") VALUES ($1,$2,$3,'REDEEM',-1,'wrong-payment')`,
      [userId, other, p],
      '23503',
      'LoyaltyTransaction_paymentId_orderId_fkey',
    );
    await reject(
      `INSERT INTO "LoyaltyTransaction" ("userId","orderId","relatedTransactionId",type,points,"eventKey") VALUES ($1,$2,$3,'REVOKE',-1,'wrong-related')`,
      [userId, other, earn],
      '23503',
      'LoyaltyTransaction_relatedTransactionId_orderId_userId_fkey',
    );
  }));
test('refund requests do not mark settlement, and full refund keys/state are enforced', async () =>
  tx(async () => {
    const p = await payment(await order(), 'VNPAY', 'SUCCESS');
    const r = (
      await fresh.query(
        `INSERT INTO "PaymentRefund" ("paymentId",amount,"idempotencyKey","updatedAt") VALUES ($1,1000,'refund-key',now()) RETURNING id`,
        [p],
      )
    ).rows[0].id;
    const row = (
      await fresh.query(
        'SELECT "refundedAt","refundedAmount" FROM "Payment" WHERE id=$1',
        [p],
      )
    ).rows[0];
    assert.deepEqual(row, { refundedAt: null, refundedAmount: 0 });
    await reject(
      'UPDATE "PaymentRefund" SET amount=500 WHERE id=$1',
      [r],
      '23503',
      'PaymentRefund_paymentId_amount_fkey',
    );
    await reject(
      `UPDATE "PaymentRefund" SET status='SUCCESS' WHERE id=$1`,
      [r],
      '23514',
      'PaymentRefund_valid_state',
    );
    await reject(
      `INSERT INTO "PaymentRefund" ("paymentId",amount,"idempotencyKey","updatedAt") VALUES ($1,1000,'another-key',now())`,
      [p],
      '23505',
      'PaymentRefund_paymentId_key',
    );
    const p2 = await payment(await order(), 'VNPAY', 'SUCCESS');
    await reject(
      `INSERT INTO "PaymentRefund" ("paymentId",amount,"idempotencyKey","updatedAt") VALUES ($1,1000,'refund-key',now())`,
      [p2],
      '23505',
      'PaymentRefund_idempotencyKey_key',
    );
    await reject(
      'UPDATE "Payment" SET "refundedAmount"=1000 WHERE id=$1',
      [p],
      '23514',
      'Payment_refund_settlement_valid',
    );
    await fresh.query(
      `UPDATE "PaymentRefund" SET status='PROCESSING' WHERE id=$1`,
      [r],
    );
    await fresh.query(
      `UPDATE "PaymentRefund" SET status='FAILED',"failureReason"='bank timeout' WHERE id=$1`,
      [r],
    );
    await fresh.query(
      `UPDATE "PaymentRefund" SET status='SUCCESS',"confirmedAt"=now() WHERE id=$1`,
      [r],
    );
    await fresh.query(
      'UPDATE "Payment" SET "refundedAt"=now(),"refundedAmount"=amount,"refundRef"=$2 WHERE id=$1',
      [p, 'BANK-REFUND'],
    );
  }));
test('audit log retains repeated deliveries and enforces payment FK', async () =>
  tx(async () => {
    const p = await payment(await order());
    for (const src of ['CREATE', 'IPN', 'IPN', 'RETURN', 'QUERY', 'REFUND'])
      await fresh.query(
        `INSERT INTO "PaymentWebhookLog" ("paymentId",source,result,message,"rawPayload","requestId") VALUES ($1,$2,'RECEIVED','Sanitized test','{}','same-correlation')`,
        [p, src],
      );
    assert.equal(
      (
        await fresh.query(
          'SELECT count(*)::int AS n FROM "PaymentWebhookLog" WHERE "paymentId"=$1',
          [p],
        )
      ).rows[0].n,
      6,
    );
    await reject(
      `INSERT INTO "PaymentWebhookLog" ("paymentId",source,result,"rawPayload") VALUES (-1,'IPN','REJECTED','{}')`,
      [],
      '23503',
      'PaymentWebhookLog_paymentId_fkey',
    );
    await reject(
      'DELETE FROM "Payment" WHERE id=$1',
      [p],
      '23503',
      'PaymentWebhookLog_paymentId_fkey',
    );
  }));
test('migration replay is a no-op for fresh baseline and real restored copy', async () => {
  for (const [db, url, schema] of [
    [fresh, testUrl!, freshSchema],
    [old, testUrl!, oldSchema],
    [copy, upgradeUrl!, 'public'],
  ] as const) {
    const before = await snapshot(db);
    const history = (
      await db.query('SELECT * FROM "_prisma_migrations" ORDER BY id')
    ).rows;
    assert.match(
      cli(url, schema, ['migrate', 'deploy']),
      /No pending migrations/,
    );
    assert.deepEqual(await snapshot(db), before);
    assert.deepEqual(
      (await db.query('SELECT * FROM "_prisma_migrations" ORDER BY id')).rows,
      history,
    );
  }
});
test('migration chain has one guarded gateway unique creation and existing source checksums are audited', async () => {
  const creates: string[] = [];
  for (const name of readdirSync(resolve('prisma/migrations')).filter((n) =>
    /^\d/.test(n),
  )) {
    const path = resolve('prisma/migrations', name, 'migration.sql');
    let sql: string;
    try {
      sql = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    if (
      /CREATE UNIQUE INDEX(?: IF NOT EXISTS)? "Payment_gatewayTxnRef_key"/i.test(
        sql,
      )
    )
      creates.push(name);
    const historical = (
      await source.query(
        'SELECT checksum FROM "_prisma_migrations" WHERE migration_name=$1',
        [name],
      )
    ).rows[0];
    if (historical)
      assert.equal(
        createHash('sha256').update(readFileSync(path)).digest('hex'),
        historical.checksum,
        `Applied SQL changed: ${name}`,
      );
  }
  assert.deepEqual(creates, ['20261105091000_payment_foundation']);
});
