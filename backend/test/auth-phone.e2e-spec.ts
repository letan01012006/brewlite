import bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { databaseFixture, type DatabaseFixture } from './database-fixture.js';
import { OtpService } from '../src/auth/otp.service.js';
import { WELCOME_POINTS } from '../src/promotions/voucher-rules.js';
import { seedManager } from '../prisma/manager-seed.js';

describe('Phone auth, OTP concurrency, manager provisioning and legacy upgrade', () => {
  let f: DatabaseFixture;
  let n = 0;
  let legacy: Record<string, unknown>[];
  let oldOrders: Record<string, unknown>[];
  const password = 'Password@123';
  const phone = () => '097' + String(++n).padStart(7, '0');
  const register = (p = phone(), extra = {}) => f.api('post', '/auth/register').send({ fullName: 'Khách OTP', phone: p, password, ...extra });
  const verify = (p: string, code = '123456') => f.api('post', '/auth/verify-otp').send({ phone: p, code });
  const login = (body: object) => f.api('post', '/auth/login').send({ password, ...body });

  beforeAll(async () => {
    process.env.AUTH_OTP_DEMO = 'true';
    const hash = await bcrypt.hash(password, 10);
    f = await databaseFixture(async db => {
      // These inserts run BEFORE the auth migration, against the old NOT NULL email schema.
      for (const role of ['CUSTOMER', 'BARISTA']) {
        await db.$executeRawUnsafe(`INSERT INTO "User" (email,"passwordHash","fullName",role,"loyaltyPoints") VALUES ($1,$2,$3,$4::"Role",345)`, `${role.toLowerCase()}@legacy.test`, hash, 'Legacy ' + role, role);
      }
      await db.$executeRawUnsafe(`INSERT INTO "Order" ("userId",status,subtotal,total,"updatedAt") SELECT id,'COMPLETED',50000,50000,now() FROM "User" WHERE email='customer@legacy.test'`);
      legacy = await db.$queryRawUnsafe(`SELECT * FROM "User" ORDER BY id`);
      oldOrders = await db.$queryRawUnsafe(`SELECT * FROM "Order" ORDER BY id`);
    });
  }, 40000);
  afterAll(async () => { await f?.close(); });

  it('migration preserves every old user field, password hash, ID, role, points and order', async () => {
    for (const before of legacy) {
      const after = await f.db.user.findUniqueOrThrow({ where: { id: before.id as number } });
      for (const [key, value] of Object.entries(before)) expect(after[key as keyof typeof after]).toEqual(value);
      expect(after.phone).toBeNull();
      expect(after.otpHash).toBeNull();
    }
    const orders = await f.db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "Order" ORDER BY id`);
    expect(orders).toHaveLength(oldOrders.length);
    for (const before of oldOrders) {
      const after = orders.find(order => order.id === before.id)!;
      for (const [key, value] of Object.entries(before)) expect(after[key]).toEqual(value);
    }
  });

  it.each(['customer', 'barista'])('old %s still logs in by email and retains ID/role/points', async role => {
    const res = await login({ email: ` ${role.toUpperCase()}@LEGACY.TEST ` }).expect(200);
    const old = legacy.find(row => row.email === `${role}@legacy.test`)!;
    expect(res.body.user).toMatchObject({ id: old.id, role: role.toUpperCase(), loyaltyPoints: 345, phone: null });
    await f.api('get', '/auth/me', res.body.accessToken).expect(200);
  });

  it('register -> OTP -> immediate JWT -> phone login, email null and exactly one welcome grant', async () => {
    const p = phone();
    const reg = await register(p).expect(201);
    expect(reg.body).toMatchObject({ phone: p, requiresOtp: true, expiresIn: 300, resendAfter: 60 });
    expect(reg.body.accessToken).toBeUndefined();
    const pending = await f.db.user.findUniqueOrThrow({ where: { phone: p } });
    expect(pending).toMatchObject({ role: 'CUSTOMER', email: null, isPhoneVerified: false, loyaltyPoints: 0 });
    expect(await bcrypt.compare(password, pending.passwordHash)).toBe(true);
    expect(pending.otpHash).not.toBe('123456');
    expect(pending.otpHash).toHaveLength(64);
    expect(pending.otpExpiresAt!.getTime() - pending.otpSentAt!.getTime()).toBe(300000);
    await login({ phone: p, password: 'Wrong123' }).expect(401);
    const blocked = await login({ phone: p }).expect(403);
    expect(blocked.body.code).toBe('PHONE_NOT_VERIFIED');
    const verified = await verify(p).expect(200);
    expect(verified.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 86400, user: { email: null, phone: p, role: 'CUSTOMER', loyaltyPoints: WELCOME_POINTS, isPhoneVerified: true } });
    const me = await f.api('get', '/auth/me', verified.body.accessToken).expect(200);
    expect(me.body.email).toBeNull();
    expect(me.body.passwordHash).toBeUndefined();
    await login({ phone: p }).expect(200);
    await verify(p).expect(400);
    const saved = await f.db.user.findUniqueOrThrow({ where: { phone: p } });
    expect(saved.otpHash).toBeNull();
    expect(saved.welcomePointsGrantedAt).toBeInstanceOf(Date);
    expect(saved.loyaltyPoints).toBe(WELCOME_POINTS);
  });

  it('parallel correct requests consume one OTP and grant points only once', async () => {
    const p = phone(); await register(p).expect(201);
    const results = await Promise.all([verify(p), verify(p)]);
    expect(results.map(r => r.status).sort((a, b) => a - b)).toEqual([200, 400]);
    expect((await f.db.user.findUniqueOrThrow({ where: { phone: p } })).loyaltyPoints).toBe(WELCOME_POINTS);
  });

  it('wrong OTP attempts commit; fifth failure blocks even a correct code', async () => {
    const p = phone(); await register(p).expect(201);
    for (let i = 1; i <= 5; i++) {
      const res = await verify(p, '000000').expect(400);
      expect(res.body.code).toBe(i === 5 ? 'OTP_ATTEMPTS_EXCEEDED' : 'OTP_INVALID');
    }
    const locked = await verify(p).expect(400);
    expect(locked.body.code).toBe('OTP_ATTEMPTS_EXCEEDED');
    expect((await f.db.user.findUniqueOrThrow({ where: { phone: p } })).otpAttempts).toBe(5);
  });

  it('parallel wrong requests cannot exceed or bypass five attempts', async () => {
    const p = phone(); await register(p).expect(201);
    const res = await Promise.all(Array.from({ length: 7 }, () => verify(p, '111111')));
    expect(res.every(r => r.status === 400)).toBe(true);
    expect((await f.db.user.findUniqueOrThrow({ where: { phone: p } })).otpAttempts).toBe(5);
    await verify(p).expect(400);
  });

  it('expired OTP and unknown phone fail without JWT or welcome points', async () => {
    const p = phone(); await register(p).expect(201);
    await f.db.user.update({ where: { phone: p }, data: { otpExpiresAt: new Date(Date.now() - 1) } });
    expect((await verify(p).expect(400)).body.code).toBe('OTP_EXPIRED');
    expect((await f.db.user.findUniqueOrThrow({ where: { phone: p } })).loyaltyPoints).toBe(0);
    await verify(phone()).expect(400);
  });

  it('resend cooldown is 60 seconds; racing resends produce one replacement; attempts reset', async () => {
    const p = phone(); await register(p).expect(201);
    await verify(p, '000000').expect(400);
    expect((await f.api('post', '/auth/resend-otp').send({ phone: p }).expect(429)).body.code).toBe('OTP_RESEND_TOO_SOON');
    await f.db.user.update({ where: { phone: p }, data: { otpSentAt: new Date(Date.now() - 61000) } });
    const results = await Promise.all([f.api('post', '/auth/resend-otp').send({ phone: p }), f.api('post', '/auth/resend-otp').send({ phone: p })]);
    expect(results.map(r => r.status).sort((a, b) => a - b)).toEqual([200, 429]);
    expect((await f.db.user.findUniqueOrThrow({ where: { phone: p } })).otpAttempts).toBe(0);
    await verify(p).expect(200);
    await f.api('post', '/auth/resend-otp').send({ phone: p }).expect(400);
  });

  it('random mode replaces old code; fixed code is not accepted with demo disabled', async () => {
    const randomOtp = new OtpService(new ConfigService({ NODE_ENV: 'test', AUTH_OTP_DEMO: 'false', OTP_HASH_SECRET: 'a'.repeat(32) }));
    const issued = randomOtp.issue('0911111111');
    expect(issued.code).toMatch(/^[0-9]{6}$/);
    expect(issued.code).not.toBe('123456');
    // Switch the real service issuance for this test, preserving the configured HMAC key.
    const otp = f.app.get(OtpService);
    const original = otp.issue.bind(otp);
    const spy = vi.spyOn(otp, 'issue').mockImplementation(p => {
      const result = original(p);
      result.code = '654321'; result.data.otpHash = otp.hash(p, result.code);
      return result;
    });
    try {
      const p = phone();
      await register(p).expect(201);
      await verify(p).expect(400);
      await f.db.user.update({ where: { phone: p }, data: { otpSentAt: new Date(Date.now() - 61000) } });
      spy.mockImplementation(p => { const r = original(p); r.code = '987654'; r.data.otpHash = otp.hash(p, r.code); return r; });
      await f.api('post', '/auth/resend-otp').send({ phone: p }).expect(200);
      await verify(p, '654321').expect(400);
      await verify(p, '987654').expect(200);
    } finally { spy.mockRestore(); }
  });

  it('production rejects demo mode; unconfigured SMS permits startup but fails delivery', async () => {
    expect(() => new OtpService(new ConfigService({ NODE_ENV: 'production', AUTH_OTP_DEMO: 'true' }))).toThrow(/development\/test/);
    const otp = new OtpService(new ConfigService({ NODE_ENV: 'production', AUTH_OTP_DEMO: 'false', OTP_HASH_SECRET: 'a'.repeat(32) }));
    const issued = otp.issue(phone());
    await expect(otp.send(phone(), issued.code)).rejects.toMatchObject({ response: { code: 'SMS_NOT_CONFIGURED' } });
  });

  it('duplicate phone/email returns 409, including racing registrations', async () => {
    const p = phone(); const email = 'new@customer.test';
    await register(p, { email }).expect(201);
    expect((await register(p).expect(409)).body.code).toBe('PHONE_ALREADY_EXISTS');
    expect((await register(phone(), { email: ' NEW@CUSTOMER.TEST ' }).expect(409)).body.code).toBe('EMAIL_ALREADY_EXISTS');
    const next = phone();
    expect((await Promise.all([register(next), register(next)])).map(r => r.status).sort((a, b) => a - b)).toEqual([201, 409]);
  });

  it('public registration rejects role injection and invalid input', async () => {
    await register(phone(), { role: 'MANAGER' }).expect(400);
    for (const invalid of ['1234567890', '0912', '09123456789', 912345678, null]) await register(invalid as string).expect(400);
    await register(phone(), { password: 'abcdefgh' }).expect(400);
    await register(phone(), { password: '12345678' }).expect(400);
    await register(phone(), { fullName: '  ' }).expect(400);
    await register(phone(), { email: 'invalid' }).expect(400);
    await login({ phone: phone(), email: 'customer@legacy.test' }).expect(400);
    await login({}).expect(400);
  });

  it('manager seed is opt-in, idempotent and preserves existing credentials/points', async () => {
    const count = await f.db.user.count();
    process.env.AUTH_DEMO_SEED = 'false';
    await seedManager(f.db);
    expect(await f.db.user.count()).toBe(count);
    process.env.AUTH_DEMO_SEED = 'true'; process.env.DEMO_MANAGER_PHONE = '0900000001'; process.env.DEMO_MANAGER_PASSWORD = password;
    const environment = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await expect(seedManager(f.db)).rejects.toThrow(/development\/test/);
      process.env.NODE_ENV = environment;
      await seedManager(f.db);
      const before = await f.db.user.findUniqueOrThrow({ where: { phone: '0900000001' } });
      await seedManager(f.db);
      expect(await f.db.user.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
      const collision = phone();
      await register(collision).expect(201);
      process.env.DEMO_MANAGER_PHONE = collision;
      await expect(seedManager(f.db)).rejects.toThrow(/refusing to change/);
    } finally {
      process.env.NODE_ENV = environment;
      delete process.env.AUTH_DEMO_SEED;
      process.env.DEMO_MANAGER_PHONE = '0900000001';
    }
  });

  it('MANAGER creates BARISTA -> phone login immediately; CUSTOMER/BARISTA receive 403', async () => {
    const manager = await login({ phone: '0900000001' }).expect(200);
    const staffPhone = phone();
    const body = { phone: staffPhone, fullName: 'Nhân viên mới', password };
    const created = await f.api('post', '/admin/staff', manager.body.accessToken).send(body).expect(201);
    expect(created.body).toMatchObject({ role: 'BARISTA', isPhoneVerified: true, email: null, loyaltyPoints: 0 });
    expect(created.body.passwordHash).toBeUndefined();
    const staff = await login({ phone: staffPhone }).expect(200);
    await f.api('get', '/auth/me', staff.body.accessToken).expect(200);
    await f.api('get', '/orders', staff.body.accessToken).expect(200);
    await f.api('post', '/admin/staff', staff.body.accessToken).send({ ...body, phone: phone() }).expect(403);
    const customer = await login({ email: 'customer@legacy.test' }).expect(200);
    await f.api('post', '/admin/staff', customer.body.accessToken).send({ ...body, phone: phone() }).expect(403);
    await f.api('post', '/admin/staff').send(body).expect(401);
    await f.api('post', '/admin/staff', manager.body.accessToken).send(body).expect(409);
    await f.api('post', '/admin/staff', manager.body.accessToken).send({ ...body, phone: phone(), role: 'MANAGER' }).expect(400);
    await login({ phone: staffPhone, password: 'Wrong123' }).expect(401);
    // Current DB roles override stale/forged role claims in otherwise signed JWTs.
    const forged = f.app.get(JwtService).sign({ sub: customer.body.user.id, email: null, role: 'MANAGER' });
    await f.api('post', '/admin/staff', forged).send({ ...body, phone: phone() }).expect(403);
  });

  it('Swagger exposes all auth/staff routes and bearer authentication', async () => {
    const res = await f.api('get', '/docs-json').expect(200);
    for (const path of ['/api/auth/register', '/api/auth/verify-otp', '/api/auth/resend-otp', '/api/auth/login', '/api/admin/staff']) expect(res.body.paths[path].post).toBeDefined();
    expect(res.body.paths['/api/admin/staff'].post.security).toEqual([{ bearer: [] }]);
  });
});
