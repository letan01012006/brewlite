// Read-only browser smoke: render the actual menu served by Docker Compose.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const output = resolve('.local-backups/docker-compose-20261111');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(resolve(output, 'chrome-'));
const browser = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
  const endpoint = await new Promise((yes, no) => {
    const timer = setTimeout(() => no(new Error('Chrome startup timed out')), 15000);
    browser.on('error', error => { clearTimeout(timer); no(error); });
    let stderr = '';
    browser.stderr.on('data', data => {
      stderr += data;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); yes(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((yes, no) => { socket.onopen = yes; socket.onerror = no; });
  let id = 0;
  const pending = new Map(), responses = [], errors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const task = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) task?.reject(new Error(message.error.message));
      else task?.resolve(message.result);
    } else if (message.method === 'Network.responseReceived' && message.params.response.url.includes('/api/')) {
      responses.push({ url: message.params.response.url, status: message.params.response.status });
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  };
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const key = ++id;
    pending.set(key, { resolve, reject });
    socket.send(JSON.stringify({ id: key, method, params, sessionId }));
  });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => call(method, params, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const list = await (await fetch('http://localhost:3000/api/products?limit=50')).json();
  const product = (Array.isArray(list) ? list : list.data).find(row => row.isActive !== false);
  assert.ok(product, 'Existing menu product is required');
  await send('Page.navigate', { url: 'http://localhost:3000/menu' });
  let rendered = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    const result = await send('Runtime.evaluate', {
      expression: `document.body?.innerText.includes(${JSON.stringify(product.name)})`, returnByValue: true,
    });
    if (result.result.value) { rendered = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(rendered, 'The browser did not render the existing product');
  assert.ok(responses.some(response => response.url.includes('/api/products') && response.status === 200));
  assert.deepEqual(errors, [], 'Browser runtime errors');
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(resolve(output, 'menu.png'), Buffer.from(screenshot.data, 'base64'));
  console.log(`PASS: Chrome rendered the existing menu, /api/products returned 200, no runtime errors. Screenshot: ${resolve(output, 'menu.png')}`);
} finally {
  socket?.close();
  browser.kill();
}
