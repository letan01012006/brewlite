import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OtpService } from './otp.service.js';

function service(overrides: Record<string, string> = {}) {
  const config = new ConfigService({
    NODE_ENV: 'test',
    SMS_PROVIDER: 'esms',
    AUTH_OTP_DEMO: 'false',
    OTP_HASH_SECRET: 'unit-test-hmac-secret-at-least-32-characters',
    ESMS_API_KEY: 'unit-test-api-key',
    ESMS_SECRET_KEY: 'unit-test-secret-key',
    ESMS_BRANDNAME: 'Baotrixemay',
    ESMS_OTP_TEMPLATE: '{OTP} la ma xac minh dang ky Baotrixemay cua ban',
    ESMS_TIMEOUT_MS: '100',
    ...overrides,
  });
  return new OtpService(config);
}

afterEach(() => vi.unstubAllGlobals());

describe('eSMS OTP adapter', () => {
  it('allows a local fixed demo OTP to be reissued without looping', () => {
    const otp = service({ SMS_PROVIDER: 'local', AUTH_OTP_DEMO: 'true' });
    const first = otp.issue('0911111111');
    expect(otp.issue('0911111111', first.data.otpHash).code).toBe('123456');
  });

  it('sends the approved template through the real SMS endpoint and awaits acceptance', async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ CodeResult: '100', SMSID: 'test-message' }),
      );
    vi.stubGlobal('fetch', send);
    await service().send('0911111111', '654321');
    const [endpoint, options] = send.mock.calls[0];
    expect(endpoint).toBe(
      'https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/',
    );
    expect(options).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(JSON.parse(options!.body as string)).toEqual({
      ApiKey: 'unit-test-api-key',
      SecretKey: 'unit-test-secret-key',
      Phone: '0911111111',
      Brandname: 'Baotrixemay',
      Content: '654321 la ma xac minh dang ky Baotrixemay cua ban',
      SmsType: '2',
      Sandbox: '0',
      IsUnicode: '0',
      RequestId: expect.any(String),
    });
  });

  it('always issues random six-digit OTPs when eSMS is enabled, even with local demo requested', () => {
    const otp = service({ AUTH_OTP_DEMO: 'true' });
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const issued = otp.issue('0911111111');
      expect(issued.code).toMatch(/^\d{6}$/);
      expect(issued.code).not.toBe('123456');
      expect(issued.data.otpHash).toBe(otp.hash('0911111111', issued.code));
      expect(
        issued.data.otpExpiresAt.getTime() - issued.data.otpSentAt.getTime(),
      ).toBe(300000);
      codes.add(issued.code);
    }
    expect(codes.size).toBeGreaterThan(1);
  });

  it.each([
    'ESMS_API_KEY',
    'ESMS_SECRET_KEY',
    'ESMS_BRANDNAME',
    'ESMS_OTP_TEMPLATE',
  ])('rejects missing %s before making a network request', async (field) => {
    const send = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', send);
    await expect(
      service({ [field]: '' }).send('0911111111', '654321'),
    ).rejects.toMatchObject({ response: { code: 'SMS_NOT_CONFIGURED' } });
    expect(send).not.toHaveBeenCalled();
  });

  it('requires an OTP placeholder in the configured template', async () => {
    await expect(
      service({ ESMS_OTP_TEMPLATE: 'fixed text' }).send('0911111111', '654321'),
    ).rejects.toMatchObject({ response: { code: 'SMS_NOT_CONFIGURED' } });
  });

  it('preserves an approved Unicode template and marks IsUnicode correctly', async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ CodeResult: '100' }));
    vi.stubGlobal('fetch', send);
    await service({ ESMS_OTP_TEMPLATE: '{OTP} là mã xác minh' }).send(
      '0911111111',
      '654321',
    );
    expect(JSON.parse(send.mock.calls[0][1]!.body as string)).toMatchObject({
      Content: '654321 là mã xác minh',
      IsUnicode: '1',
    });
  });

  it.each(['104', '146', 100, undefined])(
    'only accepts the string CodeResult="100", rejecting %j',
    async (CodeResult) => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValue(
          Response.json({
            CodeResult,
            ErrorMessage: 'echo 654321 unit-test-secret-key',
          }),
        ),
      );
      const error = await service()
        .send('0911111111', '654321')
        .catch((error) => error);
      expect(error.response.code).toBe('SMS_REJECTED');
      expect(JSON.stringify(error.response)).not.toMatch(
        /654321|unit-test-secret-key|ErrorMessage/,
      );
    },
  );

  it('rejects HTTP errors even if the body contains 100', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ CodeResult: '100' }, { status: 503 }),
        ),
    );
    await expect(service().send('0911111111', '654321')).rejects.toMatchObject({
      response: { code: 'SMS_REJECTED' },
    });
  });

  it('does not expose network exceptions that contain secrets', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(
          new Error('654321 unit-test-api-key unit-test-secret-key'),
        ),
    );
    const error = await service()
      .send('0911111111', '654321')
      .catch((error) => error);
    expect(error.response.code).toBe('SMS_UNAVAILABLE');
    expect(JSON.stringify(error.response)).not.toMatch(/654321|unit-test/);
  });

  it('aborts an unresponsive gateway with a clear timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options!.signal!.addEventListener(
              'abort',
              () => reject(options!.signal!.reason),
              { once: true },
            );
          }),
      ),
    );
    await expect(service().send('0911111111', '654321')).rejects.toMatchObject({
      status: 504,
      response: { code: 'SMS_TIMEOUT' },
    });
  });
});
