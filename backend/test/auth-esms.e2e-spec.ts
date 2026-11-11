import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { databaseFixture, type DatabaseFixture } from './database-fixture.js';
import { OtpService } from '../src/auth/otp.service.js';
import { WELCOME_POINTS } from '../src/promotions/voucher-rules.js';

describe('Registration and resend through eSMS (mock gateway, real HTTP and PostgreSQL)', () => {
  let f: DatabaseFixture;
  let sequence = 0;
  const phone = () => '096' + String(++sequence).padStart(7, '0');
  const gateway = vi.fn<typeof fetch>();
  const register = (phone: string) =>
    f
      .api('post', '/auth/register')
      .send({ fullName: 'SMS Test', phone, password: 'Password@123' });
  const resend = (phone: string) =>
    f.api('post', '/auth/resend-otp').send({ phone });
  const verify = (phone: string, code: string) =>
    f.api('post', '/auth/verify-otp').send({ phone, code });
  function sentCode(index = gateway.mock.calls.length - 1) {
    return (
      JSON.parse(gateway.mock.calls[index][1]!.body as string).Content as string
    ).slice(0, 6);
  }

  beforeAll(async () => {
    // Never use the live keys from .env or send a billable SMS in automated tests.
    vi.stubEnv('SMS_PROVIDER', 'esms');
    vi.stubEnv('AUTH_OTP_DEMO', 'true');
    vi.stubEnv('ESMS_API_KEY', 'integration-test-api-key');
    vi.stubEnv('ESMS_SECRET_KEY', 'integration-test-secret-key');
    vi.stubEnv('ESMS_BRANDNAME', 'Baotrixemay');
    vi.stubEnv(
      'ESMS_OTP_TEMPLATE',
      '{OTP} la ma xac minh dang ky Baotrixemay cua ban',
    );
    vi.stubEnv('ESMS_TIMEOUT_MS', '100');
    f = await databaseFixture();
  }, 40000);
  afterAll(async () => {
    await f?.close();
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    gateway
      .mockReset()
      .mockImplementation(async () => Response.json({ CodeResult: '100' }));
    vi.stubGlobal('fetch', gateway);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('registers, waits for eSMS acceptance, verifies the random OTP and grants welcome points once', async () => {
    const logs = ['log', 'warn', 'error', 'debug', 'verbose'].map((method) =>
      vi.spyOn(Logger.prototype, method as 'log'),
    );
    const p = phone();
    const result = await register(p).expect(201);
    expect(gateway).toHaveBeenCalledTimes(1);
    const code = sentCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(code).not.toBe('123456');
    expect(JSON.stringify(result.body)).not.toMatch(
      new RegExp(`${code}|otpHash|integration-test|SecretKey`),
    );
    const pending = await f.db.user.findUniqueOrThrow({ where: { phone: p } });
    expect(pending).toMatchObject({
      isPhoneVerified: false,
      loyaltyPoints: 0,
      otpAttempts: 0,
    });
    expect(pending.otpHash).toBe(f.app.get(OtpService).hash(p, code));
    const verified = await verify(p, code).expect(200);
    expect(verified.body.user).toMatchObject({
      isPhoneVerified: true,
      loyaltyPoints: WELCOME_POINTS,
    });
    await verify(p, code).expect(400);
    expect(
      (await f.db.user.findUniqueOrThrow({ where: { phone: p } }))
        .loyaltyPoints,
    ).toBe(WELCOME_POINTS);
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });

  it('does not return success until the gateway response arrives', async () => {
    let accept!: (value: Response) => void;
    let started!: () => void;
    const called = new Promise<void>((resolve) => {
      started = resolve;
    });
    gateway.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        accept = resolve;
      });
    });
    let completed = false;
    const request = register(phone()).then((result) => {
      completed = true;
      return result;
    });
    await called;
    expect(completed).toBe(false);
    accept(Response.json({ CodeResult: '100' }));
    expect((await request).status).toBe(201);
  });

  it('resends a replacement code, blocks racing resends, and invalidates the old code', async () => {
    const p = phone();
    await register(p).expect(201);
    const oldCode = sentCode();
    await resend(p).expect(429);
    expect(gateway).toHaveBeenCalledTimes(1);
    await f.db.user.update({
      where: { phone: p },
      data: { otpSentAt: new Date(Date.now() - 61000) },
    });
    const results = await Promise.all([resend(p), resend(p)]);
    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([200, 429]);
    expect(gateway).toHaveBeenCalledTimes(2);
    const code = sentCode();
    expect(code).not.toBe(oldCode);
    await verify(p, oldCode).expect(400);
    await verify(p, code).expect(200);
  });

  it.each(['104', '146'])(
    'keeps the account pending and allows immediate resend after eSMS rejection %s',
    async (CodeResult) => {
      gateway.mockResolvedValueOnce(
        Response.json({
          CodeResult,
          ErrorMessage: 'integration-test-secret-key provider echo',
        }),
      );
      const p = phone();
      const result = await register(p).expect(502);
      expect(result.body).toMatchObject({
        code: 'SMS_REJECTED',
        details: { phone: p, requiresOtp: true, resendAfter: 0 },
      });
      expect(JSON.stringify(result.body)).not.toMatch(
        /integration-test|provider echo/,
      );
      const failedCode = sentCode();
      expect(
        await f.db.user.findUniqueOrThrow({ where: { phone: p } }),
      ).toMatchObject({
        isPhoneVerified: false,
        loyaltyPoints: 0,
        otpHash: null,
        otpExpiresAt: null,
        otpSentAt: null,
      });
      await verify(p, failedCode).expect(400);
      await resend(p).expect(200);
      await verify(p, sentCode()).expect(200);
    },
  );

  it('clears a failed resend so another attempt can succeed immediately', async () => {
    const p = phone();
    await register(p).expect(201);
    await f.db.user.update({
      where: { phone: p },
      data: { otpSentAt: new Date(Date.now() - 61000) },
    });
    gateway.mockRejectedValueOnce(new Error('secret echo'));
    expect((await resend(p).expect(502)).body.code).toBe('SMS_UNAVAILABLE');
    await resend(p).expect(200);
    await verify(p, sentCode()).expect(200);
  });

  it('handles missing configuration without losing the pending account or preventing resend', async () => {
    const config = f.app.get(ConfigService);
    config.set('ESMS_BRANDNAME', '');
    const p = phone();
    try {
      expect((await register(p).expect(503)).body.code).toBe(
        'SMS_NOT_CONFIGURED',
      );
      expect(gateway).not.toHaveBeenCalled();
      expect((await resend(p).expect(503)).body.code).toBe(
        'SMS_NOT_CONFIGURED',
      );
      expect(await f.db.user.count({ where: { phone: p } })).toBe(1);
    } finally {
      config.set('ESMS_BRANDNAME', 'Baotrixemay');
    }
    await resend(p).expect(200);
    await verify(p, sentCode()).expect(200);
  });

  it('times out safely and allows another send without accepting the uncertain code', async () => {
    gateway.mockImplementationOnce(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener(
            'abort',
            () => reject(options!.signal!.reason),
            { once: true },
          );
        }),
    );
    const p = phone();
    expect((await register(p).expect(504)).body.code).toBe('SMS_TIMEOUT');
    await verify(p, sentCode()).expect(400);
    await resend(p).expect(200);
    await verify(p, sentCode()).expect(200);
  });
});
