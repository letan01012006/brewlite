import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DefaultVnpayGateway, VnpayGateway } from './vnpay.gateway.js';
import { verifyVnpaySignature } from './vnpay.util.js';

describe('DefaultVnpayGateway', () => {
  const merchantConfig = {
    VNPAY_TMN_CODE: 'FZL3EVU2',
    VNPAY_HASH_SECRET: 'AAKZTEDEWXLKWYGJCFJQQIZGJYXUZDDL',
    VNPAY_PAYMENT_URL: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    VNPAY_API_URL: 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction',
    VNPAY_RETURN_URL: 'http://localhost:3000/payment/vnpay-return',
    PAYMENT_EXPIRE_MINUTES: 15,
  };

  it('initializes correctly with VNPAY_PAYMENT_URL', () => {
    const configService = new ConfigService(merchantConfig);
    const gateway = new DefaultVnpayGateway(configService);

    expect(gateway.isConfigured()).toBe(true);

    const { paymentUrl } = gateway.createPaymentUrl({
      orderId: 100,
      paymentId: 200,
      amount: 50000,
      ipAddr: '127.0.0.1',
    });

    expect(paymentUrl.startsWith('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?')).toBe(true);
  });

  it('generates verified checkout URL meeting all SIT requirements', () => {
    const configService = new ConfigService(merchantConfig);
    const gateway = new DefaultVnpayGateway(configService);

    const { paymentUrl, txnRef, vnpCreateDate, expiresAt } = gateway.createPaymentUrl({
      orderId: 101,
      paymentId: 201,
      amount: 45000,
      ipAddr: '127.0.0.1',
      orderInfo: 'Thanh toan don hang #101',
    });

    const url = new URL(paymentUrl);
    expect(url.origin + url.pathname).toBe('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html');

    // 1. Assert vnp_TmnCode strictly equals FZL3EVU2
    const params: Record<string, string> = {};
    for (const [key, value] of url.searchParams.entries()) {
      params[key] = value;
    }
    expect(params['vnp_TmnCode']).toBe('FZL3EVU2');
    expect(params['vnp_Amount']).toBe('4500000'); // 45000 * 100
    expect(params['vnp_TxnRef']).toBe(txnRef);

    // 2. Assert vnp_SecureHash is validly generated via HMAC-SHA512
    const secureHash = params['vnp_SecureHash'];
    expect(secureHash).toBeDefined();
    expect(secureHash).toHaveLength(128);
    const isValid = verifyVnpaySignature(params, merchantConfig.VNPAY_HASH_SECRET);
    expect(isValid).toBe(true);

    // 3. Assert queryString is strictly sorted by ASCII order
    const searchString = url.search.slice(1); // remove leading '?'
    const queryPairs = searchString.split('&');
    const queryKeys = queryPairs.map((p) => p.split('=')[0]);

    // Check that keys excluding vnp_SecureHash (and vnp_SecureHashType if any) are sorted
    const nonHashKeys = queryKeys.filter((k) => k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType');
    const sortedNonHashKeys = [...nonHashKeys].sort();
    expect(nonHashKeys).toEqual(sortedNonHashKeys);
  });

  it('supports backwards compatibility fallback to VNPAY_PAY_URL', () => {
    const fallbackConfig = {
      VNPAY_TMN_CODE: 'FZL3EVU2',
      VNPAY_HASH_SECRET: 'AAKZTEDEWXLKWYGJCFJQQIZGJYXUZDDL',
      VNPAY_PAY_URL: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    };
    const configService = new ConfigService(fallbackConfig);
    const gateway = new DefaultVnpayGateway(configService);

    const { paymentUrl } = gateway.createPaymentUrl({
      orderId: 102,
      paymentId: 202,
      amount: 30000,
      ipAddr: '127.0.0.1',
    });

    expect(paymentUrl.startsWith('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?')).toBe(true);
  });

  it('resolves DefaultVnpayGateway via Nest DI with ConfigModule loading backend/.env', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: [
            path.resolve(process.cwd(), 'backend/.env'),
            path.resolve(process.cwd(), '.env'),
            fileURLToPath(new URL('../../../../.env', import.meta.url)),
          ],
        }),
      ],
      providers: [
        {
          provide: VnpayGateway,
          useClass: DefaultVnpayGateway,
        },
      ],
    }).compile();

    const gateway = moduleRef.get<VnpayGateway>(VnpayGateway);
    expect(gateway).toBeDefined();
    expect(gateway.isConfigured()).toBe(true);

    const { paymentUrl } = gateway.createPaymentUrl({
      orderId: 999,
      paymentId: 888,
      amount: 50000,
      ipAddr: '127.0.0.1',
    });
    expect(paymentUrl).toContain('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?');
    expect(paymentUrl).toContain('vnp_TmnCode=FZL3EVU2');
  });
});
