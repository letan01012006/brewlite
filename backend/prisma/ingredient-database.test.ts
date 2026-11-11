import 'dotenv/config';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { seedDemoCatalog } from './demo-catalog.js';
import { seedDemoInventory } from './demo-inventory.js';

// Explicit database opt-in. These are real SQL checks, not mocked ORM tests.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    'Set TEST_DATABASE_URL to a separate test database. No tests are silently skipped.',
  );
const source = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL)
  : null;
const target = new URL(databaseUrl);
if (
  source &&
  source.hostname === target.hostname &&
  (source.port || '5432') === (target.port || '5432') &&
  source.pathname === target.pathname
)
  throw new Error(
    'TEST_DATABASE_URL must point to a different database from DATABASE_URL.',
  );

const migrationName = '20261104100000_prepared_topping_inventory';
const runId = randomUUID().replaceAll('-', '');
const freshSchema = `brewlite_ingredients_fresh_${runId}`;
const legacySchema = `brewlite_ingredients_legacy_${runId}`;
const created: string[] = [];
const admin = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});
let fresh: PrismaClient;
let legacy: PrismaClient;
let oldProductId: number;
let oldUserId: number;
let original: Record<string, Array<Record<string, unknown>>>;
const preservedColumns: Record<string, string[]> = {};

function client(schema: string) {
  return new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: databaseUrl, options: `-c search_path=${schema}` },
      { schema },
    ),
  });
}

function cli(schema: string, args: string[], config?: string, pending = false) {
  const url = new URL(databaseUrl!);
  url.searchParams.set('schema', schema);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'),
  );
  env.PATH =
    resolve('node_modules/.bin') +
    delimiter +
    (process.env.PATH ?? process.env.Path ?? '');
  env.DATABASE_URL = url.toString();
  const result = spawnSync(
    process.execPath,
    [
      resolve('node_modules/prisma/build/index.js'),
      ...args,
      ...(config ? ['--config', config] : []),
    ],
    {
      cwd: resolve('.'),
      encoding: 'utf8',
      env,
    },
  );
  const output = result.stdout + result.stderr;
  assert.ok(
    result.status === 0 ||
      (pending && result.status === 1 && /not yet been applied/.test(output)),
    output,
  );
  return output;
}

