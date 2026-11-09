import bcrypt from 'bcrypt';
import { PrismaClient } from '../src/generated/prisma/client.js';

export async function seedManager(prisma: PrismaClient) {
  if (process.env.AUTH_DEMO_SEED !== 'true') return;
  if (!['development', 'test'].includes(process.env.NODE_ENV ?? ''))
    throw new Error('AUTH_DEMO_SEED is allowed only in development/test');
  const phone = process.env.DEMO_MANAGER_PHONE;
  const password = process.env.DEMO_MANAGER_PASSWORD;
  if (!phone || !/^0[0-9]{9}$/.test(phone) || !password || password.length < 8 || password.length > 64 || !/^(?=.*[A-Za-z])(?=.*\d).+$/.test(password))
    throw new Error('Set valid DEMO_MANAGER_PHONE and DEMO_MANAGER_PASSWORD');
  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) {
    if (existing.role !== 'MANAGER' || !existing.isPhoneVerified)
      throw new Error('Demo manager phone belongs to another account; refusing to change existing user');
    return;
  }
  await prisma.user.create({ data: {
    phone, fullName: 'Quản lý Demo', role: 'MANAGER', isPhoneVerified: true,
    passwordHash: await bcrypt.hash(password, 10),
  } });
  console.log('Created demo MANAGER: ' + phone);
}
