import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DefaultVnpayGateway } from './vnpay.gateway.js';

describe('VNPAY configuration preflight', () => {
  it.each([
    ['', 'real-secret'],
    ['REALTMN', ''],
    ['   ', 'real-secret'],
    ['SANDBOX_TMN_CODE', 'real-secret'],
    ['REALTMN', 'SANDBOX_HASH_SECRET'],
    ['YOUR_TMN_CODE', 'YOUR_HASH_SECRET'],
    ['TMN_CODE', 'HASH_SECRET'],
    ['<tmn-code>', '<hash-secret>'],
  ])('rejects absent or sample credentials (%s)', (tmnCode, hashSecret) => {
    const gateway = new DefaultVnpayGateway(
      new ConfigService({
        VNPAY_TMN_CODE: tmnCode,
        VNPAY_HASH_SECRET: hashSecret,
      }),
    );
    expect(gateway.isConfigured()).toBe(false);
    expect(() =>
      gateway.createPaymentUrl({
        orderId: 1,
        paymentId: 1,
        amount: 50000,
        ipAddr: '127.0.0.1',
      }),
    ).toThrow(ServiceUnavailableException);
  });

  it('accepts merchant credentials and builds a signed URL', () => {
    const gateway = new DefaultVnpayGateway(
      new ConfigService({
        VNPAY_TMN_CODE: 'REALTMN',
        VNPAY_HASH_SECRET: 'merchant-secret-12345678',
      }),
    );
    expect(gateway.isConfigured()).toBe(true);
    expect(
      gateway.createPaymentUrl({
        orderId: 1,
        paymentId: 1,
        amount: 50000,
        ipAddr: '127.0.0.1',
      }).paymentUrl,
    ).toContain('vnp_SecureHash=');
  });
});
