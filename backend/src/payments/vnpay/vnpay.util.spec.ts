import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import {
  sortObject,
  formatVnpayDate,
  signParams,
  verifySecureHash,
} from './vnpay.util.js';

describe('VNPAY Utilities', () => {
  const TEST_SECRET = 'TEST_SECRET_KEY_1234567890';

  describe('sortObject', () => {
    it('sorts keys in ASCII alphabetical order', () => {
      const input = {
        vnp_Version: '2.1.0',
        vnp_Command: 'pay',
        vnp_TmnCode: 'BREWLITE',
        vnp_Amount: '1000000',
      };
      const sorted = sortObject(input);
      expect(Object.keys(sorted)).toEqual([
        'vnp_Amount',
        'vnp_Command',
        'vnp_TmnCode',
        'vnp_Version',
      ]);
    });

    it('replaces spaces with + characters', () => {
      const input = {
        vnp_OrderInfo: 'Thanh toan don hang #101',
      };
      const sorted = sortObject(input);
      expect(sorted['vnp_OrderInfo']).toBe('Thanh+toan+don+hang+%23101');
    });

    it('ignores null, undefined, and empty string properties', () => {
      const input = {
        vnp_Amount: '50000',
        vnp_BankCode: '',
        vnp_Locale: null,
        vnp_Extra: undefined,
        vnp_Command: 'pay',
      };
      const sorted = sortObject(input);
      expect(sorted).toEqual({
        vnp_Amount: '50000',
        vnp_Command: 'pay',
      });
      expect('vnp_BankCode' in sorted).toBe(false);
      expect('vnp_Locale' in sorted).toBe(false);
      expect('vnp_Extra' in sorted).toBe(false);
    });
  });

  describe('formatVnpayDate', () => {
    it('formats a date as YYYYMMDDHHmmss in Vietnam timezone (UTC+7)', () => {
      // 2026-11-04 05:30:15 UTC -> 2026-11-04 12:30:15 GMT+7
      const date = new Date('2026-11-04T05:30:15.000Z');
      const formatted = formatVnpayDate(date);
      expect(formatted).toBe('20261104123015');
    });

    it('correctly handles month and day zero padding', () => {
      // 2026-01-05 01:02:03 UTC -> 2026-01-05 08:02:03 GMT+7
      const date = new Date('2026-01-05T01:02:03.000Z');
      const formatted = formatVnpayDate(date);
      expect(formatted).toBe('20260105080203');
    });

    it('defaults to current time with valid 14-digit format', () => {
      const formatted = formatVnpayDate();
      expect(formatted).toMatch(/^\d{14}$/);
    });
  });

  describe('signParams', () => {
    it('creates a deterministic HMAC-SHA512 checksum', () => {
      const params = {
        vnp_Amount: '10000000',
        vnp_Command: 'pay',
        vnp_TmnCode: 'BREWLITE',
        vnp_TxnRef: 'ORDER_123',
      };

      const hash1 = signParams(params, TEST_SECRET);
      const hash2 = signParams(params, TEST_SECRET);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{128}$/);

      // Verify independently against crypto
      const expectedSignData =
        'vnp_Amount=10000000&vnp_Command=pay&vnp_TmnCode=BREWLITE&vnp_TxnRef=ORDER_123';
      const expectedHash = crypto
        .createHmac('sha512', TEST_SECRET)
        .update(Buffer.from(expectedSignData, 'utf-8'))
        .digest('hex');
      expect(hash1).toBe(expectedHash);
    });

    it('produces different hash when parameters or secret changes', () => {
      const params = { vnp_Amount: '5000000', vnp_TxnRef: 'TX_1' };
      const hash1 = signParams(params, TEST_SECRET);
      const hashTampered = signParams(
        { ...params, vnp_Amount: '6000000' },
        TEST_SECRET,
      );
      const hashDiffSecret = signParams(params, 'DIFFERENT_SECRET');

      expect(hash1).not.toBe(hashTampered);
      expect(hash1).not.toBe(hashDiffSecret);
    });
  });

  describe('verifySecureHash', () => {
    it('returns true for a valid checksum matching signParams', () => {
      const params = {
        vnp_Amount: '5000000',
        vnp_ResponseCode: '00',
        vnp_TxnRef: 'ORDER_99',
        vnp_TransactionNo: '14567890',
      };
      const hash = signParams(params, TEST_SECRET);

      const queryWithHash = {
        ...params,
        vnp_SecureHash: hash,
        vnp_SecureHashType: 'SHA512',
      };

      expect(verifySecureHash(queryWithHash, TEST_SECRET)).toBe(true);
    });

    it('returns true with case-insensitive hash comparison', () => {
      const params = { vnp_TxnRef: 'TEST_CASE' };
      const hash = signParams(params, TEST_SECRET);

      expect(
        verifySecureHash(
          { ...params, vnp_SecureHash: hash.toUpperCase() },
          TEST_SECRET,
        ),
      ).toBe(true);
    });

    it('returns false when vnp_SecureHash is missing or empty', () => {
      expect(verifySecureHash({ vnp_Amount: '1000' }, TEST_SECRET)).toBe(false);
      expect(
        verifySecureHash(
          { vnp_Amount: '1000', vnp_SecureHash: '' },
          TEST_SECRET,
        ),
      ).toBe(false);
    });

    it('returns false when a parameter has been tampered with', () => {
      const params = {
        vnp_Amount: '5000000',
        vnp_ResponseCode: '00',
        vnp_TxnRef: 'ORDER_99',
      };
      const hash = signParams(params, TEST_SECRET);

      // Hacker changes amount
      const tamperedQuery = {
        ...params,
        vnp_Amount: '1000000', // tampered
        vnp_SecureHash: hash,
      };

      expect(verifySecureHash(tamperedQuery, TEST_SECRET)).toBe(false);
    });

    it('returns false when verified with an incorrect secret key', () => {
      const params = { vnp_TxnRef: 'TX_1' };
      const hash = signParams(params, TEST_SECRET);

      expect(
        verifySecureHash(
          { ...params, vnp_SecureHash: hash },
          'WRONG_SECRET_KEY',
        ),
      ).toBe(false);
    });
  });
});
