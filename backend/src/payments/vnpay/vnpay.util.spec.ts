import { describe, expect, it } from 'vitest';
import {
  buildPaymentUrl,
  buildQuerydrPayload,
  buildRefundPayload,
  buildVnpaySignData,
  encodeVnpParam,
  formatVnpDate,
  generateTxnRef,
  parseVnpDate,
  sanitizeVnpayPayload,
  signHmacSha512,
  verifyVnpaySignature,
  type VnpayConfig,
} from './vnpay.util.js';

describe('VNPAY utility functions', () => {
  const sampleConfig: VnpayConfig = {
    tmnCode: 'BREWLITETMN',
    hashSecret: 'MYSECRETKEY1234567890ABCDEF',
    payUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    apiUrl: 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction',
    returnUrl: 'http://localhost:3000/payment/vnpay-return',
    expireMinutes: 15,
  };

  it('formats Date into 14 digits in Asia/Ho_Chi_Minh', () => {
    // 2026-11-05T01:30:00Z -> UTC+7 is 08:30:00 on 2026-11-05
    const utcDate = new Date('2026-11-05T01:30:00Z');
    const vnpDate = formatVnpDate(utcDate);
    expect(vnpDate).toBe('20261105083000');
    expect(vnpDate).toHaveLength(14);
  });

  it('parses 14 digits string to valid UTC Date', () => {
    const vnpDateStr = '20261105083000';
    const parsed = parseVnpDate(vnpDateStr);
    expect(parsed).not.toBeNull();
    expect(parsed!.toISOString()).toBe('2026-11-05T01:30:00.000Z');

    expect(parseVnpDate('invalid')).toBeNull();
    expect(parseVnpDate(undefined)).toBeNull();
  });

  it('generates alphanumeric txnRef of valid length', () => {
    const ref = generateTxnRef(7, 9);
    expect(ref).toMatch(/^BL7P9T[A-Z0-9]+$/);
    expect(ref.length).toBeGreaterThanOrEqual(8);
    expect(ref.length).toBeLessThanOrEqual(34);
  });

  it('encodes VNPAY query params replacing space with +', () => {
    expect(encodeVnpParam('Thanh toan don hang #1')).toBe(
      'Thanh+toan+don+hang+%231',
    );
  });

  it('sorts params ASCII and excludes hash fields and empty values', () => {
    const params = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: 'TEST',
      vnp_SecureHash: 'somehash',
      vnp_SecureHashType: 'SHA512',
      vnp_Empty: '',
      vnp_Null: null,
      vnp_Amount: '100000',
    };
    const { signData } = buildVnpaySignData(params);
    expect(signData).toBe(
      'vnp_Amount=100000&vnp_Command=pay&vnp_TmnCode=TEST&vnp_Version=2.1.0',
    );
  });

  it('signs and verifies HMAC-SHA512 signature', () => {
    const params: Record<string, unknown> = {
      vnp_Amount: '4000000',
      vnp_Command: 'pay',
      vnp_TmnCode: sampleConfig.tmnCode,
      vnp_TxnRef: 'BL1P1',
    };
    const { signData } = buildVnpaySignData(params);
    const hash = signHmacSha512(signData, sampleConfig.hashSecret);

    params.vnp_SecureHash = hash;

    // Signature verification with correct secret
    expect(verifyVnpaySignature(params, sampleConfig.hashSecret)).toBe(true);

    // Tampered params
    const tampered = { ...params, vnp_Amount: '5000000' };
    expect(verifyVnpaySignature(tampered, sampleConfig.hashSecret)).toBe(false);

    // Tampered secret
    expect(verifyVnpaySignature(params, 'WRONG_SECRET')).toBe(false);
  });

  it('builds complete payment URL with signature', () => {
    const createDate = new Date('2026-11-05T01:00:00Z');
    const { paymentUrl, txnRef, vnpCreateDate, expiresAt } = buildPaymentUrl(
      sampleConfig,
      {
        orderId: 10,
        paymentId: 20,
        amount: 40000,
        ipAddr: '127.0.0.1',
        createDate,
      },
    );

    expect(paymentUrl).toContain(sampleConfig.payUrl);
    expect(paymentUrl).toContain('vnp_Amount=4000000');
    expect(paymentUrl).toContain(`vnp_TmnCode=${sampleConfig.tmnCode}`);
    expect(paymentUrl).toContain('vnp_SecureHash=');
    expect(txnRef).toContain('BL10P20');
    expect(vnpCreateDate).toBe('20261105080000');
    expect(expiresAt.getTime() - createDate.getTime()).toBe(15 * 60 * 1000);
  });

  it('builds querydr and refund payloads with pipe-delimited HMAC-SHA512', () => {
    const querydr = buildQuerydrPayload(sampleConfig, {
      requestId: 'req-1',
      txnRef: 'BL1P1',
      transactionDate: '20261105080000',
      ipAddr: '127.0.0.1',
    });
    expect(querydr.vnp_Command).toBe('querydr');
    expect(querydr.vnp_SecureHash).toHaveLength(128); // SHA-512 hex length

    const refund = buildRefundPayload(sampleConfig, {
      requestId: 'req-refund-1',
      txnRef: 'BL1P1',
      amount: 40000,
      transactionDate: '20261105080000',
      createBy: 'barista',
      ipAddr: '127.0.0.1',
    });
    expect(refund.vnp_Command).toBe('refund');
    expect(refund.vnp_TransactionType).toBe('02');
    expect(refund.vnp_Amount).toBe('4000000');
    expect(refund.vnp_SecureHash).toHaveLength(128);
  });

  it('sanitizes VNPAY payload stripping vnp_SecureHash and secret fields', () => {
    const raw = {
      vnp_TmnCode: 'TEST',
      vnp_Amount: '4000000',
      vnp_SecureHash: 'secret-hash',
      vnp_SecureHashType: 'SHA512',
      vnp_BankCode: 'NCB',
      password: 'mypassword',
      secret: 'supersecret',
    };
    const sanitized = sanitizeVnpayPayload(raw);
    expect(sanitized).toEqual({
      vnp_TmnCode: 'TEST',
      vnp_Amount: '4000000',
      vnp_BankCode: 'NCB',
    });
    expect(sanitized).not.toHaveProperty('vnp_SecureHash');
    expect(sanitized).not.toHaveProperty('password');
  });
});

