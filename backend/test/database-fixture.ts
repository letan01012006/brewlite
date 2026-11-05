import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { configureApp } from '../src/configure-app.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDollarQuote = false;
  let inSingleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      current += char;
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        current += '*/';
        i++;
        continue;
      }
      current += char;
      continue;
    }

    if (!inDollarQuote && !inSingleQuote) {
      if (char === '-' && nextChar === '-') {
        inLineComment = true;
        current += '--';
        i++;
        continue;
      }
      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        current += '/*';
        i++;
        continue;
      }
    }

    if (!inSingleQuote && char === '$' && nextChar === '$') {
      inDollarQuote = !inDollarQuote;
      current += '$$';
      i++;
      continue;
    }

    if (!inDollarQuote && char === "'") {
      if (nextChar === "'") {
        current += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (!inDollarQuote && !inSingleQuote && char === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }

    current += char;
  }
  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}

export async function databaseFixture() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url)
    throw new Error(
      'TEST_DATABASE_URL is required; no integration test may silently skip.',
    );
  const source = new URL(process.env.DATABASE_URL!);
  const target = new URL(url);
  if (
    source.hostname === target.hostname &&
    (source.port || '5432') === (target.port || '5432') &&
    source.pathname === target.pathname
  ) {
    throw new Error('Use a different database from DATABASE_URL.');
  }
  const schema = `brewlite_inventory_${randomUUID().replaceAll('-', '')}`;
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const db = new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: url,
        max: 20,
        application_name: schema,
        options: `-c search_path=${schema}`,
      },
      { schema },
    ),
  });
  const cleanupDb = async () => {
    await db.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  };
  try {
    for (const entry of (
      await readdir(resolve('prisma/migrations'), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const sql = await readFile(
        resolve('prisma/migrations', entry.name, 'migration.sql'),
        'utf8',
      );
      for (const statement of splitSqlStatements(sql))
        await db.$executeRawUnsafe(statement);
    }
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    const app = module.createNestApplication();
    configureApp(app);
    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle('BrewLite API')
          .setVersion('1.0')
          .addBearerAuth()
          .build(),
      ),
    );
    await app.listen(0, '127.0.0.1');
    async function user(role: 'BARISTA' | 'CUSTOMER' = 'CUSTOMER') {
      const row = await db.user.create({
        data: {
          email: `${randomUUID()}@test.example`,
          fullName: 'Inventory Test',
          passwordHash: 'test-only',
          role,
        },
      });
      return {
        ...row,
        token: app
          .get(JwtService)
          .sign({ sub: row.id, email: row.email, role }),
      };
    }
    const barista = await user('BARISTA');
    const customer = await user();
    function api(
      method: 'get' | 'post' | 'put' | 'patch',
      path: string,
      token?: string,
    ) {
      const call = request(app.getHttpServer())[method](`/api${path}`);
      return token ? call.auth(token, { type: 'bearer' }) : call;
    }
    return {
      db,
      app,
      schema,
      user,
      barista,
      customer,
      api,
      close: async () => {
        await app.close();
        await cleanupDb();
      },
    };
  } catch (error) {
    await cleanupDb();
    throw error;
  }
}
export type DatabaseFixture = Awaited<ReturnType<typeof databaseFixture>>;
