import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseFixture, type DatabaseFixture } from './database-fixture.js';

describe('Product API validation and visibility', () => {
  let f: DatabaseFixture;
  const category = `Catalog ${randomUUID()}`;
  let activeId: number;
  let inactiveId: number;

  beforeAll(async () => {
    f = await databaseFixture();
    const active = await f.db.product.create({
      data: {
        name: randomUUID(),
        category,
        price: 35000,
        imageUrl: '/img/default.jpg',
      },
    });
    activeId = active.id;
    const inactive = await f.db.product.create({
      data: {
        name: randomUUID(),
        category,
        price: 35000,
        imageUrl: '/img/default.jpg',
        isActive: false,
      },
    });
    inactiveId = inactive.id;
  }, 35000);

  afterAll(async () => {
    await f?.close();
  });

  function create(body: Record<string, unknown>) {
    return f.api('post', '/products', f.barista.token).send(body);
  }

  function catalog(includeInactive?: string, token?: string) {
    return f.api('get', '/products', token).query({
      category,
      ...(includeInactive === undefined ? {} : { includeInactive }),
    });
  }

  it.each([0, 35000, 2147483647])(
    'creates a product with trimmed fields and valid price %i',
    async (price) => {
      const name = `Cà phê ${randomUUID()}`;
      const result = await create({
        name: ` \t${name}\n `,
        category: ' \tCà phê\n ',
        price,
      }).expect(201);

      expect(result.body).toMatchObject({ name, category: 'Cà phê', price });
      expect(
        await f.db.product.findUniqueOrThrow({ where: { id: result.body.id } }),
      ).toMatchObject({ name, category: 'Cà phê', price });
    },
  );

  it('uses the trimmed name for the existing uniqueness constraint', async () => {
    const name = randomUUID();
    await create({ name, category: 'Coffee', price: 35000 }).expect(201);
    await create({
      name: ` ${name} `,
      category: 'Coffee',
      price: 35000,
    }).expect(409);
    expect(await f.db.product.count({ where: { name } })).toBe(1);
  });

  it.each(['name', 'category'])(
    'rejects whitespace-only %s with a field-specific 400 and no insert',
    async (field) => {
      const count = await f.db.product.count();
      const result = await create({
        name: randomUUID(),
        category: 'Coffee',
        price: 35000,
        [field]: ' \t\r\n\u00a0 ',
      }).expect(400);

      expect(result.body.code).toBe('VALIDATION_ERROR');
      expect(result.body.details).toEqual(
        expect.arrayContaining([expect.stringContaining(field)]),
      );
      expect(await f.db.product.count()).toBe(count);
    },
  );

  it.each([
    ['name', 123],
    ['name', null],
    ['name', ['Coffee']],
    ['category', 123],
    ['category', null],
    ['category', { value: 'Coffee' }],
  ])('rejects invalid type for %s: %j', async (field, value) => {
    const result = await create({
      name: randomUUID(),
      category: 'Coffee',
      price: 35000,
      [field as string]: value,
    }).expect(400);
    expect(result.body.details).toEqual(
      expect.arrayContaining([expect.stringContaining(field as string)]),
    );
  });

  it.each([
    2147483648,
    Number.MAX_SAFE_INTEGER,
    1e100,
    -1,
    1.5,
    '35000',
    null,
    true,
  ])(
    'rejects out-of-range or non-integer price %j before writing to the DB',
    async (price) => {
      const name = randomUUID();
      const result = await create({ name, category: 'Coffee', price }).expect(
        400,
      );
      expect(result.body.code).toBe('VALIDATION_ERROR');
      expect(result.body.details).toEqual(
        expect.arrayContaining([expect.stringContaining('price')]),
      );
      expect(await f.db.product.count({ where: { name } })).toBe(0);
    },
  );

  it('allows BARISTA to list active and inactive products', async () => {
    const result = await catalog('true', f.barista.token).expect(200);
    expect(result.body.meta.total).toBe(2);
    expect(result.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: activeId, isActive: true }),
        expect.objectContaining({ id: inactiveId, isActive: false }),
      ]),
    );
  });

  it('requires authentication for includeInactive=true', async () => {
    const result = await catalog('true').expect(401);
    expect(result.body.code).toBe('UNAUTHORIZED');
  });

  it('rejects an invalid token for includeInactive=true', async () => {
    await catalog('true', 'invalid-token').expect(401);
  });

  it('forbids CUSTOMER from listing inactive products', async () => {
    const result = await catalog('true', f.customer.token).expect(403);
    expect(result.body.code).toBe('FORBIDDEN');
  });

  it('authorizes the current DB role rather than a forged BARISTA claim', async () => {
    const token = f.app.get(JwtService).sign({
      sub: f.customer.id,
      email: f.customer.email,
      role: 'BARISTA',
    });
    await catalog('true', token).expect(403);
  });

  it('does not grant MANAGER the BARISTA-only permission', async () => {
    const manager = await f.user();
    await f.db.user.update({
      where: { id: manager.id },
      data: { role: 'MANAGER' },
    });
    await catalog('true', manager.token).expect(403);
  });

  it.each([undefined, 'false'])(
    'keeps the public catalog active-only with includeInactive=%s',
    async (includeInactive) => {
      const result = await catalog(includeInactive).expect(200);
      expect(result.body.meta.total).toBe(1);
      expect(result.body.data).toEqual([
        expect.objectContaining({ id: activeId, isActive: true }),
      ]);
    },
  );

  it.each(['1', 'TRUE', 'true,false'])(
    'rejects malformed includeInactive=%s without exposing inactive products',
    async (value) => {
      await catalog(value).expect(400);
    },
  );
});
