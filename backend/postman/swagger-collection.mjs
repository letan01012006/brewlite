import { readFileSync } from 'node:fs';

// Snapshot of the actual Docker 4001 OpenAPI document, not the API on port 4000.
export function swaggerGroups() {
  const spec = JSON.parse(readFileSync(new URL('BrewLite.openapi.json', import.meta.url), 'utf8'));
  const groups = new Map();
  const base = '{{base_url}}';
  const vars = "const vars = pm.environment.get('base_url') ? pm.environment : pm.collectionVariables;";
  const script = (listen, source) => ({ listen, script: { type: 'text/javascript', exec: ['{', vars, ...source.split('\n'), '}'] } });
  const resolve = schema => schema?.$ref ? spec.components.schemas[schema.$ref.split('/').at(-1)] : schema;
  const numeric = key => `__NUMBER_${key}__`;
  function sample(schema, field = '') {
    schema = resolve(schema);
    const refs = { productId: 'product_id', ingredientId: 'ingredient_id', orderId: 'order_id' };
    if (refs[field]) return numeric(refs[field]);
    if (field === 'toppingIds') return [];
    if (field === 'size') return '{{size}}';
    if (field === 'phone') return '{{register_phone}}';
    if (field === 'password') return '{{register_password}}';
    if (field === 'code' && schema.example === '123456') return '{{otp_code}}';
    if (schema.type === 'object' && schema.properties) {
      const fields = new Set(schema.required || []);
      if (!fields.size) fields.add('name'); // PATCH ingredient metadata example.
      if (schema.properties.reason) fields.add('reason');
      if (schema.properties.isActive && schema.properties.ingredients) fields.add('isActive');
      return Object.fromEntries([...fields].filter(k => schema.properties[k]).map(k => [k, sample(schema.properties[k], k)]));
    }
    if (schema.type === 'array') return [sample(schema.items)];
    if (field === 'name') return `${schema.example || 'Postman item'} {{$guid}}`;
    if (field === 'code') return '{{promo_code}}';
    if (field === 'isActive') return true;
    return schema.example ?? schema.default ?? schema.enum?.[0] ?? (schema.type === 'boolean' ? false : ['number', 'integer'].includes(schema.type) ? (schema.minimum || 1) : '');
  }
  function tokenFor(path, method, tag) {
    if (path === '/api/auth/me') return 'auth_token';
    if (tag === 'admin/staff') return 'barista_token';
    if (['ingredients', 'inventory'].includes(tag) || (tag === 'products' && (method !== 'get' || path === '/api/products')) ||
        (tag === 'orders' && (path === '/api/orders/active' || (path === '/api/orders' && method === 'get') || method === 'patch')) || path.endsWith('/refund')) return 'barista_token';
    return 'customer_token';
  }
  for (const [path, methods] of Object.entries(spec.paths)) for (const [method, operation] of Object.entries(methods)) {
    if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) continue;
    const tag = operation.tags?.[0] || 'App';
    if (!groups.has(tag)) groups.set(tag, { name: tag, item: [] });
    const id = tag === 'admin/staff' ? 'staff_id' : path.includes('/inventory/ingredients/') ? 'ingredient_id' : path.includes('/products/toppings/') ? 'topping_id' : path.startsWith('/api/products/') ? 'product_id' : path.startsWith('/api/orders/') ? 'order_id' : 'payment_id';
    const route = path.slice(4).replace('{id}', `{{${id}}}`).replace('{size}', '{{size}}');
    const query = (operation.parameters || []).filter(p => p.in === 'query').map(p => ({
      key: p.name, value: String(p.schema?.default ?? p.schema?.example ?? (p.name === 'ingredientId' ? '{{ingredient_id}}' : p.schema?.enum?.[0] ?? '')),
      disabled: !p.required && p.schema?.default === undefined,
      description: [p.description, p.schema?.enum ? `Giá trị: ${p.schema.enum.join(', ')}` : ''].filter(Boolean).join(' '),
    }));
    const queryString = query.filter(p => !p.disabled).map(p => `${p.key}=${p.value}`).join('&');
    const url = { raw: base + route + (queryString ? '?' + queryString : ''), host: [base], path: route ? route.slice(1).split('/') : [] };
    if (query.length) url.query = query;
    const headers = [{ key: 'Accept', value: 'application/json' }];
    const pre = [];
    const token = tokenFor(path, method, tag);
    const description = [operation.summary || path, operation.description || '', `Nguồn: ${method.toUpperCase()} ${path}. Swagger Docker 4001.`];
    const request = { method: method.toUpperCase(), auth: operation.security?.length ? { type: 'bearer', bearer: [{ key: 'token', value: `{{${token}}}`, type: 'string' }] } : { type: 'noauth' }, header: headers, url };
    const content = operation.requestBody?.content?.['application/json'];
    if (content) {
      let body = sample(content.schema);
      if (path === '/api/auth/login') body = { email: '{{customer_email}}', password: '{{customer_password}}' };
      if (path === '/api/admin/staff') body = { fullName: 'Nhân viên Postman', phone: '{{staff_phone}}', password: '{{staff_password}}' };
      headers.push({ key: 'Content-Type', value: 'application/json' });
      request.body = { mode: 'raw', raw: JSON.stringify(body, null, 2).replace(/"__NUMBER_(\w+)__"/g, '{{$1}}'), options: { raw: { language: 'json' } } };
      description.push('Body mẫu điền sẵn các trường cần thiết. Schema đầy đủ (gồm trường tùy chọn):\n```json\n' + JSON.stringify(resolve(content.schema), null, 2) + '\n```');
      if (content.examples) description.push('Các ví dụ trên Swagger:\n```json\n' + JSON.stringify(content.examples, null, 2) + '\n```');
    }
    if (path === '/api/auth/login') {
      description.push('Đổi login_role thành CUSTOMER, BARISTA hoặc STAFF rồi Send. CUSTOMER giữ body đang hiển thị để nhập email/phone và password. BARISTA dùng barista_email/barista_password; STAFF dùng staff_phone/staff_password. Token tự lưu đúng vai trò. Chỉ BARISTA được tạo/xóa tài khoản nhân viên. /auth/me dùng tài khoản vừa đăng nhập.');
      pre.push("const role = String(pm.variables.get('login_role') || 'CUSTOMER').toUpperCase();\nif (!['CUSTOMER', 'BARISTA', 'STAFF'].includes(role)) { pm.execution.skipRequest(); throw new Error('login_role phải là CUSTOMER, BARISTA hoặc STAFF'); }\nif (role !== 'CUSTOMER') {\n  const login = role === 'STAFF' ? { phone: pm.variables.get('staff_phone'), password: pm.variables.get('staff_password') } : { email: pm.variables.get('barista_email'), password: pm.variables.get('barista_password') };\n  if (!login.password || !(login.email || login.phone)) { pm.execution.skipRequest(); throw new Error('Điền thông tin tài khoản ' + role + ' trước khi đăng nhập.'); }\n  pm.request.body.update(JSON.stringify(login));\n}");
    }
    if (/\{\{(?:\w+_id|size)\}\}/.test(route + (request.body?.raw || ''))) {
      pre.push("const used = pm.request.url.toString() + (pm.request.body?.raw || '');\nfor (const [, key] of used.matchAll(/\\{\\{(\\w+_id|size)\\}\\}/g)) {\n  if (!String(pm.variables.get(key) ?? '').trim()) { pm.execution.skipRequest(); throw new Error('Chưa có ' + key + ': gọi API danh sách/tạo mới tương ứng hoặc điền Variables trước khi gửi.'); }\n}");
    }
    const headerNames = new Set();
    for (const p of operation.parameters || []) if (p.in === 'header' && !headerNames.has(p.name.toLowerCase())) {
      headerNames.add(p.name.toLowerCase());
      if (p.name.toLowerCase() === 'idempotency-key') {
        const key = path === '/api/orders' ? 'order_key' : path === '/api/payments' ? 'payment_key' : path.endsWith('/receipts') ? 'receipt_key' : 'adjustment_key';
        headers.push({ key: 'Idempotency-Key', value: `{{${key}}}`, description: 'Giữ cùng key và body khi retry; xóa key trước khi tạo giao dịch mới.' });
        pre.push(`if (!vars.get('${key}')) vars.set('${key}', pm.variables.replaceIn('{{$guid}}'));`);
      } else headers.push({ key: p.name, value: '', disabled: !p.required, description: p.description || '' });
    }
    const callback = path.startsWith('/api/payments/vnpay/');
    if (callback) {
      // Keep the entire bank-signed query intact, including URL encoding.
      request.url = base + route + '?{{vnpay_callback_query}}';
      description.push('Điền vnpay_callback_query bằng TOÀN BỘ query thật sau dấu ? của URL callback VNPAY (vnp_TxnRef, vnp_Amount, vnp_ResponseCode, vnp_TransactionStatus, vnp_SecureHash, ...). Giữ nguyên giá trị và URL encoding; không dùng query của URL khởi tạo thanh toán. Return dùng token của khách sở hữu giao dịch.');
      pre.push("if (!pm.variables.get('vnpay_callback_query')) { pm.execution.skipRequest(); throw new Error('Điền vnpay_callback_query bằng query callback thật có chữ ký trước khi gửi.'); }");
    }
    const codes = Object.keys(operation.responses || {}).filter(c => /^2\d\d$/.test(c)).map(Number);
    const tests = [`pm.test('HTTP theo Swagger: ${codes.join('/')}', () => pm.expect(pm.response.code).to.be.oneOf(${JSON.stringify(codes)}));`];
    const saves = { '/api/inventory/ingredients': 'ingredient_id', '/api/products/toppings': 'topping_id', '/api/products': 'product_id', '/api/orders': 'order_id', '/api/admin/staff': 'staff_id' };
    if (method === 'post' && saves[path]) tests.push(`if (pm.response.code === 201) vars.set('${saves[path]}', String(pm.response.json().id));`);
    if (path === '/api/payments' && method === 'post') tests.push("if (pm.response.code === 201) { const p = pm.response.json().payment; vars.set('payment_id', String(p.id)); if (p.paymentUrl) vars.set('vnpay_payment_url', p.paymentUrl); }");
    if (path === '/api/auth/login' || path === '/api/auth/verify-otp') tests.push("if (pm.response.code === 200) { const data = pm.response.json(); const keys = { CUSTOMER: 'customer_token', BARISTA: 'barista_token', STAFF: 'staff_token' }; if (keys[data.user.role]) vars.set(keys[data.user.role], data.accessToken); vars.set('auth_token', data.accessToken); }");
    if (method === 'delete' && tag === 'admin/staff') tests.push("if (pm.response.code === 200) pm.test('Staff account removed', () => pm.expect(pm.response.json().deleted).to.eql(true));");
    if (method === 'get' && path === '/api/products') tests.push("if (pm.response.code === 200 && !vars.get('product_id')) { const p = pm.response.json().data.find(p => p.availability?.some(a => a.maxQuantity >= 1)); if (p) { vars.set('product_id', String(p.id)); vars.set('size', (p.availability.find(a => a.size === 'M' && a.maxQuantity >= 1) || p.availability.find(a => a.maxQuantity >= 1)).size); } }");
    if (method === 'get' && ['/api/inventory/ingredients', '/api/products/toppings', '/api/toppings'].includes(path)) {
      const key = path === '/api/inventory/ingredients' ? 'ingredient_id' : 'topping_id';
      tests.push(`if (pm.response.code === 200 && !vars.get('${key}')) { const data = pm.response.json(); if (data.length) vars.set('${key}', String(data[0].id)); }`);
    }
    if (path.endsWith('/vnpay/ipn')) tests.push("if (pm.response.code === 200) pm.test('IPN hợp lệ hoặc đã xử lý', () => pm.expect(pm.response.json().RspCode).to.be.oneOf(['00', '02']));");
    description.push('Mã phản hồi:\n' + Object.entries(operation.responses || {}).map(([code, r]) => `- ${code}: ${r.description || 'Theo backend'}`).join('\n'));
    request.description = description.filter(Boolean).join('\n\n');
    groups.get(tag).item.push({ name: `${method.toUpperCase()} ${path}${operation.summary ? ' — ' + operation.summary : ''}`, request, event: [...(pre.length ? [script('prerequest', pre.join('\n'))] : []), script('test', tests.join('\n'))], response: [] });
  }
  return [...groups.values()];
}