async function rows(db: PrismaClient) {
  const result: Record<string, Array<Record<string, unknown>>> = {};
  for (const table of [
    'Product',
    'Topping',
    'User',
    'Order',
    'OrderItem',
    'Payment',
    'PromoCode',
    'LoyaltyTransaction',
    '_ProductToTopping',
    'Ingredient',
  ]) {
    // Freeze the actual legacy projection before applying later payment migrations.
    preservedColumns[table] ??= (
      await db.$queryRawUnsafe<Array<{ column_name: string }>>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position`,
        table,
      )
    ).map((row) => row.column_name);
    const projection = preservedColumns[table]
      .map((name) => `"${name}"`)
      .join(', ');
    const order = table === '_ProductToTopping' ? '"A", "B"' : '"id"';
    const [row] = await db.$queryRawUnsafe<
      Array<{ data: Array<Record<string, unknown>> | null }>
    >(
      `SELECT jsonb_agg(to_jsonb(t)) AS data FROM (SELECT ${projection} FROM "${table}" ORDER BY ${order}) t`,
    );
    result[table] = (row.data ?? []).map((entry) => {
      if (table === 'OrderItem') {
        const { recipeSnapshot: _snapshot, ...old } = entry;
        return old;
      }
      if (table === 'Topping') {
        const {
          ingredientId: _ingredient,
          quantityPerServing: _quantity,
          ...old
        } = entry;
        return old;
      }
      return entry;
    });
  }
  return result;
}

async function rejects(
  operation: () => PromiseLike<unknown>,
  expected: string,
) {
  try {
    await operation();
  } catch (cause) {
    const error = cause as Error & { code?: string; meta?: unknown };
    assert.match(
      `${error.code} ${error.message} ${JSON.stringify(error.meta)}`,
      new RegExp(expected),
    );
    return;
  }
  assert.fail(`Expected database rejection: ${expected}`);
}

before(
  async () => {
    for (const schema of [freshSchema, legacySchema]) {
      assert.match(schema, /^brewlite_ingredients_(fresh|legacy)_[a-f0-9]+$/);
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      created.push(schema);
    }
    fresh = client(freshSchema);
    legacy = client(legacySchema);
    cli(freshSchema, ['migrate', 'status'], undefined, true);
    cli(freshSchema, ['migrate', 'deploy']);
    assert.match(cli(freshSchema, ['migrate', 'status']), /up to date/);
    cli(freshSchema, ['db', 'seed']);

    // A temporary config applies ONLY the older migrations, without altering repo files.
    const temp = mkdtempSync(join(tmpdir(), 'brewlite-old-ingredient-schema-'));
    const oldMigrations = join(temp, 'migrations');
    mkdirSync(oldMigrations);
    copyFileSync(
      resolve('prisma/migrations/migration_lock.toml'),
      join(oldMigrations, 'migration_lock.toml'),
    );
    for (const name of readdirSync(resolve('prisma/migrations')).filter(
      (name) => /^\d/.test(name) && name < migrationName,
    )) {
      mkdirSync(join(oldMigrations, name));
      copyFileSync(
        resolve('prisma/migrations', name, 'migration.sql'),
        join(oldMigrations, name, 'migration.sql'),
      );
    }
    const config = join(temp, 'prisma.config.ts');
    writeFileSync(
      config,
      `export default { schema: ${JSON.stringify(resolve('prisma/schema.prisma'))}, engine: 'classic', migrations: { path: ${JSON.stringify(oldMigrations)} }, datasource: { url: process.env.DATABASE_URL } };`,
    );
    cli(legacySchema, ['migrate', 'status'], config, true);
    cli(legacySchema, ['migrate', 'deploy'], config);
    const product = await legacy.product.create({
      data: {
        name: 'Cà phê sữa',
        price: 43000,
        stock: 13,
        version: 7,
        category: 'Cà phê',
        imageUrl: '/old.jpg',
        toppings: { connect: { name: 'Kem cheese' } },
      },
      select: { id: true },
    });
    oldProductId = product.id;
    // Current Prisma inserts auth defaults absent from this historical schema.
    const [user] = await legacy.$queryRaw<Array<{ id: number }>>`
      INSERT INTO "User" (email, "fullName", "passwordHash", "loyaltyPoints")
      VALUES ('legacy-inventory@test.example', 'Legacy', 'unchanged-hash', 321)
      RETURNING id`;
    oldUserId = user.id;
    await legacy.promoCode.create({
      data: {
        code: 'LEGACY',
        type: 'FIXED',
        value: 1000,
        usedCount: 3,
        startsAt: new Date('2020-01-01'),
        expiresAt: new Date('2099-01-01'),
      },
    });
    const topping = await legacy.topping.findUniqueOrThrow({
      where: { name: 'Kem cheese' },
      select: { id: true },
    });
    await legacy.ingredient.create({
      data: {
        code: 'COOKED_PEARLS',
        name: 'Trân châu đã nấu',
        unit: 'GRAM',
        stockQuantity: '1000',
        reservedQuantity: '150',
        version: 9,
      },
    });
    for (const status of ['PENDING', 'PAYMENT_FAILED', 'PAID'] as const) {
      const order = await legacy.order.create({
        data: {
          userId: user.id,
          status,
          subtotal: 50000,
          discountAmount: 1000,
          total: 49000,
          promoCode: 'LEGACY',
          pointsEarned: status === 'PAID' ? 49 : 0,
        },
        select: { id: true },
      });
      // Legacy orders leave the nullable recipeSnapshot unset.
      await legacy.$executeRaw`INSERT INTO "OrderItem" ("orderId","productId","productName",size,toppings,"unitPrice",qty,"lineTotal") VALUES (${order.id},${product.id},'Legacy coffee','S',${JSON.stringify([{ id: topping.id, name: 'Old topping snapshot', price: 7000 }])}::jsonb,50000,1,50000)`;
      const paymentStatus =
        status === 'PAID'
          ? 'SUCCESS'
          : status === 'PENDING'
            ? 'PROCESSING'
            : 'FAILED';
      // Create the historical shape with SQL; the current client also inserts
      // new fields with defaults, which do not exist until the upgrade.
      await legacy.$executeRaw`INSERT INTO "Payment" ("orderId","idempotencyKey","requestHash",amount,method,status,"responseSnapshot","updatedAt") VALUES (${order.id},${`old-${status}`},'old-request-hash',49000,'WALLET',${paymentStatus}::"PaymentStatus",${JSON.stringify({ old: true, total: 49000 })}::jsonb,now())`;
      if (status === 'PAID')
        await legacy.$executeRaw`INSERT INTO "LoyaltyTransaction" ("userId","orderId",points) VALUES (${user.id},${order.id},49)`;
    }
    original = await rows(legacy);
    assert.match(
      cli(legacySchema, ['migrate', 'status'], undefined, true),
      new RegExp(migrationName),
    );
    cli(legacySchema, ['migrate', 'deploy']);
    assert.match(cli(legacySchema, ['migrate', 'status']), /up to date/);
  },
  { timeout: 120000 },
);

after(async () => {
  await fresh?.$disconnect();
  await legacy?.$disconnect();
  for (const schema of created) {
    assert.match(schema, /^brewlite_ingredients_(fresh|legacy)_[a-f0-9]+$/);
    await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  }
  await admin.$disconnect();
});

test('fresh database migrates and seeds 14 ingredients, 30 size recipes and shared milk, with no topping recipes', async () => {
  const ingredientsBefore = await fresh.ingredient.findMany({
    orderBy: { id: 'asc' },
  });
  const recipesBefore = await fresh.productRecipe.findMany({
    orderBy: { id: 'asc' },
    include: { ingredients: { orderBy: { id: 'asc' } } },
  });
  cli(freshSchema, ['db', 'seed']);
  assert.deepEqual(
    await fresh.ingredient.findMany({ orderBy: { id: 'asc' } }),
    ingredientsBefore,
  );
  assert.deepEqual(
    await fresh.productRecipe.findMany({
      orderBy: { id: 'asc' },
      include: { ingredients: { orderBy: { id: 'asc' } } },
    }),
    recipesBefore,
  );
  assert.equal(await fresh.ingredient.count(), 14);
  assert.equal(await fresh.productRecipe.count(), 30);
  assert.equal(await fresh.inventoryMovement.count(), 14);
  assert.equal(await fresh.inventoryReservation.count(), 0);
  const milk = await fresh.ingredient.findUniqueOrThrow({
    where: { code: 'FRESH_MILK' },
  });
  const used = await fresh.productRecipeIngredient.findMany({
    where: { ingredientId: milk.id },
    include: { recipe: { include: { product: true } } },
  });
  assert.ok(used.some((row) => row.recipe.product.name === 'Cappuccino'));
  assert.ok(used.some((row) => row.recipe.product.name === 'Latte'));
  assert.equal(milk.stockQuantity.toString(), '15000');
  const [table] = await fresh.$queryRaw<
    Array<{ name: string | null }>
  >`SELECT to_regclass('"ToppingRecipe"')::text AS name`;
  assert.equal(table.name, null);
});

test('upgrade preserves every old row/relation and leaves old orders null and unreserved', async () => {
  assert.deepEqual(await rows(legacy), original);
  assert.equal(await legacy.ingredient.count(), 1);
  assert.equal(await legacy.productRecipe.count(), 0);
  assert.equal(await legacy.inventoryReservation.count(), 0);
  assert.equal(await legacy.inventoryMovement.count(), 0);
  const oldToppings = await legacy.topping.findMany();
  assert.ok(oldToppings.length > 0);
  assert.ok(
    oldToppings.every(
      (t) => t.ingredientId === null && t.quantityPerServing === null,
    ),
  );
  const items = await legacy.orderItem.findMany();
  assert.ok(
    items.length > 0 && items.every((item) => item.recipeSnapshot === null),
  );
  await seedDemoCatalog(legacy);
  await seedDemoInventory(legacy);
  assert.deepEqual(
    await legacy.product.findUniqueOrThrow({
      where: { id: oldProductId },
      select: { stock: true, version: true, price: true },
    }),
    { stock: 13, version: 7, price: 43000 },
  );
  assert.equal(
    (await legacy.user.findUniqueOrThrow({ where: { id: oldUserId } }))
      .loyaltyPoints,
    321,
  );
  const afterSeed = await rows(legacy);
  for (const [table, oldRows] of Object.entries(original)) {
    for (const row of oldRows)
      assert.ok(
        afterSeed[table].some(
          (current) => JSON.stringify(current) === JSON.stringify(row),
        ),
        `${table}: original row preserved after seed`,
      );
  }
});

test('prepared toppings share Ingredient stock and availability subtracts held amounts before division', async () => {
  const pearls = await fresh.topping.findUniqueOrThrow({
    where: { name: 'Trân châu' },
    include: { ingredient: true },
  });
  assert.equal(pearls.ingredient!.code, 'COOKED_PEARLS');
  assert.equal(pearls.quantityPerServing!.toString(), '50');
  const ingredient = await fresh.ingredient.update({
    where: { id: pearls.ingredientId! },
    data: { stockQuantity: '1000', reservedQuantity: '150' },
  });
  assert.equal(
    ingredient.stockQuantity.div(pearls.quantityPerServing!).floor().toNumber(),
    20,
  );
  assert.equal(
    ingredient.stockQuantity
      .minus(ingredient.reservedQuantity)
      .div(pearls.quantityPerServing!)
      .floor()
      .toNumber(),
    17,
  );
  const second = await fresh.topping.create({
    data: {
      name: randomUUID(),
      price: 0,
      ingredientId: ingredient.id,
      quantityPerServing: '25',
    },
  });
  assert.equal(second.ingredientId, pearls.ingredientId); // Many toppings can share one stock row.
  const plain = await fresh.topping.create({
    data: { name: randomUUID(), price: 0 },
  });
  assert.equal(plain.ingredientId, null);
  assert.equal(plain.quantityPerServing, null);
  await seedDemoInventory(fresh);
  assert.deepEqual(
    await fresh.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } }),
    ingredient,
  );
});

test('topping serving constraints reject incomplete, nonpositive, NaN and missing ingredient mappings atomically', async () => {
  const ingredient = await fresh.ingredient.findUniqueOrThrow({
    where: { code: 'COOKED_PEARLS' },
  });
  for (const data of [
    { ingredientId: ingredient.id },
    { quantityPerServing: '50' },
    ...['0', '-1'].map((quantityPerServing) => ({
      ingredientId: ingredient.id,
      quantityPerServing,
    })),
  ])
    await rejects(
      () =>
        fresh.topping.create({
          data: { name: randomUUID(), price: 0, ...data },
        }),
      'Topping_valid_serving|23514',
    );
  const topping = await fresh.topping.create({
    data: { name: randomUUID(), price: 0 },
  });
  await rejects(
    () =>
      fresh.$executeRaw`UPDATE "Topping" SET "ingredientId" = ${ingredient.id}, "quantityPerServing" = 'NaN'::numeric WHERE id = ${topping.id}`,
    'Topping_valid_serving|23514',
  );
  await rejects(
    () =>
      fresh.topping.update({
        where: { id: topping.id },
        data: { ingredientId: 2147483647, quantityPerServing: '50' },
      }),
    'P2003|23503',
  );
  const before = await fresh.topping.findUniqueOrThrow({
    where: { id: topping.id },
  });
  await rejects(
    () =>
      fresh.$transaction(async (tx) => {
        await tx.topping.update({
          where: { id: topping.id },
          data: { ingredientId: ingredient.id, quantityPerServing: '12.125' },
        });
        await tx.topping.update({
          where: { id: topping.id },
          data: { quantityPerServing: '-1' },
        });
      }),
    'Topping_valid_serving|23514',
  );
  assert.deepEqual(
    await fresh.topping.findUniqueOrThrow({ where: { id: topping.id } }),
    before,
  );
  const dedicated = await fresh.ingredient.create({
    data: { code: randomUUID(), name: randomUUID(), unit: 'GRAM' },
  });
  await fresh.topping.update({
    where: { id: topping.id },
    data: { ingredientId: dedicated.id, quantityPerServing: '12.125' },
  });
  await rejects(
    () => fresh.ingredient.delete({ where: { id: dedicated.id } }),
    'P2003|23503',
  );
  await fresh.topping.update({
    where: { id: topping.id },
    data: { ingredientId: null, quantityPerServing: null },
  });
  await fresh.ingredient.delete({ where: { id: dedicated.id } });
});

test('inventory seed preserves manager-configured topping mapping and serving amount', async () => {
  const topping = await fresh.topping.findUniqueOrThrow({
    where: { name: 'Kem cheese' },
  });
  const ingredient = await fresh.ingredient.create({
    data: {
      code: randomUUID(),
      name: randomUUID(),
      unit: 'GRAM',
      stockQuantity: '500',
      reservedQuantity: '25',
    },
  });
  const changed = await fresh.topping.update({
    where: { id: topping.id },
    data: { ingredientId: ingredient.id, quantityPerServing: '37.125' },
  });
  const movements = await fresh.inventoryMovement.count();
  await seedDemoInventory(fresh);
  await seedDemoInventory(fresh);
  assert.deepEqual(
    await fresh.topping.findUniqueOrThrow({ where: { id: topping.id } }),
    changed,
  );
  assert.deepEqual(
    await fresh.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } }),
    ingredient,
  );
  assert.equal(await fresh.inventoryMovement.count(), movements);
});

test('SQL rejects negative stock/reservations, over-reservation, fractional pieces, NaN and negative versions', async () => {
  const coffee = await fresh.ingredient.findUniqueOrThrow({
    where: { code: 'COFFEE_BEANS' },
  });
  for (const data of [
    { stockQuantity: '-1' },
    { reservedQuantity: '-1' },
    { reservedQuantity: '2001' },
    { version: -1 },
  ])
    await rejects(
      () => fresh.ingredient.update({ where: { id: coffee.id }, data }),
      'Ingredient_valid_stock|23514',
    );
  await rejects(
    () =>
      fresh.$executeRaw`UPDATE "Ingredient" SET "stockQuantity" = 'NaN'::numeric WHERE id = ${coffee.id}`,
    'Ingredient_valid_stock|23514',
  );
  const peach = await fresh.ingredient.findUniqueOrThrow({
    where: { code: 'PEACH_PIECE' },
  });
  for (const data of [{ stockQuantity: '1.5' }, { reservedQuantity: '0.5' }])
    await rejects(
      () => fresh.ingredient.update({ where: { id: peach.id }, data }),
      'Ingredient_valid_stock|23514',
    );
  await rejects(
    () =>
      fresh.ingredient.create({
        data: { code: coffee.code, name: randomUUID(), unit: 'GRAM' },
      }),
    'P2002',
  );
  await rejects(
    () =>
      fresh.ingredient.update({
        where: { id: coffee.id },
        data: { unit: 'MILLILITRE' },
      }),
    'P2003|23503',
  );
});

test('recipe quantities must be positive, unique, and use the ingredient unit, including whole pieces', async () => {
  const product = await fresh.product.create({
    data: {
      name: randomUUID(),
      category: 'Test',
      price: 0,
      stock: 0,
      imageUrl: '/test.jpg',
    },
  });
  const recipe = await fresh.productRecipe.create({
    data: { productId: product.id, size: 'S' },
  });
  assert.equal(recipe.isActive, false); // An empty draft is not an unlimited recipe.
  await rejects(
    () =>
      fresh.productRecipe.create({
        data: { productId: product.id, size: 'S' },
      }),
    'P2002',
  );
  const gram = await fresh.ingredient.findUniqueOrThrow({
    where: { code: 'COFFEE_BEANS' },
  });
  const piece = await fresh.ingredient.findUniqueOrThrow({
    where: { code: 'PEACH_PIECE' },
  });
  for (const quantity of ['0', '-1'])
    await rejects(
      () =>
        fresh.productRecipeIngredient.create({
          data: {
            recipeId: recipe.id,
            ingredientId: gram.id,
            unit: gram.unit,
            quantity,
          },
        }),
      'ProductRecipeIngredient_valid_quantity|23514',
    );
  await rejects(
    () =>
      fresh.productRecipeIngredient.create({
        data: {
          recipeId: recipe.id,
          ingredientId: piece.id,
          unit: piece.unit,
          quantity: '1.5',
        },
      }),
    'ProductRecipeIngredient_valid_quantity|23514',
  );
  await rejects(
    () =>
      fresh.productRecipeIngredient.create({
        data: {
          recipeId: recipe.id,
          ingredientId: gram.id,
          unit: 'MILLILITRE',
          quantity: '1',
        },
      }),
    'P2003|23503',
  );
  const entry = {
    recipeId: recipe.id,
    ingredientId: gram.id,
    unit: gram.unit,
    quantity: '20.125',
  };
  await fresh.productRecipeIngredient.create({ data: entry });
  await rejects(
    () => fresh.productRecipeIngredient.create({ data: entry }),
    'P2002',
  );
});

test('reservation and ledger constraints prevent duplicate/mismatched events; no triggers change balances/orders', async () => {
  const user = await fresh.user.findFirstOrThrow();
  const makeOrder = () =>
    fresh.order.create({ data: { userId: user.id, subtotal: 0, total: 0 } });
  const order = await makeOrder();
  const other = await makeOrder();
  const reservation = await fresh.inventoryReservation.create({
    data: {
      orderId: order.id,
      eventKey: randomUUID(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  await rejects(
    () =>
      fresh.inventoryReservation.create({
        data: { orderId: order.id, eventKey: randomUUID() },
      }),
    'P2002',
  );
  await rejects(
    () =>
      fresh.inventoryReservation.create({
        data: { orderId: other.id, eventKey: reservation.eventKey },
      }),
    'P2002',
  );
  await rejects(
    () =>
      fresh.inventoryReservation.update({
        where: { id: reservation.id },
        data: { status: 'CONSUMED' },
      }),
    'InventoryReservation_valid_lifecycle|23514',
  );
  const coffee = await fresh.ingredient.findUniqueOrThrow({
    where: { code: 'COFFEE_BEANS' },
  });
  const peach = await fresh.ingredient.findUniqueOrThrow({
    where: { code: 'PEACH_PIECE' },
  });
  const item = {
    reservationId: reservation.id,
    ingredientId: coffee.id,
    unit: coffee.unit,
    quantity: '20',
  };
  await fresh.inventoryReservationItem.create({ data: item });
  await rejects(
    () => fresh.inventoryReservationItem.create({ data: item }),
    'P2002',
  );
  for (const quantity of ['0', '-1', '0.5'])
    await rejects(
      () =>
        fresh.inventoryReservationItem.create({
          data: { ...item, ingredientId: peach.id, unit: peach.unit, quantity },
        }),
      'InventoryReservationItem_valid_quantity|23514',
    );
  const held = {
    eventKey: randomUUID(),
    kind: 'HOLD' as const,
    ingredientId: coffee.id,
    unit: coffee.unit,
    stockDelta: '0',
    reservedDelta: '20',
    reservationId: reservation.id,
    orderId: order.id,
    actorId: user.id,
  };
  await fresh.inventoryMovement.create({ data: held });
  await rejects(
    () =>
      fresh.inventoryMovement.create({
        data: { ...held, eventKey: randomUUID() },
      }),
    'P2002',
  );
  await rejects(
    () =>
      fresh.inventoryMovement.create({
        data: {
          ...held,
          kind: 'CONSUME',
          eventKey: randomUUID(),
          stockDelta: '-20',
          reservedDelta: '-20',
          orderId: other.id,
        },
      }),
    'P2003|23503',
  );
  await rejects(
    () =>
      fresh.inventoryMovement.create({
        data: {
          ...held,
          eventKey: randomUUID(),
          ingredientId: peach.id,
          unit: peach.unit,
          reservedDelta: '1',
        },
      }),
    'P2003|23503',
  );
  for (const data of [
    { ...held, stockDelta: '1' },
    { ...held, kind: 'RELEASE' as const, reservedDelta: '1' },
    {
      ...held,
      kind: 'CONSUME' as const,
      stockDelta: '-20',
      reservedDelta: '-19',
    },
    {
      ...held,
      kind: 'CONSUME' as const,
      stockDelta: '20',
      reservedDelta: '-20',
    },
  ])
    await rejects(
      () =>
        fresh.inventoryMovement.create({
          data: { ...data, eventKey: randomUUID() },
        }),
      'InventoryMovement_valid_deltas|23514',
    );
  const receipt = {
    eventKey: randomUUID(),
    kind: 'RECEIPT' as const,
    ingredientId: peach.id,
    unit: peach.unit,
    stockDelta: '1',
    reservedDelta: '0',
  };
  await fresh.inventoryMovement.create({ data: receipt });
  await rejects(
    () => fresh.inventoryMovement.create({ data: receipt }),
    'P2002',
  );
  await rejects(
    () =>
      fresh.inventoryMovement.create({
        data: { ...receipt, eventKey: randomUUID(), stockDelta: '0.5' },
      }),
    'InventoryMovement_valid_deltas|23514',
  );
  await rejects(
    () =>
      fresh.inventoryMovement.create({
        data: { ...receipt, eventKey: randomUUID(), stockDelta: '-1' },
      }),
    'InventoryMovement_valid_deltas|23514',
  );
  await fresh.inventoryMovement.create({
    data: {
      ...held,
      eventKey: randomUUID(),
      kind: 'CONSUME',
      stockDelta: '-20',
      reservedDelta: '-20',
    },
  });
  await fresh.inventoryReservation.update({
    where: { id: reservation.id },
    data: { status: 'CONSUMED', consumedAt: new Date() },
  });
  assert.deepEqual(
    await fresh.ingredient.findUniqueOrThrow({ where: { id: coffee.id } }),
    coffee,
  );
  assert.equal(
    (await fresh.order.findUniqueOrThrow({ where: { id: order.id } })).status,
    'PENDING',
  );
});

test('repeated seed does not add stock/movements or override modified/cleared recipes', async () => {
  const milk = await fresh.ingredient.findUniqueOrThrow({
    where: { code: 'FRESH_MILK' },
  });
  await fresh.ingredient.update({
    where: { id: milk.id },
    data: {
      stockQuantity: '12345',
      reservedQuantity: '345',
      version: 7,
      isActive: false,
    },
  });
  const cappuccino = await fresh.product.findUniqueOrThrow({
    where: { name: 'Cappuccino' },
  });
  const recipe = await fresh.productRecipe.findUniqueOrThrow({
    where: { productId_size: { productId: cappuccino.id, size: 'M' } },
  });
  await fresh.productRecipe.update({
    where: { id: recipe.id },
    data: { isActive: false, version: 3 },
  });
  await fresh.productRecipeIngredient.deleteMany({
    where: { recipeId: recipe.id },
  });
  const latte = await fresh.product.findUniqueOrThrow({
    where: { name: 'Latte' },
  });
  const latteRecipe = await fresh.productRecipe.findUniqueOrThrow({
    where: { productId_size: { productId: latte.id, size: 'M' } },
  });
  await fresh.productRecipeIngredient.update({
    where: {
      recipeId_ingredientId: {
        recipeId: latteRecipe.id,
        ingredientId: milk.id,
      },
    },
    data: { quantity: '177.125' },
  });
  const oldMilk = await fresh.ingredient.findUniqueOrThrow({
    where: { id: milk.id },
  });
  const oldMovements = await fresh.inventoryMovement.count();
  const oldCount = await fresh.productRecipe.count();
  await seedDemoInventory(fresh);
  await seedDemoInventory(fresh);
  assert.deepEqual(
    await fresh.ingredient.findUniqueOrThrow({ where: { id: milk.id } }),
    oldMilk,
  );
  assert.equal(await fresh.inventoryMovement.count(), oldMovements);
  assert.equal(await fresh.productRecipe.count(), oldCount);
  assert.equal(
    await fresh.productRecipeIngredient.count({
      where: { recipeId: recipe.id },
    }),
    0,
  );
  assert.equal(
    (await fresh.productRecipe.findUniqueOrThrow({ where: { id: recipe.id } }))
      .version,
    3,
  );
  assert.equal(
    (
      await fresh.productRecipeIngredient.findUniqueOrThrow({
        where: {
          recipeId_ingredientId: {
            recipeId: latteRecipe.id,
            ingredientId: milk.id,
          },
        },
      })
    ).quantity.toString(),
    '177.125',
  );
});
