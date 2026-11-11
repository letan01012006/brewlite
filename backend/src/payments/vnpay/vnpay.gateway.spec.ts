import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('VNPAY refund responses', () => {
  afterEach(() => vi.unstubAllGlobals());
  const gateway = () =>
    new DefaultVnpayGateway(
      new ConfigService({
        VNPAY_TMN_CODE: 'REALTMN',
        VNPAY_HASH_SECRET: 'merchant-secret-12345678',
      }),
    );
  it.each(['', '05', '06', '00'])(
    'separates accepted requests from settled refunds (%s)',
    async (status) => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          vnp_ResponseCode: '00',
          vnp_TransactionStatus: status,
          vnp_TransactionNo: 'REFUND',
        }),
      });
      vi.stubGlobal('fetch', fetchMock);
      const result = await gateway().refund({
        requestId: 'stable-request-id',
        txnRef: 'TXN',
        amount: 50000,
        transactionDate: '20261111100000',
        createBy: 'BARISTA',
      });
      expect(result.success).toBe(status === '00');
      expect(result.pending).toBe(status !== '00');
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).vnp_RequestId).toBe(
        'stable-request-id',
      );
    },
  );
  it('preserves transaction type in reconciliation, distinguishing a refund from the original charge', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          vnp_ResponseCode: '00',
          vnp_TransactionStatus: '00',
          vnp_TransactionType: '02',
          vnp_Amount: '5000000',
        }),
      }),
    );
    expect(
      await gateway().queryTransaction({
        txnRef: 'TXN',
        transactionDate: '20261111100000',
      }),
    ).toMatchObject({
      transactionType: '02',
      transactionStatus: '00',
      amount: 50000,
    });
  });
});
