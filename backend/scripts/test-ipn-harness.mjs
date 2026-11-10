import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import crypto from 'node:crypto';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

// ---------------------------------------------------------
// 1. Load & Assert Environment
// ---------------------------------------------------------
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (!existsSync(envPath)) {
  console.error(`[FATAL] .env not found at ${envPath}`);
  process.exit(1);
}
const env = { ...parseEnv(readFileSync(envPath, 'utf8')), ...process.env };

const TMN_CODE = env.VNPAY_TMN_CODE;
const HASH_SECRET = env.VNPAY_HASH_SECRET;
const PAYMENT_URL = env.VNPAY_PAYMENT_URL;
const DATABASE_URL = env.DATABASE_URL || 'postgresql://brewlite:brewlite@localhost:5432/brewlite';
const JWT_SECRET = env.JWT_SECRET || 'change-me';
const BACKEND_BASE = 'http://127.0.0.1:4000';

console.log('=== [Stage 1: Environment & Connectivity Check] ===');
console.log(`- VNPAY_TMN_CODE: ${TMN_CODE}`);
console.log(`- VNPAY_HASH_SECRET: ${HASH_SECRET ? '***' + HASH_SECRET.slice(-6) : 'MISSING'}`);
console.log(`- VNPAY_PAYMENT_URL: ${PAYMENT_URL}`);

