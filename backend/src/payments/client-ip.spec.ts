import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { getClientIp, isValidIpv4, normalizeIp } from './client-ip.js';

describe('client-ip utility', () => {
  it('validates IPv4 format correctly', () => {
    expect(isValidIpv4('127.0.0.1')).toBe(true);
    expect(isValidIpv4('192.168.1.100')).toBe(true);
    expect(isValidIpv4('255.255.255.255')).toBe(true);
    expect(isValidIpv4('0.0.0.0')).toBe(true);

    expect(isValidIpv4('256.0.0.1')).toBe(false);
    expect(isValidIpv4('192.168.1')).toBe(false);
    expect(isValidIpv4('192.168.1.1.1')).toBe(false);
    expect(isValidIpv4('192.168.01.1')).toBe(false);
    expect(isValidIpv4('::1')).toBe(false);
    expect(isValidIpv4('abc')).toBe(false);
  });

  it('normalizes IPv6 and IPv4 addresses to valid IPv4', () => {
    expect(normalizeIp('::1')).toBe('127.0.0.1');
    expect(normalizeIp('::ffff:192.168.1.50')).toBe('192.168.1.50');
    expect(normalizeIp('10.0.0.1')).toBe('10.0.0.1');
    expect(normalizeIp(undefined)).toBe('127.0.0.1');
    expect(normalizeIp('fe80::1')).toBe('127.0.0.1');
  });

  it('reads X-Forwarded-For only when proxy is trusted', () => {
    const req = {
      headers: {
        'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178',
      },
      socket: {
        remoteAddress: '192.168.1.1',
      },
    } as unknown as Request;

    // Untrusted proxy ignores X-Forwarded-For
    expect(getClientIp(req, false)).toBe('192.168.1.1');

    // Trusted proxy uses client IP (the first one)
    expect(getClientIp(req, true)).toBe('203.0.113.195');
  });
});

