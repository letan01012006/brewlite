// Run manually with the demo API on :4000 and built frontend on :3000.
// Creates fresh demo customers/staff; never changes existing accounts.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const output = process.env.AUTH_BROWSER_OUTPUT || path.join(os.tmpdir(), 'brewlite-auth-browser');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'brewlite-auth-chrome-'));
const browser = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  let stderr = '';
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Browser startup timeout')), 15000);
    browser.stderr.on('data', data => {
      stderr += data; const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    browser.on('error', reject);
  });
  const ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0; const pending = new Map(); const responses = []; const exceptions = [];
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const task = pending.get(message.id); pending.delete(message.id);
      if (message.error) task?.reject(Error(message.error.message));
      else task?.resolve(message.result);
    } else if (message.method === 'Network.responseReceived' && message.params.response.url.includes('/api/')) {
      responses.push({ url: message.params.response.url, status: message.params.response.status });
    } else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
  };
  function call(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++seq; pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => call(method, params, sessionId);
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function until(expression) {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw Error('Timeout: ' + expression + '\n' + await evaluate('document.body.innerText'));
  }
  async function go(route) {
    await send('Page.navigate', { url: 'http://localhost:3000' + route });
    await until('document.readyState === "complete"');
    await delay(300);
  }
  async function input(selector, value) {
    await until('!!document.querySelector(' + JSON.stringify(selector) + ')');
    await evaluate('document.querySelector(' + JSON.stringify(selector) + ').focus()');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await send('Input.insertText', { text: value });
  }
  const submit = () => evaluate('document.querySelector("form").requestSubmit()');
  const reset = async () => { await evaluate('localStorage.clear()'); await go('/login'); };
  const api = (route, body, auth = true) => evaluate(`(async()=>{const r=await fetch('/api${route}',{method:'POST',headers:{'Content-Type':'application/json',${auth ? "Authorization:'Bearer '+localStorage.getItem('brewlite_token')," : ''}},body:JSON.stringify(${JSON.stringify(body)})});return {status:r.status,body:await r.json()};})()`);
  const stamp = String(Date.now()).slice(-7);
  const customerPhone = '098' + stamp; const staffPhone = '099' + stamp;
  const password = 'Browser@123'; const checks = [];
  try {
    await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
    await go('/register?redirect=/menu');
    await input('[name="phone"]', customerPhone); await input('[name="fullName"]', 'Khách trình duyệt');
    await input('[name="password"]', password); await input('[name="confirmPassword"]', password);
    await submit();
    await until('location.pathname === "/verify-otp" && !!document.querySelector("[name=code]")');
    assert.equal(await evaluate('localStorage.getItem("brewlite_token")'), null);
    assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Gửi lại")).disabled'), true);
    await input('[name="code"]', '000000'); await submit();
    await until('!!document.querySelector("[role=status]")');
    assert.equal(await evaluate('localStorage.getItem("brewlite_token")'), null);
    await input('[name="code"]', '123456'); await submit();
    await until('location.pathname === "/menu" && !!localStorage.getItem("brewlite_token")');
    let profileData = await evaluate('fetch("/api/auth/me",{headers:{Authorization:"Bearer "+localStorage.getItem("brewlite_token")}}).then(r=>r.json())');
    assert.equal(profileData.email, null); assert.equal(profileData.loyaltyPoints, 1000); assert.equal(profileData.role, 'CUSTOMER');
    await send('Page.reload'); await until('document.readyState === "complete" && location.pathname === "/menu"');
    await delay(500);
    profileData = await evaluate('fetch("/api/auth/me",{headers:{Authorization:"Bearer "+localStorage.getItem("brewlite_token")}}).then(r=>r.json())');
    assert.equal(profileData.email, null); assert.equal(profileData.phone, customerPhone);
    checks.push('Public registration without email -> wrong OTP stays signed out -> correct OTP signs in, 1000 points, reload /me with null email');
    await reset();
    await input('[name="phone"]', customerPhone); await input('[name="password"]', password); await submit();
    await until('location.pathname === "/" && !!localStorage.getItem("brewlite_token")');
    checks.push('Verified customer logs in again by phone');
    const pendingPhone = '096' + stamp;
    assert.equal((await api('/auth/register', { fullName: 'Khách chờ OTP', phone: pendingPhone, password }, false)).status, 201);
    await reset();
    await input('[name="phone"]', pendingPhone); await input('[name="password"]', password); await submit();
    await until('location.pathname === "/verify-otp" && !!document.querySelector("[name=code]")');
    assert.equal(await evaluate('localStorage.getItem("brewlite_token")'), null);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(path.join(output, 'otp-mobile.png'), Buffer.from(r.data, 'base64')));
    await send('Emulation.setDeviceMetricsOverride', { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
    checks.push('Correct password for pending customer returns to OTP without storing JWT');
    await reset();
    await input('[name="phone"]', '0900000001'); await input('[name="password"]', 'Manager@123'); await submit();
    await until('location.pathname === "/manager" && document.body.innerText.includes("Quản lý BrewLite")');
    const staff = await api('/admin/staff', { fullName: 'Barista trình duyệt', phone: staffPhone, password });
    assert.equal(staff.status, 201); assert.equal(staff.body.role, 'BARISTA'); assert.equal(staff.body.isPhoneVerified, true);
    checks.push('Manager phone login -> /manager -> staff API creates verified BARISTA');
    await reset();
    await input('[name="phone"]', staffPhone); await input('[name="password"]', password); await submit();
    await until('location.pathname === "/barista" && !!localStorage.getItem("brewlite_token")');
    await until('!document.body.innerText.includes("Đang kiểm tra đăng nhập")');
    assert.equal((await api('/admin/staff', { fullName: 'Forbidden', phone: '096' + stamp, password })).status, 403);
    checks.push('Provisioned BARISTA logs in without OTP -> /barista; staff creation forbidden with 403');
    await send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(path.join(output, 'barista.png'), Buffer.from(r.data, 'base64')));
    for (const account of [
      { email: 'demo@brewlite.com', password: 'Demo@1234', route: '/' },
      { email: 'barista@brewlite.com', password: 'Barista@123', route: '/barista' },
    ]) {
      await reset();
      await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Email (tài khoản cũ)")).click()');
      await input('[name="email"]', account.email); await input('[name="password"]', account.password); await submit();
      await until(`location.pathname === ${JSON.stringify(account.route)} && !!localStorage.getItem("brewlite_token")`);
      checks.push('Legacy email login: ' + account.email + ' -> ' + account.route);
    }
    await send('Page.navigate', { url: 'http://localhost:4000/api/docs' });
    await until('document.body.innerText.includes("/api/admin/staff") && document.body.innerText.includes("Authorize")');
    await send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(path.join(output, 'swagger.png'), Buffer.from(r.data, 'base64')));
    checks.push('Swagger UI renders staff endpoint and JWT Authorize');
    assert.equal(responses.filter(r => r.status >= 500).length, 0); assert.deepEqual(exceptions, []);
    const result = { status: 'PASS', customerPhone, staffPhone, checks, responses };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await call('Browser.close').catch(() => {}); ws.close(); }
})().catch(error => { console.error(error); browser.kill(); process.exitCode = 1; });
