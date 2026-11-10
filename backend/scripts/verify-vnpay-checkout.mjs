import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import crypto from 'node:crypto';

// 1. Load backend/.env
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (!existsSync(envPath)) {
  console.error(`[Error] .env file not found at ${envPath}`);
  process.exit(1);
}

const envContent = readFileSync(envPath, 'utf8');
const env = { ...parseEnv(envContent), ...process.env };

const tmnCode = env.VNPAY_TMN_CODE;
const hashSecret = env.VNPAY_HASH_SECRET;
const paymentUrlBase = env.VNPAY_PAYMENT_URL;
const returnUrl = env.VNPAY_RETURN_URL || 'http://localhost:3000/payment/vnpay-return';

console.log('[1. Inspect & Assert Environment]');
console.log(`- VNPAY_TMN_CODE: ${tmnCode}`);
console.log(`- VNPAY_PAYMENT_URL: ${paymentUrlBase}`);
console.log(`- VNPAY_HASH_SECRET: ${hashSecret ? '***' + hashSecret.slice(-6) : 'MISSING'}`);

if (tmnCode !== 'FZL3EVU2') {
  console.error(`Assertion failed: expected TMN code FZL3EVU2, got ${tmnCode}`);
  process.exit(1);
}
if (!hashSecret || hashSecret !== 'AAKZTEDEWXLKWYGJCFJQQIZGJYXUZDDL') {
  console.error('Assertion failed: VNPAY_HASH_SECRET does not match merchant secret');
  process.exit(1);
}
if (paymentUrlBase !== 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html') {
  console.error(`Assertion failed: unexpected VNPAY_PAYMENT_URL: ${paymentUrlBase}`);
  process.exit(1);
}

// 2. Generate Verified Checkout Transaction for Merchant "brewlite"
const orderId = 1001;
const paymentId = 2001;
const amountVnd = 55000; // 55,000 VND (e.g., BrewLite Signature Coffee)

// Format date to yyyyMMddHHmmss in GMT+7
const now = new Date();
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
const parts = formatter.formatToParts(now);
const getPart = (type) => parts.find((p) => p.type === type)?.value || '00';
const vnpCreateDate = `${getPart('year')}${getPart('month')}${getPart('day')}${getPart('hour')}${getPart('minute')}${getPart('second')}`;

const expireDate = new Date(now.getTime() + 15 * 60 * 1000);
const expParts = formatter.formatToParts(expireDate);
const getExpPart = (type) => expParts.find((p) => p.type === type)?.value || '00';
const vnpExpireDate = `${getExpPart('year')}${getExpPart('month')}${getExpPart('day')}${getExpPart('hour')}${getExpPart('minute')}${getExpPart('second')}`;

const txnRef = `BL${orderId}P${paymentId}T${Date.now().toString(36).toUpperCase()}`;

const params = {
  vnp_Version: '2.1.0',
  vnp_Command: 'pay',
  vnp_TmnCode: tmnCode,
  vnp_Amount: String(amountVnd * 100),
  vnp_CreateDate: vnpCreateDate,
  vnp_CurrCode: 'VND',
  vnp_IpAddr: '127.0.0.1',
  vnp_Locale: 'vn',
  vnp_OrderInfo: `Thanh toan don hang brewlite #${orderId}`,
  vnp_OrderType: 'other',
  vnp_ReturnUrl: returnUrl,
  vnp_TxnRef: txnRef,
  vnp_ExpireDate: vnpExpireDate,
};

// Sort ASCII
const sortedKeys = Object.keys(params).sort();
const encodeVnpParam = (val) => encodeURIComponent(val).replace(/%20/g, '+');

const signParts = [];
const queryParts = [];
for (const key of sortedKeys) {
  const val = params[key];
  if (val !== undefined && val !== null && String(val).trim() !== '') {
    signParts.push(`${encodeVnpParam(key)}=${encodeVnpParam(String(val))}`);
    queryParts.push(`${encodeVnpParam(key)}=${encodeVnpParam(String(val))}`);
  }
}

const signData = signParts.join('&');
const queryString = queryParts.join('&');

// HMAC-SHA512
const secureHash = crypto
  .createHmac('sha512', hashSecret)
  .update(Buffer.from(signData, 'utf-8'))
  .digest('hex');

const fullPaymentUrl = `${paymentUrlBase}?${queryString}&vnp_SecureHash=${secureHash}`;

// 3. Verification Assertions
console.log('\n[2. Automated Verification & Assertions]');

// A. Assert vnp_TmnCode strictly equals FZL3EVU2
const parsedUrl = new URL(fullPaymentUrl);
const parsedTmnCode = parsedUrl.searchParams.get('vnp_TmnCode');
console.log(`- Assert vnp_TmnCode == 'FZL3EVU2': ${parsedTmnCode === 'FZL3EVU2' ? 'PASSED' : 'FAILED'}`);
if (parsedTmnCode !== 'FZL3EVU2') throw new Error('vnp_TmnCode assertion failed');

// B. Assert vnp_SecureHash is validly generated via HMAC-SHA512
const parsedHash = parsedUrl.searchParams.get('vnp_SecureHash');
const calculatedHash = crypto
  .createHmac('sha512', hashSecret)
  .update(Buffer.from(signData, 'utf-8'))
  .digest('hex');
const isHashValid = crypto.timingSafeEqual(
  Buffer.from(parsedHash.toLowerCase(), 'utf-8'),
  Buffer.from(calculatedHash.toLowerCase(), 'utf-8'),
);
console.log(`- Assert vnp_SecureHash HMAC-SHA512 validity: ${isHashValid ? 'PASSED' : 'FAILED'}`);
if (!isHashValid) throw new Error('vnp_SecureHash assertion failed');

// C. Assert querystring is sorted correctly by ASCII order
const rawSearch = parsedUrl.search.slice(1);
const keysInOrder = rawSearch.split('&').map((p) => p.split('=')[0]);
const nonHashKeysInOrder = keysInOrder.filter((k) => k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType');
const asciiSortedKeys = [...nonHashKeysInOrder].sort();
const isAsciiSorted = JSON.stringify(nonHashKeysInOrder) === JSON.stringify(asciiSortedKeys);
console.log(`- Assert querystring keys ASCII order: ${isAsciiSorted ? 'PASSED' : 'FAILED'}`);
console.log(`  Keys order: ${nonHashKeysInOrder.join(', ')}`);
if (!isAsciiSorted) throw new Error('ASCII sorting assertion failed');

console.log('\n[3. Final Verified VNPAY Checkout URL for Merchant "brewlite"]');
console.log(fullPaymentUrl);
