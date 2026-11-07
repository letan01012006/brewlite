import type { Request } from 'express';

/**
 * Kiểm tra xem một chuỗi có phải IPv4 hợp lệ hay không (4 octet, mỗi octet từ 0-255).
 */
export function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const num = Number(part);
    return num >= 0 && num <= 255 && String(num) === part;
  });
}

/**
 * Chuẩn hóa một địa chỉ IP thô (IPv4 hoặc IPv6) về dạng IPv4 hợp lệ cho VNPAY vnp_IpAddr.
 */
export function normalizeIp(rawIp?: string | null): string {
  if (!rawIp) return '127.0.0.1';
  const trimmed = rawIp.trim();

  // IPv6 localhost
  if (trimmed === '::1' || trimmed === '::' || trimmed === '0:0:0:0:0:0:0:1') {
    return '127.0.0.1';
  }

  // IPv4-mapped IPv6 address (e.g. ::ffff:192.168.1.1)
  if (trimmed.startsWith('::ffff:')) {
    const candidate = trimmed.substring(7);
    if (isValidIpv4(candidate)) {
      return candidate;
    }
  }

  // Standard IPv4
  if (isValidIpv4(trimmed)) {
    return trimmed;
  }

  // Fallback an toàn cho bất kỳ định dạng nào khác
  return '127.0.0.1';
}

/**
 * Lấy IP của client từ Express Request.
 * Chỉ đọc X-Forwarded-For nếu trustProxy = true (hoặc env TRUST_PROXY === 'true').
 */
export function getClientIp(
  req: Request,
  trustProxy: boolean = process.env.TRUST_PROXY === 'true',
): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      const firstIp = forwarded.split(',')[0].trim();
      if (firstIp) {
        return normalizeIp(firstIp);
      }
    } else if (Array.isArray(forwarded) && forwarded.length > 0) {
      const firstIp = forwarded[0].split(',')[0].trim();
      if (firstIp) {
        return normalizeIp(firstIp);
      }
    }
  }

  const remote =
    req.socket?.remoteAddress ||
    req.ip ||
    (req.connection as { remoteAddress?: string } | undefined)?.remoteAddress;

  return normalizeIp(remote);
}