if (TMN_CODE !== 'FZL3EVU2') throw new Error(`Assertion failed: expected TMN code FZL3EVU2, got ${TMN_CODE}`);
if (HASH_SECRET !== 'AAKZTEDEWXLKWYGJCFJQQIZGJYXUZDDL') throw new Error('Assertion failed: invalid HASH_SECRET');
if (PAYMENT_URL !== 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html') throw new Error('Assertion failed: invalid PAYMENT_URL');

// Assert backend health
const healthRes = await fetch(`${BACKEND_BASE}/api/health`);
if (!healthRes.ok) throw new Error(`Backend /api/health returned HTTP ${healthRes.status}`);
const healthData = await healthRes.json();
console.log('- Backend Health:', healthData);
if (healthData.status !== 'ok' || healthData.db !== 'up') throw new Error('Backend DB not reported up');

// ---------------------------------------------------------
// 2. Database Setup via Prisma
// ---------------------------------------------------------
console.log('\n=== [Stage 2: Deterministic IPN & Loyalty Test Harness] ===');
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

function signParams(params, secret) {
  const sortedKeys = Object.keys(params)
    .filter((k) => k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType' && params[k] !== undefined && params[k] !== null && String(params[k]).trim() !== '')
    .sort();
  const encodeVal = (v) => encodeURIComponent(String(v)).replace(/%20/g, '+');
  const signData = sortedKeys.map((k) => `${encodeVal(k)}=${encodeVal(params[k])}`).join('&');
  const secureHash = crypto.createHmac('sha512', secret).update(Buffer.from(signData, 'utf-8')).digest('hex');
  const queryString = sortedKeys.map((k) => `${encodeVal(k)}=${encodeVal(params[k])}`).join('&') + `&vnp_SecureHash=${secureHash}`;
  return { signData, secureHash, queryString };
}

function createJwt(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + 3600 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

try {
  // Query demo user
  const user = await prisma.user.findFirst({ where: { email: 'demo@brewlite.com' } });
  if (!user) throw new Error('User demo@brewlite.com not found in database');
  const baselinePoints = user.loyaltyPoints;
  console.log(`- Demo User ID: ${user.id}, Baseline Points: ${baselinePoints}`);

  // Find or create product
  let product = await prisma.product.findFirst({ where: { isActive: true } });
  if (!product) {
    product = await prisma.product.create({
      data: {
        name: 'Cà phê Sữa Đá BrewLite',
        basePrice: 55000,
        category: 'COFFEE',
        isActive: true,
      },
    });
  }

  // Find or create Barista user for fulfillment
  let barista = await prisma.user.findFirst({ where: { role: 'BARISTA' } });
  if (!barista) {
    barista = await prisma.user.create({
      data: {
        email: 'barista-test@brewlite.com',
        fullName: 'Barista Tester',
        passwordHash: 'hashed',
        role: 'BARISTA',
        isPhoneVerified: true,
        loyaltyPoints: 0,
      },
    });
  }
  const baristaToken = createJwt({ sub: barista.id, email: barista.email, role: 'BARISTA' }, JWT_SECRET);

  // Create real test Order and Payment in DB (total 55,000 VND)
  const orderAmount = 55000;
  const testOrder = await prisma.order.create({
    data: {
      userId: user.id,
      subtotal: orderAmount,
      total: orderAmount,
      discountAmount: 0,
      status: 'PENDING',
      items: {
        create: {
          productId: product.id,
          productName: product.name,
          size: 'M',
          unitPrice: orderAmount,
          qty: 1,
          lineTotal: orderAmount,
          toppings: [],
        },
      },
    },
  });

  const txnRef = `BL${testOrder.id}P${Date.now()}SIT`;
  const testPayment = await prisma.payment.create({
    data: {
      orderId: testOrder.id,
      amount: orderAmount,
      method: 'VNPAY',
      status: 'PROCESSING',
      idempotencyKey: `harness-idem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      requestHash: crypto.createHash('sha256').update(`order-${testOrder.id}`).digest('hex'),
      gatewayTxnRef: txnRef,
    },
  });

  console.log(`- Created Test Order #${testOrder.id} (status: PENDING, total: ${orderAmount} VND)`);
  console.log(`- Created Test Payment #${testPayment.id} (status: PROCESSING, gatewayTxnRef: ${txnRef})`);

  // Base payload parameters for IPN
  const nowStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date()).reduce((acc, p) => p.type !== 'literal' ? acc + p.value : acc, '');

  const baseIpnParams = {
    vnp_Amount: String(orderAmount * 100),
    vnp_BankCode: 'NCB',
    vnp_CardType: 'ATM',
    vnp_Command: 'pay',
    vnp_CreateDate: nowStr,
    vnp_CurrCode: 'VND',
    vnp_IpAddr: '127.0.0.1',
    vnp_Locale: 'vn',
    vnp_OrderInfo: `Thanh toan don hang #${testOrder.id}`,
    vnp_OrderType: 'other',
    vnp_PayDate: nowStr,
    vnp_ResponseCode: '00',
    vnp_TmnCode: TMN_CODE,
    vnp_TransactionNo: '14829304',
    vnp_TransactionStatus: '00',
    vnp_TxnRef: txnRef,
    vnp_Version: '2.1.0',
  };

  // -------------------------------------------------------
  // Case 1 (Valid Success)
  // -------------------------------------------------------
  console.log('\n--- [Case 1: Valid Success IPN] ---');
  const { queryString: case1Query } = signParams(baseIpnParams, HASH_SECRET);
  const res1 = await fetch(`${BACKEND_BASE}/api/payments/vnpay/ipn?${case1Query}`);
  const data1 = await res1.json();
  console.log('Case 1 Response:', data1);
  if (data1.RspCode !== '00' || data1.Message !== 'Confirm Success') {
    throw new Error(`Case 1 failed: Expected {"RspCode":"00","Message":"Confirm Success"}, got ${JSON.stringify(data1)}`);
  }

  // Assert DB states
  const paymentAfter1 = await prisma.payment.findUniqueOrThrow({ where: { id: testPayment.id } });
  const orderAfter1 = await prisma.order.findUniqueOrThrow({ where: { id: testOrder.id } });
  console.log(`- DB Payment.status: ${paymentAfter1.status} (expected: SUCCESS)`);
  console.log(`- DB Order.status: ${orderAfter1.status} (expected: PAID or READY)`);
  if (paymentAfter1.status !== 'SUCCESS') throw new Error(`Case 1 DB assertion failed: Payment.status=${paymentAfter1.status}`);
  if (orderAfter1.status !== 'PAID' && orderAfter1.status !== 'READY') {
    throw new Error(`Case 1 DB assertion failed: Order.status=${orderAfter1.status}`);
  }
  console.log('✓ Case 1 Passed');

  // -------------------------------------------------------
  // Case 2 (Tampered Signature)
  // -------------------------------------------------------
  console.log('\n--- [Case 2: Tampered Signature] ---');
  const case2Query = `${signParams(baseIpnParams, HASH_SECRET).signData}&vnp_SecureHash=CORRUPTED_HASH_INVALID_CHECKSUM_1234567890`;
  const res2 = await fetch(`${BACKEND_BASE}/api/payments/vnpay/ipn?${case2Query}`);
  const data2 = await res2.json();
  console.log('Case 2 Response:', data2);
  if (data2.RspCode !== '97' || data2.Message !== 'Invalid Checksum') {
    throw new Error(`Case 2 failed: Expected {"RspCode":"97","Message":"Invalid Checksum"}, got ${JSON.stringify(data2)}`);
  }
  console.log('✓ Case 2 Passed');

  // -------------------------------------------------------
  // Case 3 (Non-existent Order)
  // -------------------------------------------------------
  console.log('\n--- [Case 3: Non-existent Order] ---');
  const unknownParams = { ...baseIpnParams, vnp_TxnRef: 'UNKNOWN_REF_999999999' };
  const { queryString: case3Query } = signParams(unknownParams, HASH_SECRET);
  const res3 = await fetch(`${BACKEND_BASE}/api/payments/vnpay/ipn?${case3Query}`);
  const data3 = await res3.json();
  console.log('Case 3 Response:', data3);
  if (data3.RspCode !== '01' || data3.Message !== 'Order not found') {
    throw new Error(`Case 3 failed: Expected {"RspCode":"01","Message":"Order not found"}, got ${JSON.stringify(data3)}`);
  }
  console.log('✓ Case 3 Passed');

  // -------------------------------------------------------
  // Case 4 (Duplicate IPN)
  // -------------------------------------------------------
  console.log('\n--- [Case 4: Duplicate IPN] ---');
  const res4 = await fetch(`${BACKEND_BASE}/api/payments/vnpay/ipn?${case1Query}`);
  const data4 = await res4.json();
  console.log('Case 4 Response:', data4);
  if (data4.RspCode !== '02' || data4.Message !== 'Order already confirmed') {
    throw new Error(`Case 4 failed: Expected {"RspCode":"02","Message":"Order already confirmed"}, got ${JSON.stringify(data4)}`);
  }
  console.log('✓ Case 4 Passed');

  // -------------------------------------------------------
  // Step 3: Verify Loyalty Points Crediting
  // -------------------------------------------------------
  console.log('\n--- [Step 3: Fulfillment & Loyalty Points Verification] ---');
  // Transition order: PAID -> PREPARING -> READY -> COMPLETED via Barista PATCH endpoint
  const prepRes = await fetch(`${BACKEND_BASE}/api/orders/${testOrder.id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${baristaToken}`,
    },
    body: JSON.stringify({ status: 'PREPARING' }),
  });
  if (!prepRes.ok) {
    const errText = await prepRes.text();
    console.warn(`PREPARING transition failed: ${errText}`);
  }

  const readyRes = await fetch(`${BACKEND_BASE}/api/orders/${testOrder.id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${baristaToken}`,
    },
    body: JSON.stringify({ status: 'READY' }),
  });
  if (!readyRes.ok) {
    const errText = await readyRes.text();
    console.warn(`READY transition failed: ${errText}`);
  }

  const completeRes = await fetch(`${BACKEND_BASE}/api/orders/${testOrder.id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${baristaToken}`,
    },
    body: JSON.stringify({ status: 'COMPLETED' }),
  });
  if (!completeRes.ok) {
    const errText = await completeRes.text();
    console.warn(`COMPLETED transition via API returned: ${errText}`);
  }

  // Assert in Database
  const orderFinal = await prisma.order.findUniqueOrThrow({ where: { id: testOrder.id } });
  const earnTx = await prisma.loyaltyTransaction.findFirst({
    where: { orderId: testOrder.id, type: 'EARN' },
  });
  const userFinal = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

  console.log(`- Final Order Status: ${orderFinal.status}`);
  console.log(`- Order.pointsEarned: ${orderFinal.pointsEarned} (expected: 55)`);
  console.log(`- LoyaltyTransaction EARN:`, earnTx ? { id: earnTx.id, points: earnTx.points, type: earnTx.type } : 'NONE');
  console.log(`- User.loyaltyPoints: baseline=${baselinePoints} -> new=${userFinal.loyaltyPoints} (diff: +${userFinal.loyaltyPoints - baselinePoints})`);

  if (orderFinal.pointsEarned !== 55) throw new Error(`Assertion failed: Order.pointsEarned=${orderFinal.pointsEarned}, expected 55`);
  if (!earnTx || earnTx.points !== 55) throw new Error('Assertion failed: LoyaltyTransaction EARN missing or invalid');
  if (userFinal.loyaltyPoints !== baselinePoints + 55) {
    throw new Error(`Assertion failed: User points increment expected 55, got ${userFinal.loyaltyPoints - baselinePoints}`);
  }

  console.log('✓ Step 3 Loyalty Points Verification Passed!');
  console.log('\n=== ALL IPN & LOYALTY HARNESS ASSERTIONS PASSED (100%) ===');

} finally {
  await prisma.$disconnect();
}
