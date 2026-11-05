import { describe, expect, it, vi } from 'vitest';
import { InventoryService } from './inventory.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';

describe('inventory calculation and admission', () => {
  const service = new InventoryService({} as PrismaService);
  it('aggregates repeated ingredients across products and toppings exactly', () => {
    expect(
      service.aggregate([
        {
          qty: 3,
          ingredients: [
            { ingredientId: 1, unit: 'GRAM', quantity: '0.1' },
            { ingredientId: 1, unit: 'GRAM', quantity: '0.2' },
          ],
        },
        {
          qty: 2,
          ingredients: [{ ingredientId: 1, unit: 'GRAM', quantity: '0.3' }],
        },
      ]),
    ).toEqual([{ ingredientId: 1, unit: 'GRAM', quantity: '1.500' }]);
  });
  it('rejects mismatched units instead of silently combining quantities', () => {
    expect(() =>
      service.aggregate([
        {
          qty: 1,
          ingredients: [
            { ingredientId: 1, unit: 'GRAM', quantity: '1' },
            { ingredientId: 1, unit: 'PIECE', quantity: '1' },
          ],
        },
      ]),
    ).toThrow();
  });
  it('subtracts reservations and rejects shortages before a hold can be created', async () => {
    const tx = {
      ingredient: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 1,
            unit: 'GRAM',
            isActive: true,
            stockQuantity: new Prisma.Decimal(10),
            reservedQuantity: new Prisma.Decimal(9),
          },
        ]),
      },
    };
    const snapshot = {
      schemaVersion: 1 as const,
      recipeId: 1,
      recipeVersion: 0,
      toppings: [],
      ingredients: [{ ingredientId: 1, unit: 'GRAM' as const, quantity: '2' }],
    };
    await expect(
      service.assertAvailable(
        tx as unknown as Prisma.TransactionClient,
        [snapshot],
        [1],
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
