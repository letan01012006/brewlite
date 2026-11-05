import crypto from 'node:crypto';

export interface VnpayConfig {
  tmnCode: string;
  hashSecret: string;
  payUrl: string;
  apiUrl: string;
  returnUrl: string;
  expireMinutes?: number;
  defaultBankCode?: string;
}

/**
 * Định dạng Date thành chuỗi 14 chữ số yyyyMMddHHmmss theo giờ Asia/Ho_Chi_Minh (+07:00).
 */
export function formatVnpDate(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}

/**
 * Phân tích chuỗi 14 chữ số yyyyMMddHHmmss (giờ Việt Nam +07:00) thành Date UTC.
 */
export function parseVnpDate(vnpDateStr?: string | null): Date | null {
  if (!vnpDateStr || !/^\d{14}$/.test(vnpDateStr)) return null;
  const year = vnpDateStr.substring(0, 4);
  const month = vnpDateStr.substring(4, 6);
  const day = vnpDateStr.substring(6, 8);
  const hour = vnpDateStr.substring(8, 10);
  const minute = vnpDateStr.substring(10, 12);
  const second = vnpDateStr.substring(12, 14);
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}+07:00`;
  const parsed = new Date(iso);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Sinh mã giao dịch duy nhất vnp_TxnRef (chỉ chứa chữ và số, độ dài 8-34 ký tự).
 * Chuẩn: BL + orderId + P + paymentId + T + timestamp (rút gọn)
 */
export function generateTxnRef(orderId: number, paymentId: number): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const raw = `BL${orderId}P${paymentId}T${timestamp}`;
  return raw.replace(/[^a-zA-Z0-9]/g, '');
}

/**
 * Mã hóa tham số cho chuỗi query string theo chuẩn VNPAY:
 * encodeURIComponent(str).replace(/%20/g, "+")
 */
export function encodeVnpParam(val: string): string {
  return encodeURIComponent(val).replace(/%20/g, '+');
}

/**
 * Xây dựng chuỗi dữ liệu ký và URL query string cho VNPAY Redirect/IPN.
 * Sắp xếp các key (trừ vnp_SecureHash, vnp_SecureHashType và giá trị rỗng/null/undefined) tăng dần theo bảng mã ASCII.
 */
export function buildVnpaySignData(params: Record<string, unknown>): {
  signData: string;
  queryString: string;
} {
  const sortedKeys = Object.keys(params)
    .filter((k) => {
      if (k === 'vnp_SecureHash' || k === 'vnp_SecureHashType') return false;
      const v = params[k];
      return v !== undefined && v !== null && String(v).trim() !== '';
    })
    .sort();

  const signParts: string[] = [];
  const queryParts: string[] = [];

  for (const key of sortedKeys) {
    const rawVal = String(params[key]);
    const encodedKey = encodeVnpParam(key);
    const encodedVal = encodeVnpParam(rawVal);
    signParts.push(`${encodedKey}=${encodedVal}`);
    queryParts.push(`${encodedKey}=${encodedVal}`);
  }

  return {
    signData: signParts.join('&'),
    queryString: queryParts.join('&'),
  };
}

/**
 * Ký dữ liệu bằng HMAC-SHA512.
 */
export function signHmacSha512(data: string, secret: string): string {
  return crypto
    .createHmac('sha512', secret)
    .update(Buffer.from(data, 'utf-8'))
    .digest('hex');
}

/**
 * Xác minh chữ ký vnp_SecureHash an toàn bằng timingSafeEqual.
 */
export function verifyVnpaySignature(
  params: Record<string, unknown>,
  secret: string,
): boolean {
  const secureHash = params['vnp_SecureHash'];
  if (!secureHash || typeof secureHash !== 'string') return false;

  const { signData } = buildVnpaySignData(params);
  const calculated = signHmacSha512(signData, secret);

  const calcBuf = Buffer.from(calculated.toLowerCase(), 'utf-8');
  const givenBuf = Buffer.from(secureHash.toLowerCase(), 'utf-8');

  if (calcBuf.length !== givenBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(calcBuf, givenBuf);
}

/**
 * Tạo URL thanh toán hoàn chỉnh có chữ ký vnp_SecureHash.
 */
export function buildPaymentUrl(
  config: VnpayConfig,
  params: {
    orderId: number;
    paymentId: number;
    amount: number;
    ipAddr: string;
    orderInfo?: string;
    createDate?: Date;
    expireDate?: Date;
    bankCode?: string;
    txnRef?: string;
  },
): { paymentUrl: string; txnRef: string; vnpCreateDate: string; expiresAt: Date } {
  const createDate = params.createDate ?? new Date();
  const expireMinutes = config.expireMinutes ?? 15;
  const expiresAt =
    params.expireDate ??
    new Date(createDate.getTime() + expireMinutes * 60 * 1000);

  const vnpCreateDate = formatVnpDate(createDate);
  const vnpExpireDate = formatVnpDate(expiresAt);
  const txnRef = params.txnRef ?? generateTxnRef(params.orderId, params.paymentId);

  const vnpParams: Record<string, string> = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: config.tmnCode,
    vnp_Amount: String(params.amount * 100),
    vnp_CreateDate: vnpCreateDate,
    vnp_CurrCode: 'VND',
    vnp_IpAddr: params.ipAddr,
    vnp_Locale: 'vn',
    vnp_OrderInfo: params.orderInfo ?? `Thanh toan don hang #${params.orderId}`,
    vnp_OrderType: 'other',
    vnp_ReturnUrl: config.returnUrl,
    vnp_TxnRef: txnRef,
    vnp_ExpireDate: vnpExpireDate,
  };

  const bankCode = params.bankCode || config.defaultBankCode;
  if (bankCode && bankCode.trim()) {
    vnpParams['vnp_BankCode'] = bankCode.trim();
  }

  const { signData, queryString } = buildVnpaySignData(vnpParams);
  const secureHash = signHmacSha512(signData, config.hashSecret);

  const separator = config.payUrl.includes('?') ? '&' : '?';
  const paymentUrl = `${config.payUrl}${separator}${queryString}&vnp_SecureHash=${secureHash}`;

  return { paymentUrl, txnRef, vnpCreateDate, expiresAt };
}

