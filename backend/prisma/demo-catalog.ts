import type { PrismaClient } from '../src/generated/prisma/client.js';
import { DEMO_PRODUCT_TOPPINGS } from './demo-product-toppings.js';

export const DEMO_PRODUCTS = [
  {
    name: 'Cà phê sữa',
    price: 35000,
    category: 'Cà phê',
    stock: 50,
    imageUrl: '/img/ca-phe-sua.jpg',
    description: 'Cà phê phin pha sữa đặc',
  },
  {
    name: 'Americano',
    price: 40000,
    category: 'Cà phê',
    stock: 50,
    imageUrl: '/img/americano.jpg',
    description: 'Espresso pha loãng với nước nóng',
  },
  {
    name: 'Cappuccino',
    price: 45000,
    category: 'Cà phê',
    stock: 40,
    imageUrl: '/img/cappuccino.jpg',
    description: 'Espresso, sữa nóng và lớp bọt sữa',
  },
  {
    name: 'Trà đào',
    price: 39000,
    category: 'Trà',
    stock: 40,
    imageUrl: '/img/tra-dao.jpg',
    description: 'Trà đen, đào ngâm và sả',
  },
  {
    name: 'Latte',
    price: 48000,
    category: 'Cà phê',
    stock: 30,
    imageUrl: '/img/latte.jpg',
    description: 'Espresso với nhiều sữa tươi',
  },
  {
    name: 'Bạc xỉu',
    price: 38000,
    category: 'Cà phê',
    stock: 40,
    imageUrl: '/img/bac-xiu.jpg',
    description: 'Nhiều sữa, ít cà phê',
  },
  {
    name: 'Trà vải',
    price: 42000,
    category: 'Trà',
    stock: 35,
    imageUrl: '/img/tra-vai.jpg',
    description: 'Trà hoa nhài với vải',
  },
  {
    name: 'Trà sữa trân châu',
    price: 45000,
    category: 'Trà',
    stock: 35,
    imageUrl: '/img/tra-sua.jpg',
    description: 'Trà sữa truyền thống',
  },
  {
    name: 'Matcha đá xay',
    price: 52000,
    category: 'Đá xay',
    stock: 25,
    imageUrl: '/img/matcha-da-xay.jpg',
    description: 'Matcha xay cùng đá và sữa',
  },
  {
    name: 'Cà phê muối',
    price: 42000,
    category: 'Cà phê',
    stock: 5,
    imageUrl: '/img/ca-phe-muoi.jpg',
    description: 'Stock thấp (5) để test đặt đồng thời',
  },
];

// Resolve database IDs by name; IDs need not start at 1 or be contiguous.
export const DEMO_TOPPINGS = [
  { name: 'Trân châu', price: 5000 },
  { name: 'Kem cheese', price: 7000 },
  { name: 'Thạch', price: 4000 },
];

export async function seedDemoCatalog(prisma: PrismaClient) {
  await prisma.$transaction(async (tx) => {
    const toppingRows = await Promise.all(
      DEMO_TOPPINGS.map((t) =>
        tx.topping.upsert({ where: { name: t.name }, update: {}, create: t }),
      ),
    );
    for (const p of DEMO_PRODUCTS) {
      const ids = DEMO_PRODUCT_TOPPINGS[p.name].map((name) => {
        const topping = toppingRows.find((t) => t.name === name);
        if (!topping) throw new Error(`Missing demo topping: ${name}`);
        return { id: topping.id };
      });
      // Existing demo products are backfilled ONCE by migration
      // 20261103153000_product_toppings. Never reset a manager's later choices.
      await tx.product.upsert({
        where: { name: p.name },
        update: {},
        create: { ...p, toppings: { connect: ids } },
      });
    }
  });
}
