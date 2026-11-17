import assert from 'node:assert/strict';

// Exercise the actual exported requests, in an order satisfying their dependencies.
// This scenario is generated only for the isolated test API, never for Docker 4001.
export function integrationScenario(collection, gatewayPort) {
  const templates = new Map(collection.item.flatMap(g => g.item).map(i => [i.name.split(' — ')[0], i]));
  const covered = new Set();
  const items = [];
  function insert(item, listen, code, before = false) {
    let event = item.event.find(e => e.listen === listen);
    if (!event) {
      event = { listen, script: { type: 'text/javascript', exec: ['{', "const vars = pm.environment.get('base_url') ? pm.environment : pm.collectionVariables;", '}'] } };
      item.event.push(event);
    }
    event.script.exec.splice(before ? 2 : event.script.exec.length - 1, 0, ...code.split('\n'));
  }
  function step(method, path, { body, pre, test } = {}) {
    const key = `${method} ${path}`;
    assert.ok(templates.has(key), `Missing template: ${key}`);
    const item = structuredClone(templates.get(key));
    item.name = `${String(items.length + 1).padStart(2, '0')} ${key}`;
    if (body) item.request.body.raw = typeof body === 'string' ? body : JSON.stringify(body);
    if (pre) insert(item, 'prerequest', pre, true);
    if (test) insert(item, 'test', test);
    items.push(item);
    covered.add(key);
    return item;
  }
  const login = (role, body) => step('POST', '/api/auth/login', { body,
    pre: `vars.set('login_role', '${role}');`,
    test: `pm.test('Login ${role}', () => pm.expect(pm.response.json().user.role).to.eql('${role}'));`,
  });
  const newOrder = () => step('POST', '/api/orders', {
    pre: "['order_key', 'payment_key', 'payment_id'].forEach(k => vars.unset(k));",
    test: "pm.test('New order PENDING', () => pm.expect(pm.response.json().status).to.eql('PENDING'));",
  });
  step('GET', '/api');
  step('GET', '/api/health', { test: "pm.test('Database ready', () => pm.expect(pm.response.json().db).to.eql('up'));" });
  login('CUSTOMER');
  step('GET', '/api/auth/me');
  login('BARISTA');
  step('GET', '/api/auth/me', { test: "pm.test('Profile follows last login', () => pm.expect(pm.response.json().role).to.eql('BARISTA'));" });
  step('GET', '/api/inventory/units');
  step('GET', '/api/inventory/ingredients');
  step('POST', '/api/inventory/ingredients');
  step('GET', '/api/inventory/ingredients/{id}');
  step('PATCH', '/api/inventory/ingredients/{id}');
  step('POST', '/api/inventory/receipts', { body: '{"ingredientId": {{ingredient_id}}, "quantity": "1000.000", "reason": "Isolated Postman receipt"}' });
  step('POST', '/api/inventory/adjustments');
  step('GET', '/api/inventory/stock');
  step('GET', '/api/inventory/movements');
  step('POST', '/api/products/toppings');
  step('PUT', '/api/products/toppings/{id}/recipe');
  step('GET', '/api/products/toppings/{id}/recipe');
  step('GET', '/api/products/toppings');
  step('GET', '/api/toppings');
  step('POST', '/api/products');
  step('PATCH', '/api/products/{id}/toppings', { body: '{"toppingIds": [{{topping_id}}]}' });
  step('PUT', '/api/products/{id}/recipes/{size}');
  step('GET', '/api/products/{id}/recipes/{size}');
  step('GET', '/api/products/{id}');
  step('PATCH', '/api/products/{id}/status', { body: { isActive: false } });
  step('PATCH', '/api/products/{id}/status', { body: { isActive: true } });
  step('GET', '/api/products');
  step('POST', '/api/inventory/availability', { test: "pm.test('Availability response', () => pm.expect(pm.response.json()).to.be.an('object'));" });
  step('POST', '/api/promotions/validate', { body: '{"code":"{{promo_code}}","items":[{"productId":{{product_id}},"size":"{{size}}","quantity":2}]}' });
  newOrder();
  step('GET', '/api/orders/{id}');
  step('POST', '/api/payments', { body: '{"orderId": {{order_id}}, "method": "WALLET", "mockResult": "SUCCESS"}',
    test: "pm.test('Mock payment settled', () => pm.expect(pm.response.json().payment.status).to.eql('SUCCESS'));" });
  step('GET', '/api/payments/{id}');
  step('GET', '/api/orders');
  step('GET', '/api/orders/me');
  step('GET', '/api/orders/active');
  for (const status of ['PREPARING', 'READY', 'COMPLETED']) step('PATCH', '/api/orders/{id}/status', { body: { status },
    test: `pm.test('Order ${status}', () => pm.expect(pm.response.json().status).to.eql('${status}'));` });
  newOrder();
  step('POST', '/api/orders/{id}/cancel', { test: "pm.test('Cancelled', () => pm.expect(pm.response.json().status).to.eql('CANCELLED'));" });
  step('POST', '/api/auth/register', { pre: "vars.set('register_phone', '09' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0'));",
    test: "pm.test('Registration waits for OTP', () => { const d = pm.response.json(); pm.expect(d.requiresOtp).to.eql(true); pm.expect(d).not.to.have.property('accessToken'); });" });
  step('POST', '/api/auth/resend-otp', { pre: "console.log('Waiting 61 seconds for the real OTP resend cooldown...');\nsetTimeout(function () {}, 61000);" });
  step('POST', '/api/auth/verify-otp');
  login('CUSTOMER', { phone: '{{register_phone}}', password: '{{register_password}}' });
  login('BARISTA');
  step('POST', '/api/admin/staff', { pre: "vars.set('staff_phone', '09' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0'));",
    test: "pm.test('Verified STAFF without OTP', () => { const d = pm.response.json(); pm.expect(d.role).to.eql('STAFF'); pm.expect(d.isPhoneVerified).to.eql(true); });" });
  login('STAFF');
  login('CUSTOMER');
  newOrder();
  step('POST', '/api/payments', { test: `if (pm.response.code === 201) {
    const payment = pm.response.json().payment;
    pm.test('Gateway is local simulator', () => pm.expect(payment.paymentUrl).to.match(/^http:\\/\\/127\\.0\\.0\\.1:${gatewayPort}\\/pay\\?/));
    pm.sendRequest({ url: payment.paymentUrl, method: 'GET' }, (err, response) => {
      pm.test('Signed local VNPAY settlement', () => {
        pm.expect(err).to.eql(null); pm.expect(response.code).to.eql(200);
        const result = response.json();
        pm.expect(result.mode).to.eql('LOCAL_SIMULATOR');
        pm.expect(result.invalidSignatureRejected).to.eql(true);
        pm.expect(result.duplicateRejected).to.eql(true);
        vars.set('vnpay_callback_query', result.callbackQuery);
      });
    });
  }` });
  step('GET', '/api/payments/vnpay/ipn');
  step('GET', '/api/payments/vnpay/return');
  step('GET', '/api/payments/{id}', { test: "pm.test('VNPAY SUCCESS', () => pm.expect(pm.response.json().status).to.eql('SUCCESS'));" });
  step('POST', '/api/payments/{id}/refund', { test: "pm.test('Refund SUCCESS', () => pm.expect(pm.response.json().refund.status).to.eql('SUCCESS'));" });
  step('DELETE', '/api/admin/staff/{id}', { test: `if (pm.response.code === 200) {
    pm.sendRequest({ url: vars.get('base_url') + '/auth/me', method: 'GET', header: { Authorization: 'Bearer ' + vars.get('staff_token') } }, (err, response) => {
      pm.test('Deleted staff JWT is revoked', () => { pm.expect(err).to.eql(null); pm.expect(response.code).to.eql(401); });
    });
  }` });
  assert.deepEqual([...covered].sort(), [...templates.keys()].sort(), 'Scenario must exercise every exported endpoint');
  return { items, endpointCount: covered.size };
}
