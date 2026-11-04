import { randomUUID } from 'node:crypto';
import { databaseFixture, type DatabaseFixture } from './database-fixture.js';

describe('Ingredients and recipes: real HTTP + PostgreSQL', () => {
  let f: DatabaseFixture;
  beforeAll(async () => {
    f = await databaseFixture();
  }, 30000);
  afterAll(async () => {
    await f?.close();
  });
  it('documents the implemented ingredient routes and DTOs in Swagger', async () => {
    await f.api('get', '/docs').expect(200);
    const document = await f.api('get', '/docs-json').expect(200);
    expect(
      document.body.paths['/api/inventory/ingredients'].post.requestBody,
    ).toBeDefined();
    expect(
      document.body.paths['/api/products/{id}/recipes/{size}'].put.responses[
        '200'
      ],
    ).toBeDefined();
    expect(
      document.body.components.schemas.CreateIngredientDto.properties.unit.enum,
    ).toEqual(['GRAM', 'MILLILITRE', 'PIECE']);
  });
  it('01–05 lists, creates, reads and updates metadata; protects stock and units', async () => {
    const body = { code: randomUUID(), name: randomUUID(), unit: 'GRAM' };
    await f.api('post', '/inventory/ingredients').send(body).expect(401);
    await f
      .api('post', '/inventory/ingredients', f.customer.token)
      .send(body)
      .expect(403);
    await f
      .api('post', '/inventory/ingredients', f.barista.token)
      .send({ ...body, stockQuantity: '10' })
      .expect(400);
    await f
      .api('post', '/inventory/ingredients', f.barista.token)
      .send({ ...body, name: ' ' })
      .expect(400);
    const created = await f
      .api('post', '/inventory/ingredients', f.barista.token)
      .send(body)
      .expect(201);
    expect(created.body.stockQuantity).toBe('0');
    await f
      .api('post', '/inventory/ingredients', f.barista.token)
      .send(body)
      .expect(409);
    const path = `/inventory/ingredients/${created.body.id}`;
    await f.api('get', path, f.barista.token).expect(200);
    await f
      .api('patch', path, f.barista.token)
      .send({ name: 'Updated ' + body.name })
      .expect(200);
    await f
      .api('patch', path, f.barista.token)
      .send({ unit: null })
      .expect(400);
    await f
      .api('patch', path, f.barista.token)
      .send({ unit: 'PIECE' })
      .expect(200);
    await f.db.ingredient.update({
      where: { id: created.body.id },
      data: { stockQuantity: 1 },
    });
    await f
      .api('patch', path, f.barista.token)
      .send({ unit: 'GRAM' })
      .expect(409);
    expect(
      (
        await f
          .api('get', '/inventory/ingredients', f.barista.token)
          .expect(200)
      ).body.some((r: { id: number }) => r.id === created.body.id),
    ).toBe(true);
    expect(
      (await f.api('get', '/inventory/units', f.barista.token).expect(200))
        .body,
    ).toEqual(['GRAM', 'MILLILITRE', 'PIECE']);
    await f
      .api('get', '/inventory/ingredients/2147483647', f.barista.token)
      .expect(404);
  });
  it('06–07 validates per-size recipes and prepared topping quantities atomically', async () => {
    const ingredient = await f.db.ingredient.create({
      data: { code: randomUUID(), name: randomUUID(), unit: 'PIECE' },
    });
    const product = await f.db.product.create({
      data: {
        name: randomUUID(),
        category: 'Test',
        price: 10000,
        imageUrl: '/test',
      },
    });
    const path = `/products/${product.id}/recipes/M`;
    await f
      .api('put', path, f.customer.token)
      .send({ ingredients: [], isActive: true })
      .expect(403);
    await f
      .api('put', path, f.barista.token)
      .send({ ingredients: [], isActive: true })
      .expect(400);
    const body = {
      ingredients: [{ ingredientId: ingredient.id, quantity: '2.000' }],
      isActive: true,
    };
    const first = await f
      .api('put', path, f.barista.token)
      .send(body)
      .expect(200);
    await f
      .api('put', path, f.barista.token)
      .send({
        ...body,
        ingredients: [...body.ingredients, ...body.ingredients],
      })
      .expect(400);
    await f
      .api('put', path, f.barista.token)
      .send({
        ...body,
        ingredients: [{ ingredientId: ingredient.id, quantity: '0.5' }],
      })
      .expect(400);
    const saved = await f.api('get', path, f.barista.token).expect(200);
    expect(saved.body.version).toBe(first.body.version);
    expect(saved.body.ingredients[0].quantity).toBe('2');
    await f
      .api('put', path, f.barista.token)
      .send({
        ...body,
        ingredients: [{ ingredientId: ingredient.id, quantity: '3' }],
      })
      .expect(200);
    expect((await f.api('get', path, f.barista.token)).body.version).toBe(
      first.body.version + 1,
    );
    const topping = await f.db.topping.create({
      data: { name: randomUUID(), price: 500 },
    });
    const toppingPath = `/products/toppings/${topping.id}/recipe`;
    await f
      .api('put', toppingPath, f.barista.token)
      .send({ ingredientId: ingredient.id, quantityPerServing: '0.5' })
      .expect(400);
    await f
      .api('put', toppingPath, f.barista.token)
      .send({ ingredientId: ingredient.id, quantityPerServing: '1' })
      .expect(200);
    expect(
      (await f.api('get', toppingPath, f.barista.token).expect(200)).body
        .ingredientId,
    ).toBe(ingredient.id);
    await f
      .api('patch', `/inventory/ingredients/${ingredient.id}`, f.barista.token)
      .send({ unit: 'GRAM' })
      .expect(409);
  });
});
