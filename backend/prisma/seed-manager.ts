import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { seedManager } from './manager-seed.js';

const url = process.env.DATABASE_URL!;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, {
  schema: new URL(url).searchParams.get('schema') ?? 'public',
}) });
try { await seedManager(prisma); }
finally { await prisma.$disconnect(); }
