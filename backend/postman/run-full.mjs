import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from '../node_modules/pg/lib/index.js';

// An isolated integration run of the real API with Postman's official CLI.
// OTP delivery and the external VNPAY bank are simulated, explicitly and locally.
// Application services, guards, validation, signatures, IPN, DB and refunds are real.
const postman = dirname(fileURLToPath(import.meta.url));
const backend = resolve(postman, '..');
const root = resolve(backend, '..');
const source = parseEnv(readFileSync(resolve(backend, '.env'), 'utf8'));
const runId = new Date().toISOString().replace(/[^0-9]/g, '') + '_' + randomBytes(2).toString('hex');
const databaseName = 'brewlite_postman_' + runId;
const runDir = resolve(root, '.local-backups/postman-runs', runId);
const apiPort = Number(process.env.POSTMAN_API_PORT || 4010);
const gatewayPort = Number(process.env.POSTMAN_GATEWAY_PORT || 4011);
const apiUrl = `http://127.0.0.1:${apiPort}/api`;
const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
const gatewaySecret = randomBytes(32).toString('hex');
const merchant = 'POSTMANLOCAL';
const databaseUrl = new URL(source.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname), 'Full run requires a local PostgreSQL server.');
assert.match(databaseName, /^brewlite_postman_[a-z0-9_]+$/);
assert.ok(existsSync(resolve(backend, 'dist/main.js')), 'Build backend first: cd backend; npm.cmd run build');
mkdirSync(runDir, { recursive: true });
const localEnv = {
  ...process.env, ...source,
  NODE_ENV: 'test', PORT: String(apiPort),
  JWT_SECRET: randomBytes(32).toString('hex'),
  OTP_HASH_SECRET: randomBytes(32).toString('hex'),
  SMS_PROVIDER: 'local', AUTH_OTP_DEMO: 'true',
  ESMS_API_KEY: '', ESMS_SECRET_KEY: '',
  AUTH_DEMO_SEED: 'true', DEMO_MANAGER_PHONE: '0900000001', DEMO_MANAGER_PASSWORD: 'Manager@123',
  PAYMENT_MOCK_ENABLED: 'true',
  VNPAY_TMN_CODE: merchant, VNPAY_HASH_SECRET: gatewaySecret,
  VNPAY_PAY_URL: `${gatewayUrl}/pay`, VNPAY_API_URL: `${gatewayUrl}/transaction`,
  VNPAY_RETURN_URL: `${apiUrl}/payments/vnpay/return`,
};
databaseUrl.pathname = '/' + databaseName;
databaseUrl.search = '';
localEnv.DATABASE_URL = databaseUrl.toString();
const children = new Set();
function command(executable, args, { cwd = root, env = localEnv, log = true } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      output += chunk;
      if (log) process.stdout.write(chunk);
    });
    child.on('error', reject);
    child.on('close', code => { children.delete(child); resolveResult({ code, output }); });
  });
}
const hmac = text => createHmac('sha512', gatewaySecret).update(text, 'utf8').digest('hex');
const encode = text => encodeURIComponent(text).replace(/%20/g, '+');
function signParams(params) {
  return hmac(Object.keys(params).filter(k => !['vnp_SecureHash', 'vnp_SecureHashType'].includes(k) && params[k] !== '').sort()
    .map(k => `${encode(k)}=${encode(String(params[k]))}`).join('&'));
}
function signatureEquals(actual, expected) {
  return typeof actual === 'string' && actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
const transactions = new Map();
const simulator = { paymentUrlsVerified: 0, invalidIpnsRejected: 0, successfulIpns: 0, duplicateIpnsRejected: 0, refundsVerified: 0 };
const sendJson = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const gateway = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, gatewayUrl);
    if (req.method === 'GET' && url.pathname === '/pay') {
      const payment = Object.fromEntries(url.searchParams);
      assert.equal(payment.vnp_TmnCode, merchant);
      assert.ok(signatureEquals(payment.vnp_SecureHash, signParams(payment)), 'Invalid payment URL signature');
      simulator.paymentUrlsVerified++;
      const callback = {
        vnp_TmnCode: merchant, vnp_TxnRef: payment.vnp_TxnRef, vnp_Amount: payment.vnp_Amount,
        vnp_OrderInfo: payment.vnp_OrderInfo, vnp_BankCode: 'POSTMAN', vnp_CardType: 'ATM',
        vnp_TransactionNo: 'LOCAL' + randomBytes(6).toString('hex'),
        vnp_PayDate: payment.vnp_CreateDate, vnp_ResponseCode: '00', vnp_TransactionStatus: '00',
      };
      const ipn = async params => {
        const response = await fetch(`${apiUrl}/payments/vnpay/ipn?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(15000) });
        assert.equal(response.status, 200);
        return response.json();
      };
      const invalid = await ipn({ ...callback, vnp_SecureHash: '0'.repeat(128) });
      assert.equal(invalid.RspCode, '97', 'API must reject an invalid IPN signature');
      simulator.invalidIpnsRejected++;
      const signed = { ...callback, vnp_SecureHash: signParams(callback) };
      const paid = await ipn(signed);
      assert.equal(paid.RspCode, '00');
      simulator.successfulIpns++;
      const duplicate = await ipn(signed);
      assert.equal(duplicate.RspCode, '02', 'Duplicate callback must not pay twice');
      simulator.duplicateIpnsRejected++;
      transactions.set(callback.vnp_TxnRef, callback);
      sendJson(res, 200, { mode: 'LOCAL_SIMULATOR', status: 'SUCCESS', invalidSignatureRejected: true, duplicateRejected: true });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/transaction') {
      let raw = '';
      for await (const chunk of req) { raw += chunk; assert.ok(raw.length < 32768); }
      const body = JSON.parse(raw);
      assert.equal(body.vnp_TmnCode, merchant);
      const fields = body.vnp_Command === 'refund'
        ? ['RequestId', 'Version', 'Command', 'TmnCode', 'TransactionType', 'TxnRef', 'Amount', 'TransactionNo', 'TransactionDate', 'CreateDate', 'CreateBy', 'IpAddr', 'OrderInfo']
        : ['RequestId', 'Version', 'Command', 'TmnCode', 'TxnRef', 'TransactionDate', 'CreateDate', 'IpAddr', 'OrderInfo'];
      assert.ok(signatureEquals(body.vnp_SecureHash, hmac(fields.map(k => body['vnp_' + k]).join('|'))), 'Invalid B2B request signature');
      const transaction = transactions.get(body.vnp_TxnRef);
      assert.ok(transaction, 'Transaction must have a successful signed IPN');
      if (body.vnp_Command === 'refund') {
        assert.equal(String(body.vnp_Amount), transaction.vnp_Amount);
        assert.equal(body.vnp_TransactionNo, transaction.vnp_TransactionNo);
        simulator.refundsVerified++;
      }
      sendJson(res, 200, { vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TransactionType: body.vnp_Command === 'refund' ? '02' : '01',
        vnp_TransactionNo: body.vnp_Command === 'refund' ? 'REFUNDLOCAL' + randomBytes(4).toString('hex') : transaction.vnp_TransactionNo,
        vnp_Amount: transaction.vnp_Amount, vnp_Message: 'Local simulator success' });
      return;
    }
    sendJson(res, 404, { error: 'Unknown simulator route' });
  } catch (error) { sendJson(res, 400, { error: error.message }); }
});

let api;
async function cleanup() {
  for (const child of children) child.kill();
  api?.kill();
  await new Promise(done => gateway.close(done));
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });
try {
  console.log(`Preparing isolated database ${databaseName}`);
  const admin = new pg.Client({ connectionString: source.DATABASE_URL });
  await admin.connect();
  try { await admin.query(`CREATE DATABASE "${databaseName}"`); } finally { await admin.end(); }
  const migrate = await command(process.execPath, [resolve(backend, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd: backend, log: false });
  writeFileSync(resolve(runDir, 'migrations.log'), migrate.output);
  assert.equal(migrate.code, 0, 'Migration failed; see migrations.log in ' + runDir);
  const seed = await command(process.execPath, [resolve(backend, 'node_modules/tsx/dist/cli.mjs'), 'prisma/seed.ts'], { cwd: backend, log: false });
  writeFileSync(resolve(runDir, 'seed.log'), seed.output);
  assert.equal(seed.code, 0, 'Seed failed; see seed.log in ' + runDir);
  await new Promise((done, reject) => { gateway.once('error', reject); gateway.listen(gatewayPort, '127.0.0.1', done); });
  api = spawn(process.execPath, ['dist/main.js'], { cwd: backend, env: localEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let apiLogs = '';
  for (const stream of [api.stdout, api.stderr]) stream.on('data', chunk => { apiLogs += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (api.exitCode !== null) throw new Error('Test API failed to start: ' + apiLogs);
    try { const res = await fetch(apiUrl + '/health', { signal: AbortSignal.timeout(1000) }); if (res.ok) { ready = true; break; } } catch {}
    await new Promise(done => setTimeout(done, 500));
  }
  assert.ok(ready, 'Test API did not become ready');
  api.on('close', () => writeFileSync(resolve(runDir, 'backend.log'), apiLogs));
  const collection = JSON.parse(readFileSync(resolve(postman, 'BrewLite.postman_collection.json'), 'utf8'));
  const environment = JSON.parse(readFileSync(resolve(postman, 'BrewLite-Local.postman_environment.json'), 'utf8'));
  collection.info.name = 'BrewLite API - Full local run';
  collection.info._postman_id = randomUUID();
  collection.info.description = 'All 65 requests against an isolated local database. OTP delivery and VNPAY bank are simulated; real BrewLite API, signatures, IPN, refund and guards are exercised. Start with node backend/postman/run-full.mjs --serve from the repository root before running this collection in the desktop app.';
  environment.name = 'BrewLite Full local run';
  const overrides = { base_url: apiUrl, register_phone: '0900000002', register_password: 'Postman@123', otp_code: '123456',
    manager_phone: '0900000001', manager_password: 'Manager@123', staff_phone: '0900000003', staff_password: 'Barista@123' };
  for (const [key, value] of Object.entries(overrides)) {
    collection.variable.find(v => v.key === key).value = value;
    environment.values.find(v => v.key === key).value = value;
  }
  const auth = collection.item.find(f => f.name.startsWith('06'));
  const [register, verify, resend, ...rest] = auth.item;
  auth.item = [register, resend, verify, ...rest];
  auth.name = '06 Auth phone + Manager - automated local';
  auth.description = 'Register, wait 61 seconds, resend OTP, verify and login; then Manager creates a verified Barista. Local SMS simulator only.';
  resend.event.unshift({ listen: 'prerequest', script: { type: 'text/javascript', exec: ["console.log('Waiting 61 seconds for the real OTP resend cooldown...');", 'setTimeout(function () {}, 61000);'] } });
  const appendScript = (item, listen, sourceCode) => {
    const script = item.event.find(e => e.listen === listen).script.exec;
    script.splice(script.length - 1, 0, ...sourceCode.split('\n'));
  };
  register.event.unshift({ listen: 'prerequest', script: { type: 'text/javascript', exec: [
    "const vars = pm.environment.get('base_url') ? pm.environment : pm.collectionVariables;",
    "vars.set('register_phone', '09' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0'));",
  ] } });
  const staff = rest.find(r => r.name.includes('Manager creates'));
  staff.event.unshift({ listen: 'prerequest', script: { type: 'text/javascript', exec: [
    "const vars = pm.environment.get('base_url') ? pm.environment : pm.collectionVariables;",
    "vars.set('staff_phone', '09' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0'));",
  ] } });
  for (const [index, item] of auth.item.entries()) item.name = String(index + 1).padStart(2, '0') + item.name.slice(2);
  appendScript(collection.item[0].item[1], 'prerequest', "['vnpay_order_id','vnpay_payment_id','vnpay_order_key','vnpay_payment_key','vnpay_payment_url'].forEach(key => vars.unset(key));");
  const vnpay = collection.item.find(f => f.name.startsWith('08'));
  vnpay.name = '08 VNPAY + refund - local bank simulator';
  vnpay.description = 'Real payment URL signing, invalid/successful/duplicate IPN verification and signed B2B refund against an explicit local bank simulator.';
  vnpay.item[1].name = '02 Create VNPAY URL and settle via LOCAL SIMULATOR';
  appendScript(vnpay.item[1], 'test', `if (pm.response.code === 201) {
    const payment = pm.response.json().payment;
    pm.test('VNPAY bank simulator is local', () => pm.expect(payment.paymentUrl).to.match(/^http:\\/\\/127\\.0\\.0\\.1:${gatewayPort}\\/pay\\?/));
    pm.sendRequest({url: payment.paymentUrl, method: 'GET'}, (err, response) => {
      pm.test('Signed IPN settlement and duplicate rejection', () => {
        pm.expect(err).to.eql(null);
        pm.expect(response.code).to.eql(200);
        const settled = response.json();
        pm.expect(settled.mode).to.eql('LOCAL_SIMULATOR');
        pm.expect(settled.status).to.eql('SUCCESS');
        pm.expect(settled.invalidSignatureRejected).to.eql(true);
        pm.expect(settled.duplicateRejected).to.eql(true);
      });
    });
  }`);
  appendScript(vnpay.item[2], 'test', "pm.test('VNPAY payment settled', () => pm.expect(pm.response.json().status).to.eql('SUCCESS'));");
  appendScript(vnpay.item[3], 'test', "pm.test('VNPAY refund confirmed', () => { const result = pm.response.json(); pm.expect(result.refund.status).to.eql('SUCCESS'); pm.expect(result.payment.refundedAmount).to.eql(result.payment.amount); });");
  const requestCount = collection.item.reduce((total, folder) => total + folder.item.length, 0);
  assert.equal(requestCount, 65);
  const collectionPath = resolve(runDir, 'BrewLite-Full.postman_collection.json');
  const environmentPath = resolve(runDir, 'BrewLite-Full.postman_environment.json');
  writeFileSync(collectionPath, JSON.stringify(collection, null, 2) + '\n');
  writeFileSync(environmentPath, JSON.stringify(environment, null, 2) + '\n');
  console.log(`Test API ready: ${apiUrl}. Collection: ${collectionPath}`);
  if (process.argv.includes('--serve')) {
    console.log(`Import both JSON files from ${runDir}, select BrewLite Full local run, and run the whole collection. Ctrl+C stops the test services.`);
    await new Promise(() => {});
  }
  console.log('Running all 65 requests with the official Postman CLI (including the 61-second OTP cooldown).');
  const cli = await command(process.env.POSTMAN_CLI || (process.platform === 'win32' ? 'postman.exe' : 'postman'), ['collection', 'run', collectionPath, '-e', environmentPath,
    '--no-report-events', '--disable-unicode', '--timeout-request', '20000', '--timeout-script', '90000'], { env: process.env });
  writeFileSync(resolve(runDir, 'postman.log'), cli.output);
  const stat = name => {
    const match = cli.output.match(new RegExp('\\|\\s*' + name + '\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|'));
    return match ? { executed: Number(match[1]), failed: Number(match[2]) } : null;
  };
  const stats = Object.fromEntries(['iterations', 'requests', 'test-scripts', 'prerequest-scripts', 'assertions'].map(name => [name, stat(name)]));
  const result = { runId, timestamp: new Date().toISOString(), engine: 'Postman CLI', requestCount, exitCode: cli.code,
    mode: 'isolated-local-integration', simulatedServices: ['OTP SMS delivery', 'VNPAY external bank'],
    database: databaseName, apiUrl, simulator, stats, logPath: resolve(runDir, 'postman.log') };
  const reportDir = resolve(postman, 'reports');
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(resolve(reportDir, 'latest-run.json'), JSON.stringify(result, null, 2) + '\n');
  const complete = cli.code === 0 && stats.requests?.executed >= requestCount && Object.values(stats).every(s => s && s.failed === 0) && simulator.refundsVerified > 0;
  writeFileSync(resolve(reportDir, 'latest-run.md'), `# BrewLite Postman full run\n\nResult: **${complete ? 'PASS' : 'FAIL'}**\n\n` +
    `- Runner: Postman CLI\n- Collection: ${requestCount} requests, 1 iteration\n- Requests executed: ${stats.requests?.executed ?? 'unknown'}; failures: ${stats.requests?.failed ?? 'unknown'}\n` +
    `- Assertions executed: ${stats.assertions?.executed ?? 'unknown'}; failures: ${stats.assertions?.failed ?? 'unknown'}\n` +
    `- Timestamp (UTC): ${result.timestamp}\n- Database: ${databaseName}\n\n` +
    `The HTTP request count includes one helper request to the local VNPAY bank simulator in addition to the 65 collection requests.\n\n` +
    `OTP delivery and the external VNPAY bank were simulated locally. Real BrewLite HTTP endpoints, PostgreSQL, authorization, payment signatures, invalid/successful/duplicate IPN callbacks and signed refunds were exercised. This is not evidence of a real eSMS delivery or a real VNPAY sandbox/bank settlement.\n\n` +
    `Verified simulator events: ${JSON.stringify(simulator)}\n\nFull runner output: \`${result.logPath}\`.\n\nRepeat from the repository root: \`node backend/postman/run-full.mjs\`.\n`);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = complete ? 0 : (cli.code || 1);
} finally { await cleanup(); }
