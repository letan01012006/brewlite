// Dữ liệu mẫu cho BrewLite. Chạy: npx prisma db seed
// Chạy nhiều lần vẫn an toàn (dùng upsert), không tạo trùng.
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  DEMO_PRODUCTS as products,
  DEMO_TOPPINGS as toppings,
  seedDemoCatalog,
} from './demo-catalog.js';
import { seedDemoInventory } from './demo-inventory.js';

const databaseUrl = process.env.DATABASE_URL!;
const adapter = new PrismaPg(
  { connectionString: databaseUrl },
  { schema: new URL(databaseUrl).searchParams.get('schema') ?? 'public' },
);
const prisma = new PrismaClient({ adapter });

const promoCodes = [
  {
    code: 'BREW10',
    type: 'PERCENT' as const,
    value: 10,
    minOrderValue: 50000,
    maxDiscount: 30000,
    startsAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2027-12-31T23:59:59Z'),
    usageLimit: null,
  },
  {
    code: 'GIAM15K',
    type: 'FIXED' as const,
    value: 15000,
    minOrderValue: 80000,
    maxDiscount: null,
    startsAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2027-12-31T23:59:59Z'),
    usageLimit: 100,
  },
  {
    // mã đã hết hạn, để test lỗi PROMO_EXPIRED
    code: 'HETHAN',
    type: 'PERCENT' as const,
    value: 20,
    minOrderValue: 0,
    maxDiscount: null,
    startsAt: new Date('2025-01-01T00:00:00Z'),
    expiresAt: new Date('2025-12-31T23:59:59Z'),
    usageLimit: null,
  },
];

async function main() {
  console.log('Seeding BrewLite...');

  await seedDemoCatalog(prisma);
  await seedDemoInventory(prisma);
  for (const c of promoCodes) {
    await prisma.promoCode.upsert({
      where: { code: c.code },
      update: {},
      create: c,
    });
  }

  const users = [
    {
      email: 'demo@brewlite.com',
      fullName: 'Khách Demo',
      password: 'Demo@1234',
      role: 'CUSTOMER' as const,
    },
    {
      email: 'barista@brewlite.com',
      fullName: 'Barista Demo',
      password: 'Barista@123',
      role: 'BARISTA' as const,
    },
  ];
  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        passwordHash,
      },
    });
  }

  console.log(
    `Done: ${products.length} sản phẩm, ${toppings.length} topping, ${promoCodes.length} mã giảm giá, ${users.length} tài khoản.`,
  );
  console.log(
    'Tài khoản demo: demo@brewlite.com / Demo@1234, barista@brewlite.com / Barista@123',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
