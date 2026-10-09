// Dữ liệu mẫu cho BrewLite. Chạy: npx prisma db seed
// Chạy nhiều lần vẫn an toàn (dùng upsert), không tạo trùng.
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Ảnh nằm trong frontend/public/img/<tên>.jpg (bạn tự bỏ ảnh vào, hoặc dùng ảnh tạm).
const products = [
  { name: 'Cà phê sữa', price: 35000, category: 'Cà phê', stock: 50, imageUrl: '/img/ca-phe-sua.jpg', description: 'Cà phê phin pha sữa đặc' },
  { name: 'Americano', price: 40000, category: 'Cà phê', stock: 50, imageUrl: '/img/americano.jpg', description: 'Espresso pha loãng với nước nóng' },
  { name: 'Cappuccino', price: 45000, category: 'Cà phê', stock: 40, imageUrl: '/img/cappuccino.jpg', description: 'Espresso, sữa nóng và lớp bọt sữa' },
  { name: 'Trà đào', price: 39000, category: 'Trà', stock: 40, imageUrl: '/img/tra-dao.jpg', description: 'Trà đen, đào ngâm và sả' },
  { name: 'Latte', price: 48000, category: 'Cà phê', stock: 30, imageUrl: '/img/latte.jpg', description: 'Espresso với nhiều sữa tươi' },
  { name: 'Bạc xỉu', price: 38000, category: 'Cà phê', stock: 40, imageUrl: '/img/bac-xiu.jpg', description: 'Nhiều sữa, ít cà phê' },
  { name: 'Trà vải', price: 42000, category: 'Trà', stock: 35, imageUrl: '/img/tra-vai.jpg', description: 'Trà hoa nhài với vải' },
  { name: 'Trà sữa trân châu', price: 45000, category: 'Trà', stock: 35, imageUrl: '/img/tra-sua.jpg', description: 'Trà sữa truyền thống' },
  { name: 'Matcha đá xay', price: 52000, category: 'Đá xay', stock: 25, imageUrl: '/img/matcha-da-xay.jpg', description: 'Matcha xay cùng đá và sữa' },
  { name: 'Cà phê muối', price: 42000, category: 'Cà phê', stock: 5, imageUrl: '/img/ca-phe-muoi.jpg', description: 'Stock thấp (5) để test đặt đồng thời' },
];

// Tạo theo thứ tự này nên trên DB trống: id 1 = Trân châu, 2 = Kem cheese, 3 = Thạch
const toppings = [
  { name: 'Trân châu', price: 5000 },
  { name: 'Kem cheese', price: 7000 },
  { name: 'Thạch', price: 4000 },
];

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

  for (const p of products) {
    await prisma.product.upsert({ where: { name: p.name }, update: {}, create: p });
  }
  for (const t of toppings) {
    await prisma.topping.upsert({ where: { name: t.name }, update: {}, create: t });
  }
  for (const c of promoCodes) {
    await prisma.promoCode.upsert({ where: { code: c.code }, update: {}, create: c });
  }

  const users = [
    { email: 'demo@brewlite.com', fullName: 'Khách Demo', password: 'Demo@1234', role: 'CUSTOMER' as const },
    { email: 'barista@brewlite.com', fullName: 'Barista Demo', password: 'Barista@123', role: 'BARISTA' as const },
  ];
  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, fullName: u.fullName, role: u.role, passwordHash },
    });
  }

  console.log(
    `Done: ${products.length} sản phẩm, ${toppings.length} topping, ${promoCodes.length} mã giảm giá, ${users.length} tài khoản.`,
  );
  console.log('Tài khoản demo: demo@brewlite.com / Demo@1234, barista@brewlite.com / Barista@123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