/**
 * Ký dữ liệu truy vấn giao dịch (querydr):
 * ${vnp_RequestId}|${vnp_Version}|${vnp_Command}|${vnp_TmnCode}|${vnp_TxnRef}|${vnp_TransactionDate}|${vnp_CreateDate}|${vnp_IpAddr}|${vnp_OrderInfo}
 */
export function buildQuerydrPayload(
  config: VnpayConfig,
  params: {
    requestId: string;
    txnRef: string;
    transactionDate: string; // vnpCreateDate của giao dịch gốc (14 chữ số)
    ipAddr: string;
    orderInfo?: string;
  },
) {
  const createDate = formatVnpDate(new Date());
  const orderInfo = params.orderInfo ?? `Truy van don hang ${params.txnRef}`;
  const signString = [
    params.requestId,
    '2.1.0',
    'querydr',
    config.tmnCode,
    params.txnRef,
    params.transactionDate,
    createDate,
    params.ipAddr,
    orderInfo,
  ].join('|');

  const secureHash = signHmacSha512(signString, config.hashSecret);

  return {
    vnp_RequestId: params.requestId,
    vnp_Version: '2.1.0',
    vnp_Command: 'querydr',
    vnp_TmnCode: config.tmnCode,
    vnp_TxnRef: params.txnRef,
    vnp_OrderInfo: orderInfo,
    vnp_TransactionDate: params.transactionDate,
    vnp_CreateDate: createDate,
    vnp_IpAddr: params.ipAddr,
    vnp_SecureHash: secureHash,
  };
}

/**
 * Ký dữ liệu hoàn tiền (refund):
 * ${vnp_RequestId}|${vnp_Version}|${vnp_Command}|${vnp_TmnCode}|${vnp_TransactionType}|${vnp_TxnRef}|${vnp_Amount}|${vnp_TransactionNo}|${vnp_TransactionDate}|${vnp_CreateDate}|${vnp_CreateBy}|${vnp_IpAddr}|${vnp_OrderInfo}
 */
export function buildRefundPayload(
  config: VnpayConfig,
  params: {
    requestId: string;
    txnRef: string;
    amount: number;
    transactionNo?: string;
    transactionDate: string; // vnpCreateDate của giao dịch gốc
    createBy: string;
    ipAddr: string;
    orderInfo?: string;
  },
) {
  const createDate = formatVnpDate(new Date());
  const vnpAmount = String(params.amount * 100);
  const transactionNo = params.transactionNo || '0';
  const orderInfo = params.orderInfo ?? `Hoan tien giao dich ${params.txnRef}`;

  const signString = [
    params.requestId,
    '2.1.0',
    'refund',
    config.tmnCode,
    '02', // Hoàn toàn phần
    params.txnRef,
    vnpAmount,
    transactionNo,
    params.transactionDate,
    createDate,
    params.createBy,
    params.ipAddr,
    orderInfo,
  ].join('|');

  const secureHash = signHmacSha512(signString, config.hashSecret);

  return {
    vnp_RequestId: params.requestId,
    vnp_Version: '2.1.0',
    vnp_Command: 'refund',
    vnp_TmnCode: config.tmnCode,
    vnp_TransactionType: '02',
    vnp_TxnRef: params.txnRef,
    vnp_Amount: vnpAmount,
    vnp_OrderInfo: orderInfo,
    vnp_TransactionNo: transactionNo,
    vnp_TransactionDate: params.transactionDate,
    vnp_CreateDate: createDate,
    vnp_CreateBy: params.createBy,
    vnp_IpAddr: params.ipAddr,
    vnp_SecureHash: secureHash,
  };
}

/**
 * Lọc sạch payload VNPAY trước khi ghi vào PaymentWebhookLog:
 * - Loại bỏ vnp_SecureHash, vnp_SecureHashType
 * - Chỉ cho phép các trường nghiệp vụ hợp lệ
 */
export function sanitizeVnpayPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const ALLOWED_KEYS = new Set([
    'vnp_TmnCode',
    'vnp_Amount',
    'vnp_BankCode',
    'vnp_BankTranNo',
    'vnp_CardType',
    'vnp_PayDate',
    'vnp_OrderInfo',
    'vnp_TransactionNo',
    'vnp_ResponseCode',
    'vnp_TransactionStatus',
    'vnp_TxnRef',
    'vnp_CreateDate',
    'vnp_Command',
    'vnp_Version',
    'vnp_CurrCode',
    'vnp_Locale',
    'vnp_OrderType',
    'vnp_IpAddr',
    'vnp_Message',
  ]);

  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (ALLOWED_KEYS.has(k) && v !== undefined && v !== null) {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

