import * as crypto from 'crypto';

/**
 * Sắp xếp các tham số theo bảng chữ cái ASCII tăng dần theo chuẩn VNPAY.
 */
export function sortObject(obj: Record<string, any>): Record<string, string> {
  const sorted: Record<string, string> = {};
  const keys = Object.keys(obj).sort();

  for (const key of keys) {
    if (
      obj[key] !== null &&
      obj[key] !== undefined &&
      obj[key] !== ''
    ) {
      // Mã hóa ký tự đặc biệt theo chuẩn URL
      sorted[key] = encodeURIComponent(String(obj[key])).replace(/%20/g, '+');
    }
  }

  return sorted;
}

/**
 * Định dạng Date thành chuỗi `YYYYMMDDHHmmss` theo múi giờ Việt Nam (GMT+7).
 */
export function formatVnpayDate(date: Date = new Date()): string {
  // Bù giờ Việt Nam (UTC+7)
  const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const year = vnTime.getUTCFullYear();
  const month = String(vnTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(vnTime.getUTCDate()).padStart(2, '0');
  const hours = String(vnTime.getUTCHours()).padStart(2, '0');
  const minutes = String(vnTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(vnTime.getUTCSeconds()).padStart(2, '0');

  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

/**
 * Tạo chữ ký số HMAC-SHA512 từ danh sách tham số và HashSecret của VNPAY.
 */
export function signParams(
  params: Record<string, any>,
  secretKey: string,
): string {
  const sorted = sortObject(params);
  const signData = Object.entries(sorted)
    .map(([key, val]) => `${key}=${val}`)
    .join('&');

  const hmac = crypto.createHmac('sha512', secretKey);
  return hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
}

/**
 * Xác thực chữ ký số từ IPN hoặc Return URL do VNPAY gửi về.
 */
export function verifySecureHash(
  query: Record<string, any>,
  secretKey: string,
): boolean {
  const vnpSecureHash = query['vnp_SecureHash'];
  if (!vnpSecureHash) return false;

  // Lọc bỏ tham số chữ ký trước khi hash lại dữ liệu
  const cleanParams: Record<string, any> = {};
  for (const [key, value] of Object.entries(query)) {
    if (key !== 'vnp_SecureHash' && key !== 'vnp_SecureHashType') {
      cleanParams[key] = value;
    }
  }

  const calculatedHash = signParams(cleanParams, secretKey);
  return (
    calculatedHash.toLowerCase() === String(vnpSecureHash).toLowerCase()
  );
}