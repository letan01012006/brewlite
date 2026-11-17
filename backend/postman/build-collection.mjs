import { writeFileSync } from 'node:fs';
import { swaggerGroups } from './swagger-collection.mjs';

const values = {
  base_url: 'http://127.0.0.1:4001/api', login_role: 'CUSTOMER',
  customer_email: 'demo@brewlite.com', customer_password: 'Demo@1234',
  barista_email: 'barista@brewlite.com', barista_password: 'Barista@123',
  register_phone: '', register_password: 'Postman@123', otp_code: '',
  staff_phone: '', staff_password: 'Staff@123', staff_id: '',
  customer_token: '', barista_token: '', staff_token: '', auth_token: '',
  product_id: '', size: 'M', topping_id: '', ingredient_id: '', order_id: '', payment_id: '',
  promo_code: 'BREW10', order_key: '', payment_key: '', receipt_key: '', adjustment_key: '',
  vnpay_callback_query: '', vnpay_payment_url: '',
};
const groups = swaggerGroups();
const count = groups.reduce((n, group) => n + group.item.length, 0);
const collection = {
  info: {
    _postman_id: 'c3418aaf-ea8b-4db4-b7ba-2285eb401c24', name: 'BrewLite API - Docker 4001',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    description: `${count} endpoint chia nhóm giống Swagger Docker 4001. Đăng nhập ở auth → POST /api/auth/login: CUSTOMER dùng body đang hiển thị; BARISTA dùng tài khoản demo; STAFF dùng staff_phone/staff_password. Chỉ BARISTA cấp/xóa tài khoản STAFF qua admin/staff bằng barista_token. STAFF đăng nhập ngay không cần OTP, không được cấp/xóa tài khoản. Xóa thu hồi đăng nhập/JWT nhưng giữ lịch sử. Token lưu theo vai trò; /auth/me dùng auth_token. API 4001 dùng chung database với website 3001. Gửi từng request với ID/trạng thái phù hợp; xem backend/postman/README.md.`,
  },
  auth: { type: 'noauth' }, item: groups,
  variable: Object.entries(values).map(([key, value]) => ({ key, value, type: 'string' })),
};
const environment = {
  id: '79e2df09-3560-4956-a8a7-229bbdb2aa24', name: 'BrewLite Docker 4001', _postman_variable_scope: 'environment',
  values: Object.entries(values).map(([key, value]) => ({ key, value, enabled: true, type: /password|token|otp_code/.test(key) ? 'secret' : 'default' })),
};
writeFileSync(new URL('BrewLite.postman_collection.json', import.meta.url), JSON.stringify(collection, null, 2) + '\n');
if (!process.argv.includes('--collection-only')) writeFileSync(new URL('BrewLite-Local.postman_environment.json', import.meta.url), JSON.stringify(environment, null, 2) + '\n');
console.log(`Generated ${count} Swagger requests in ${groups.length} top-level groups.`);
