import { PricingService } from './pricing.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

function fixture() {
  const x = { id: 41, name: 'X', price: 5000, isActive: true };
  const y = { id: 93, name: 'Y', price: 7000, isActive: true };
  const findMany = vi.fn().mockResolvedValue([
    { id: 11, name: 'A', price: 35000, toppings: [x] },
    { id: 27, name: 'B', price: 40000, toppings: [y] },
    { id: 38, name: 'C', price: 45000, toppings: [] },
  ]);
  const db = { product: { findMany } } as unknown as PrismaService;
  return { service: new PricingService(db), db, findMany };
}

describe('PricingService product-specific toppings', () => {
  it('prices A + X and a topping-free C using only database names/prices', async () => {
    const { service, findMany } = fixture();
    const result = await service.calculate([
      { productId: 11, size: 'M', toppingIds: [41], quantity: 2 },
      { productId: 38, size: 'S', quantity: 1 },
    ]);
    expect(result.subtotal).toBe(135000);
    expect(result.lines[0]).toMatchObject({
      unitPrice: 45000,
      lineTotal: 90000,
      toppings: [{ id: 41, name: 'X', price: 5000 }],
    });
    expect(result.lines[1].toppings).toEqual([]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { toppings: { where: { isActive: true } } },
      }),
    );
  });

  it.each([[93], [987654], [41, 41], [1, 2, 3, 4], [-1]])(
    'rejects invalid selections %j without silently deduplicating',
    async (...ids) => {
      const { service } = fixture();
      await expect(
        service.calculate([
          { productId: 11, size: 'S', quantity: 1, toppingIds: ids },
        ]),
      ).rejects.toThrow();
    },
  );

  it('uses the caller transaction instead of the root client', async () => {
    const { service, findMany } = fixture();
    const tx = {
      product: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    await expect(
      service.calculate([{ productId: 11, size: 'S', quantity: 1 }], tx),
    ).rejects.toThrow();
    expect(findMany).not.toHaveBeenCalled();
  });
});
