import { databaseFixture, type DatabaseFixture } from './database-fixture.js';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('Product setup: Chrome with real NestJS + isolated PostgreSQL', () => {
  let f: DatabaseFixture;
  let ingredientId: number;
  beforeAll(async () => {
    f = await databaseFixture();
    const ingredient = await f.db.ingredient.create({
      data: {
        code: 'COFFEE',
        name: 'Cà phê kiểm thử',
        unit: 'GRAM',
        stockQuantity: 1000,
      },
    });
    ingredientId = ingredient.id;
    for (let index = 1; index <= 4; index++) {
      await f.db.topping.create({
        data: {
          name: `Topping ${index}`,
          price: 1000 * index,
          ingredientId,
          quantityPerServing: 5,
        },
      });
    }
  }, 30000);
  afterAll(async () => {
    await f?.close();
  });
  it('creates once, resumes after closing/reload, saves S/M and retains S when M fails', async () => {
    const address = f.app.getHttpServer().address();
    const api = `http://127.0.0.1:${address.port}`;
    const outputDirectory = process.env.PRODUCT_SETUP_OUTPUT
      ? resolve(process.env.PRODUCT_SETUP_OUTPUT)
      : mkdtempSync(join(tmpdir(), 'brewlite-product-report-'));
    const script = resolve('../frontend/test/inventory-product-browser.mjs');
    await new Promise<void>((done, reject) => {
      const child = spawn(process.execPath, [script], {
        env: {
          ...process.env,
          PRODUCT_TEST_API: api,
          PRODUCT_TEST_TOKEN: f.barista.token,
          PRODUCT_TEST_OUTPUT: outputDirectory,
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (data) => {
        output += data;
      });
      child.stderr.on('data', (data) => {
        output += data;
      });
      child.on('error', reject);
      child.on('exit', (code) =>
        code === 0 ? done() : reject(new Error(output)),
      );
    });
    const report = JSON.parse(
      readFileSync(join(outputDirectory, 'product-setup-browser.json'), 'utf8'),
    );
    const product = await f.db.product.findUniqueOrThrow({
      where: { id: report.productId },
      include: { toppings: true, recipes: { include: { ingredients: true } } },
    });
    expect(product.stock).toBe(0);
    expect(product.toppings).toHaveLength(4);
    expect(
      product.recipes.map((row) => row.size).sort((a, b) => a.localeCompare(b)),
    ).toEqual(['M', 'S']);
    expect(product.recipes.every((row) => row.isActive)).toBe(true);
    expect(
      product.recipes
        .find((row) => row.size === 'S')!
        .ingredients[0].quantity.toNumber(),
    ).toBe(50);
    expect(
      product.recipes
        .find((row) => row.size === 'M')!
        .ingredients[0].quantity.toNumber(),
    ).toBe(100);
    expect(
      (
        await f.db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } })
      ).stockQuantity.toNumber(),
    ).toBe(1000);
    expect(await f.db.product.count()).toBe(1);
  });
});
