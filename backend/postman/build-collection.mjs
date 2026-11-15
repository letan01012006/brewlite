import { writeFileSync } from 'node:fs';

// Generate portable Postman v2.1 files using only public local demo credentials.
const base = '{{base_url}}';
const bearer = (key) => ({ type: 'bearer', bearer: [{ key: 'token', value: `{{${key}}}`, type: 'string' }] });
const noauth = { type: 'noauth' };
const event = (listen, source) => ({ listen, script: { type: 'text/javascript', exec: [
  '{',
  "const vars = pm.environment.get('base_url') ? pm.environment : pm.collectionVariables;",
  ...source.replaceAll('pm.environment', 'vars').split('\n'),
  '}',
] } });
const status = (code) => `pm.test('HTTP ${code}', () => pm.response.to.have.status(${code}));`;
const save = (key, expression = 'data.id') => `pm.environment.set('${key}', String(${expression}));`;
function request(name, method, path, { body, code = 200, token, test = '', pre = '', description = '', headers = [] } = {}) {
  const raw = base + path;
  const [pathname, query] = path.split('?');
  const url = { raw, host: [base], path: pathname.slice(1).split('/') };
  if (query) url.query = query.split('&').map((entry) => { const at = entry.indexOf('='); return { key: entry.slice(0, at), value: entry.slice(at + 1) }; });
  const req = {
    name,
    request: {
      method, auth: token ? bearer(token) : noauth,
      header: [{ key: 'Accept', value: 'application/json' }, ...headers], url, description,
    },
    event: [event('test', `${status(code)}\nif (pm.response.code === ${code}) {\n  const data = pm.response.json();\n${test}\n}`)],
    response: [],
  };
  if (body !== undefined) {
    req.request.header.push({ key: 'Content-Type', value: 'application/json' });
    req.request.body = { mode: 'raw', raw: typeof body === 'string' ? body : JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } };
  }
  if (pre) req.event.unshift(event('prerequest', pre));
  return req;
}
const folder = (name, description, item) => ({ name, description, item });
const customer = 'customer_token';
const barista = 'barista_token';
const items = '[{"productId": {{product_id}}, "size": "{{size}}", "quantity": 2, "toppingIds": []}]';
const cart = `{"items": ${items}}`;
const order = request('01 Create order (PENDING)', 'POST', '/orders', {
  token: customer, body: cart, code: 201,
  headers: [{ key: 'Idempotency-Key', value: '{{order_key}}' }],
  pre: `if (!pm.environment.get('order_key')) {\n  pm.environment.set('order_key', pm.variables.replaceIn('{{$guid}}'));\n}\npm.environment.set('order_payload', pm.variables.replaceIn(pm.request.body.raw));`,
  test: `${save('order_id')}\npm.test('Order is PENDING', () => pm.expect(data.status).to.eql('PENDING'));`,
  description: 'Tạo đơn bằng Customer. Chạy 00 trước để lấy món/size còn nguyên liệu. Gửi lại cùng request giữ nguyên key; để tạo đơn mới, đăng nhập Customer lại (xóa key cũ). Khi timeout, giữ nguyên body/key và gửi lại.',
});
const payment = request('03 Pay with WALLET mock (SUCCESS)', 'POST', '/payments', {
  token: customer, code: 201,
  body: '{"orderId": {{order_id}}, "method": "WALLET", "mockResult": "SUCCESS"}',
  headers: [{ key: 'Idempotency-Key', value: '{{payment_key}}' }],
  pre: `if (!pm.environment.get('payment_key')) pm.environment.set('payment_key', pm.variables.replaceIn('{{$guid}}'));\npm.environment.set('payment_payload', pm.variables.replaceIn(pm.request.body.raw));`,
  test: `${save('payment_id', 'data.payment.id')}\npm.test('Payment SUCCESS / order PAID', () => { pm.expect(data.payment.status).to.eql('SUCCESS'); pm.expect(data.order.status).to.eql('PAID'); });`,
  description: 'Chỉ dùng mock local với PAYMENT_MOCK_ENABLED=true. Không gọi cổng thanh toán thật. Gửi lại phải giữ nguyên key và body.',
});
const folders = [
  folder('00 Quick start - run first', 'Chạy cả folder theo thứ tự. Chỉ đọc dữ liệu và đăng nhập; không tạo đơn. Đăng nhập Customer bắt đầu phiên test mới, xóa ID/key checkout cũ.', [
    request('01 Health + database', 'GET', '/health', { test: "pm.test('Database ready', () => { pm.expect(data.status).to.eql('ok'); pm.expect(data.db).to.eql('up'); });" }),
    request('02 Login Customer (save token)', 'POST', '/auth/login', {
      body: { email: '{{customer_email}}', password: '{{customer_password}}' },
      pre: "['customer_token', 'customer_id', 'order_id', 'payment_id', 'order_key', 'payment_key', 'order_payload', 'payment_payload', 'product_id', 'size', 'topping_id'].forEach(key => pm.environment.unset(key));",
      test: `${save(customer, 'data.accessToken')}\n${save('customer_id', 'data.user.id')}\npm.test('CUSTOMER role', () => pm.expect(data.user.role).to.eql('CUSTOMER'));`,
    }),
    request('03 My profile', 'GET', '/auth/me', { token: customer, test: "pm.test('Current Customer', () => pm.expect(String(data.id)).to.eql(pm.environment.get('customer_id')));" }),
    request('04 Login Barista (save token)', 'POST', '/auth/login', {
      body: { email: '{{barista_email}}', password: '{{barista_password}}' },
      pre: "pm.environment.unset('barista_token');",
      test: `${save(barista, 'data.accessToken')}\npm.test('BARISTA role', () => pm.expect(data.user.role).to.eql('BARISTA'));`,
    }),
    request('05 List menu (save available product + size)', 'GET', '/products?page=1&limit=50', {
      pre: "['product_id', 'size', 'topping_id'].forEach(key => pm.environment.unset(key));",
      test: `pm.test('Paginated menu', () => { pm.expect(data.data).to.be.an('array'); pm.expect(data.meta).to.have.property('total'); });\nconst product = data.data.find(p => p.availability?.some(a => a.maxQuantity >= 2));\npm.test('At least one product has ingredients for 2 cups', () => pm.expect(product, 'Seed inventory or add stock before checkout').to.exist);\nif (product) {\n  const choice = product.availability.find(a => a.size === 'M' && a.maxQuantity >= 2) || product.availability.find(a => a.maxQuantity >= 2);\n  pm.environment.set('product_id', String(product.id));\n  pm.environment.set('size', choice.size);\n}`,
    }),
    request('06 Product detail (save allowed topping)', 'GET', '/products/{{product_id}}', {
      test: `pm.test('Sizes and toppings', () => { pm.expect(data.sizes).to.be.an('array'); pm.expect(data.toppings).to.be.an('array'); });\npm.environment.unset('topping_id');\nif (data.toppings.length) pm.environment.set('topping_id', String(data.toppings[0].id));`,
    }),
    request('07 Topping catalog', 'GET', '/products/toppings', { test: "pm.test('Topping array', () => pm.expect(data).to.be.an('array'));" }),
    request('08 Cart ingredient availability', 'POST', '/inventory/availability', { body: cart }),
    request('09 My order history', 'GET', '/orders/me?page=1&limit=10', { token: customer }),
  ]),
  folder('01 Checkout demo - run after 00', 'Chạy tuần tự: tạo đơn → kiểm tra chống trùng → thanh toán mock → Barista pha chế → hoàn tất. Folder này tạo đơn và trừ nguyên liệu khi PREPARING.', [
    order,
    request('02 Replay same order (same ID)', 'POST', '/orders', {
      token: customer, body: '{{order_payload}}', code: 201,
      headers: [{ key: 'Idempotency-Key', value: '{{order_key}}' }],
      test: "pm.test('No duplicate order', () => pm.expect(String(data.id)).to.eql(pm.environment.get('order_id')));",
    }),
    payment,
    request('04 Replay same payment', 'POST', '/payments', {
      token: customer, code: 201, body: '{{payment_payload}}', headers: [{ key: 'Idempotency-Key', value: '{{payment_key}}' }],
      test: "pm.test('No duplicate payment', () => { pm.expect(String(data.payment.id)).to.eql(pm.environment.get('payment_id')); pm.expect(pm.response.headers.get('Idempotent-Replayed')).to.eql('true'); });",
    }),
    request('05 Payment detail', 'GET', '/payments/{{payment_id}}', { token: customer }),
    request('06 Order detail', 'GET', '/orders/{{order_id}}', { token: customer }),
    request('07 All orders (Barista)', 'GET', '/orders?page=1&limit=10', { token: barista }),
    request('08 Active orders (Barista)', 'GET', '/orders/active', { token: barista }),
    ...['PREPARING', 'READY', 'COMPLETED'].map((state, i) => request(`${String(i + 9).padStart(2, '0')} Set ${state} (Barista)`, 'PATCH', '/orders/{{order_id}}/status', {
      token: barista, body: { status: state }, test: `pm.test('Order ${state}', () => pm.expect(data.status).to.eql('${state}'));`,
    })),
  ]),
  folder('02 Cancel unpaid order - run after 00', 'Luồng riêng để thử hủy đơn PENDING; dùng cancel_order_id riêng, không hủy đơn đã hoàn tất ở folder 01.', [
    request('01 Create order to cancel', 'POST', '/orders', { token: customer, body: cart, code: 201,
      pre: "pm.environment.set('cancel_key', pm.variables.replaceIn('{{$guid}}'));", headers: [{ key: 'Idempotency-Key', value: '{{cancel_key}}' }], test: save('cancel_order_id'),
    }),
    request('02 Cancel my pending order', 'POST', '/orders/{{cancel_order_id}}/cancel', { token: customer, test: "pm.test('CANCELLED', () => pm.expect(data.status).to.eql('CANCELLED'));" }),
    request('03 Read cancelled order', 'GET', '/orders/{{cancel_order_id}}', { token: customer }),
  ]),
  folder('03 Promotions - run after 00', 'BREW10 cần giá trị tối thiểu 50.000đ. Mã HETHAN trong seed đã hết hạn.', [
    request('01 Preview BREW10', 'POST', '/promotions/validate', { token: customer, body: `{"code": "{{promo_code}}", "items": ${items}}`, description: 'Nếu món bạn chọn chưa đạt minOrderValue, tăng quantity. Server tính giá từ catalog.' }),
    request('02 Expired promotion (422 expected)', 'POST', '/promotions/validate', { token: customer, body: `{"code": "HETHAN", "items": ${items}}`, code: 422, test: "pm.test('Expired code', () => pm.expect(data.code).to.eql('PROMO_EXPIRED'));" }),
  ]),
  folder('04 Inventory - read only after 00', 'Các request đọc kho dùng token Barista đã lưu. Lấy ingredient_id thực từ response.', [
    request('01 Supported units', 'GET', '/inventory/units', { token: barista }),
    request('02 Ingredients (save first ID)', 'GET', '/inventory/ingredients', { token: barista, test: "pm.test('Ingredients exist', () => pm.expect(data).to.be.an('array').that.is.not.empty);\nif (data.length) pm.environment.set('ingredient_id', String(data[0].id));" }),
    request('03 Ingredient detail', 'GET', '/inventory/ingredients/{{ingredient_id}}', { token: barista }),
    request('04 Stock and reserved quantities', 'GET', '/inventory/stock', { token: barista }),
    request('05 Inventory movements', 'GET', '/inventory/movements?page=1&limit=20', { token: barista }),
    request('06 Product recipe by size', 'GET', '/products/{{product_id}}/recipes/{{size}}', { token: barista }),
    request('07 Topping recipe (requires topping_id)', 'GET', '/products/toppings/{{topping_id}}/recipe', { token: barista, description: 'Chỉ gửi nếu món ở 00 có topping; hoặc điền topping_id từ catalog.' }),
    request('08 Include paused menu (Barista)', 'GET', '/products?includeInactive=true&page=1&limit=50', { token: barista }),
  ]),
  folder('05 Catalog + inventory demo - optional', 'Chạy tuần tự sau 00 để tạo sản phẩm, topping, nguyên liệu demo riêng. Những request cập nhật chỉ dùng demo_*_id, không dùng món seed. Tên có UUID. Luồng này ghi dữ liệu local.', [
    request('01 Create demo ingredient', 'POST', '/inventory/ingredients', { token: barista, code: 201, body: { name: 'Postman ingredient {{$guid}}', unit: 'GRAM' }, test: save('demo_ingredient_id') }),
    request('02 Receive 1000g demo ingredient', 'POST', '/inventory/receipts', { token: barista, code: 201,
      body: '{"ingredientId": {{demo_ingredient_id}}, "quantity": "1000.000", "reason": "Postman demo receipt"}',
      headers: [{ key: 'Idempotency-Key', value: '{{receipt_key}}' }], pre: "pm.environment.set('receipt_key', pm.variables.replaceIn('{{$guid}}'));",
    }),
    request('03 Create demo topping', 'POST', '/products/toppings', { token: barista, code: 201, body: { name: 'Postman topping {{$guid}}', price: 5000 }, test: save('demo_topping_id') }),
    request('04 Configure demo topping recipe', 'PUT', '/products/toppings/{{demo_topping_id}}/recipe', { token: barista,
      body: '{"ingredientId": {{demo_ingredient_id}}, "quantityPerServing": "5.000"}',
    }),
    request('05 Create demo product', 'POST', '/products', { token: barista, code: 201,
      body: '{"name": "Postman coffee {{$guid}}", "category": "Postman Demo", "price": 35000, "description": "API test product", "toppingIds": [{{demo_topping_id}}]}', test: save('demo_product_id'),
    }),
    request('06 Replace demo product toppings', 'PATCH', '/products/{{demo_product_id}}/toppings', { token: barista, body: '{"toppingIds": [{{demo_topping_id}}]}' }),
    request('07 Configure active recipe size M', 'PUT', '/products/{{demo_product_id}}/recipes/M', { token: barista,
      body: '{"isActive": true, "ingredients": [{"ingredientId": {{demo_ingredient_id}}, "quantity": "20.000"}]}',
    }),
    request('08 Check demo product availability', 'POST', '/inventory/availability', { body: '{"items": [{"productId": {{demo_product_id}}, "size": "M", "quantity": 1, "toppingIds": [{{demo_topping_id}}]}]}' }),
    request('09 Record 10g wastage', 'POST', '/inventory/adjustments', { token: barista, code: 201,
      body: '{"ingredientId": {{demo_ingredient_id}}, "quantity": "10.000", "reason": "Postman demo wastage"}',
      headers: [{ key: 'Idempotency-Key', value: '{{adjustment_key}}' }], pre: "pm.environment.set('adjustment_key', pm.variables.replaceIn('{{$guid}}'));",
    }),
    request('10 Update demo ingredient name', 'PATCH', '/inventory/ingredients/{{demo_ingredient_id}}', { token: barista, body: { name: 'Postman ingredient updated {{$guid}}' } }),
    request('11 Pause demo product', 'PATCH', '/products/{{demo_product_id}}/status', { token: barista, body: { isActive: false } }),
    request('12 Resume demo product', 'PATCH', '/products/{{demo_product_id}}/status', { token: barista, body: { isActive: true } }),
  ]),
  folder('06 Auth phone + Manager - manual', 'Gửi từng request theo nhu cầu. Không chạy toàn bộ folder: register/resend cần cấu hình SMS; Manager cần seed riêng. Dùng SĐT test do bạn kiểm soát nếu gửi SMS thật.', [
    request('01 Register Customer (requires OTP)', 'POST', '/auth/register', { code: 201,
      body: { fullName: 'Postman Customer', phone: '{{register_phone}}', password: '{{register_password}}' },
      test: "pm.test('OTP required, no JWT yet', () => { pm.expect(data.requiresOtp).to.eql(true); pm.expect(data).not.to.have.property('accessToken'); });",
      description: 'Chọn register_phone chưa tồn tại. Demo OTP 123456 chỉ khi NODE_ENV=development/test, SMS_PROVIDER=local, AUTH_OTP_DEMO=true. Không tự thay cấu hình eSMS của bạn.',
    }),
    request('02 Verify OTP (save phone token)', 'POST', '/auth/verify-otp', { body: { phone: '{{register_phone}}', code: '{{otp_code}}' }, test: save('phone_token', 'data.accessToken') }),
    request('03 Resend OTP (wait 60 seconds)', 'POST', '/auth/resend-otp', { body: { phone: '{{register_phone}}' }, description: 'Gửi trước verify khi cần mã mới; gửi liên tiếp dưới 60 giây nhận 429.' }),
    request('04 Login phone Customer', 'POST', '/auth/login', { body: { phone: '{{register_phone}}', password: '{{register_password}}' }, test: save('phone_token', 'data.accessToken') }),
    request('05 Phone Customer profile', 'GET', '/auth/me', { token: 'phone_token' }),
    request('06 Login Manager', 'POST', '/auth/login', { body: { phone: '{{manager_phone}}', password: '{{manager_password}}' },
      test: `${save('manager_token', 'data.accessToken')}\npm.test('MANAGER role', () => pm.expect(data.user.role).to.eql('MANAGER'));`,
      description: 'Manager không được tạo bởi seed mặc định. Xem README phần Manager; dùng thông tin DEMO_MANAGER_* đã cấu hình.',
    }),
    request('07 Manager creates Barista', 'POST', '/admin/staff', { token: 'manager_token', code: 201,
      body: { fullName: 'Postman Barista', phone: '{{staff_phone}}', password: '{{staff_password}}' },
      test: "pm.test('Verified BARISTA', () => { pm.expect(data.role).to.eql('BARISTA'); pm.expect(data.isPhoneVerified).to.eql(true); });",
    }),
    request('08 Login newly created staff', 'POST', '/auth/login', { body: { phone: '{{staff_phone}}', password: '{{staff_password}}' }, test: save('staff_token', 'data.accessToken') }),
  ]),
  folder('07 Error cases - run after 00', 'HTTP lỗi ở đây là kết quả mong đợi; Assertions phải PASS. Không cập nhật dữ liệu hợp lệ.', [
    request('01 Missing JWT -> 401', 'GET', '/auth/me', { code: 401 }),
    request('02 Wrong password -> 401', 'POST', '/auth/login', { body: { email: '{{customer_email}}', password: 'DefinitelyWrong999' }, code: 401, test: "pm.test('Invalid credentials', () => pm.expect(data.code).to.eql('INVALID_CREDENTIALS'));" }),
    request('03 Customer cannot list all orders -> 403', 'GET', '/orders', { token: customer, code: 403 }),
    request('04 Customer cannot create product -> 403', 'POST', '/products', { token: customer, code: 403, body: { name: 'Forbidden product', category: 'Demo', price: 10000 } }),
    request('05 Invalid product ID -> 400', 'GET', '/products/not-an-id', { code: 400 }),
    request('06 Empty order -> 400', 'POST', '/orders', { token: customer, body: { items: [] }, code: 400 }),
    request('07 Extra field rejected -> 400', 'POST', '/auth/login', { code: 400, body: { email: '{{customer_email}}', password: '{{customer_password}}', role: 'MANAGER' } }),
    request('08 Customer cannot create staff -> 403', 'POST', '/admin/staff', { token: customer, code: 403,
      body: { fullName: 'Forbidden Staff', phone: '{{staff_phone}}', password: '{{staff_password}}' },
    }),
  ]),
  folder('08 VNPAY + refund - manual', 'Chỉ dùng sau khi cấu hình sandbox VNPAY. Tạo đơn mới riêng; không dùng order_id đã COMPLETED. IPN/return cần query thật có chữ ký, không tự giả lập chữ ký hoặc gắn hash secret vào Postman.', [
    request('01 Create fresh order for VNPAY', 'POST', '/orders', { token: customer, code: 201, body: cart, test: save('vnpay_order_id'),
      headers: [{ key: 'Idempotency-Key', value: '{{vnpay_order_key}}' }],
      pre: "if (!pm.environment.get('vnpay_order_key')) pm.environment.set('vnpay_order_key', pm.variables.replaceIn('{{$guid}}'));",
    }),
    request('02 Create VNPAY sandbox URL', 'POST', '/payments', { token: customer, code: 201,
      body: '{"orderId": {{vnpay_order_id}}, "method": "VNPAY"}', headers: [{ key: 'Idempotency-Key', value: '{{vnpay_payment_key}}' }],
      pre: "if (!pm.environment.get('vnpay_payment_key')) pm.environment.set('vnpay_payment_key', pm.variables.replaceIn('{{$guid}}'));",
      test: `${save('vnpay_payment_id', 'data.payment.id')}\npm.environment.set('vnpay_payment_url', data.payment.paymentUrl);`,
      description: 'Mở payment.paymentUrl trong trình duyệt để thanh toán sandbox, sau đó đọc lại giao dịch. Không dùng credentials placeholder trong .env.example.',
    }),
    request('03 Read VNPAY payment', 'GET', '/payments/{{vnpay_payment_id}}', { token: customer }),
    request('04 Refund successful VNPAY payment (Barista)', 'POST', '/payments/{{vnpay_payment_id}}/refund', { token: barista,
      description: 'Chỉ gửi sau khi giao dịch sandbox thành công và đủ điều kiện hoàn tiền. Đây là thao tác hoàn tiền; không chạy cùng checkout demo.',
    }),
  ]),
];
const values = {
  base_url: 'http://127.0.0.1:4000/api',
  customer_email: 'demo@brewlite.com', customer_password: 'Demo@1234',
  barista_email: 'barista@brewlite.com', barista_password: 'Barista@123',
  promo_code: 'BREW10', register_phone: '', register_password: 'Postman@123', otp_code: '',
  manager_phone: '', manager_password: '', staff_phone: '', staff_password: 'Barista@123',
  customer_token: '', barista_token: '', manager_token: '', phone_token: '', staff_token: '',
  customer_id: '', product_id: '', size: '', topping_id: '', ingredient_id: '', order_id: '', payment_id: '',
  order_key: '', payment_key: '', order_payload: '', payment_payload: '', cancel_order_id: '', cancel_key: '',
  demo_product_id: '', demo_topping_id: '', demo_ingredient_id: '', receipt_key: '', adjustment_key: '',
  vnpay_order_id: '', vnpay_payment_id: '', vnpay_order_key: '', vnpay_payment_key: '', vnpay_payment_url: '',
};
const collection = {
  info: { _postman_id: '09cf27a8-0cf7-48e2-8f5a-dbc9a0646918', name: 'BrewLite API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    description: 'BrewLite local API. Có thể chạy ngay với No Environment: cấu hình và token được lưu ở collection variables. Hoặc import/chọn environment BrewLite Local. Bắt đầu với folder 00, sau đó 01 để demo checkout. Các folder 06/08 gửi thủ công. Xem backend/postman/README.md trong repository. Không chạy toàn bộ collection vì có các luồng tùy chọn cần cấu hình riêng.' },
  auth: noauth, item: folders,
  variable: Object.entries(values).map(([key, value]) => ({ key, value, type: 'string' })),
};
const environment = {
  id: '1ea03115-dc8f-4eed-8e19-1089f09fedb8', name: 'BrewLite Local', _postman_variable_scope: 'environment',
  values: Object.entries(values).map(([key, value]) => ({ key, value, enabled: true, type: /password|token|otp_code/.test(key) ? 'secret' : 'default' })),
};
for (const [file, data] of [['BrewLite.postman_collection.json', collection], ['BrewLite-Local.postman_environment.json', environment]]) {
  writeFileSync(new URL(file, import.meta.url), JSON.stringify(data, null, 2) + '\n');
}
console.log(`Generated ${folders.reduce((n, f) => n + f.item.length, 0)} requests in ${folders.length} folders.`);
