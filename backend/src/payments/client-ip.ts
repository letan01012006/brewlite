import { Request } from 'express';

/**
 * Trích xuất và chuẩn hóa địa chỉ IP của khách hàng từ Request.
 * VNPAY yêu cầu định dạng IPv4 (ví dụ 127.0.0.1).
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  let ip = '';

  if (forwarded) {
    ip = Array.isArray(forwarded)
      ? forwarded[0]
      : forwarded.split(',')[0].trim();
  } else {
    ip = req.socket?.remoteAddress || req.ip || '127.0.0.1';
  }

  // Chuẩn hóa địa chỉ localhost IPv6 thành IPv4
  if (ip === '::1' || ip === '::ffff:127.0.0.1') {
    return '127.0.0.1';
  }

  // Bỏ tiền tố IPv6 nếu có (ví dụ ::ffff:192.168.1.1)
  if (ip.startsWith('::ffff:')) {
    return ip.replace('::ffff:', '');
  }

  return ip || '127.0.0.1';
}