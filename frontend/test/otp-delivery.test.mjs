import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader, walk } from './load-source.mjs';

class ApiError extends Error {
  constructor(code) { super('SMS chưa được tiếp nhận'); this.code = code; }
}

for (const code of ['SMS_NOT_CONFIGURED', 'SMS_REJECTED', 'SMS_UNAVAILABLE', 'SMS_TIMEOUT']) {
  test(`registration ${code} leads to pending verification with immediate resend`, async () => {
    const paths = [];
    const values = ['SMS Test', '0911111111', '', 'Password@123', 'Password@123'];
    let index = 0;
    const load = sourceLoader({
      react: { Suspense: 'suspense', useState: initial => [values[index++] ?? initial, () => {}] },
      'next/navigation': { useRouter: () => ({ push: path => paths.push(path) }), useSearchParams: () => new URLSearchParams('redirect=/menu') },
      '@/lib/api/client': { ApiError, apiFetch: async () => { throw new ApiError(code); } },
    });
    const page = load('src/app/(auth)/register/page.tsx').default();
    const form = walk(page.props.children.type(), node => node.type === 'form')[0];
    await form.props.onSubmit({ preventDefault() {} });
    assert.equal(paths.length, 1);
    const url = new URL(paths[0], 'http://localhost');
    assert.equal(url.pathname, '/verify-otp');
    assert.equal(url.searchParams.get('phone'), '0911111111');
    assert.equal(url.searchParams.get('deliveryFailed'), '1');
    assert.equal(url.searchParams.has('resendAfter'), false);
    assert.equal(url.searchParams.get('redirect'), '/menu');
  });
}

test('pending screen explains delivery failure and leaves resend enabled', () => {
  const load = sourceLoader({
    react: { Suspense: 'suspense', useState: initial => [initial, () => {}], useEffect() {} },
    'next/navigation': { useRouter: () => ({}), useSearchParams: () => new URLSearchParams('phone=0911111111&deliveryFailed=1') },
    '@/store/auth-store': { useAuthStore: selector => selector({ setAuth() {} }) },
  });
  const page = load('src/app/(auth)/verify-otp/page.tsx').default();
  const tree = page.props.children.type();
  const message = walk(tree, node => node.props?.role === 'status')[0];
  assert.match(message.props.children, /chưa được xác nhận gửi thành công/);
  const resend = walk(tree, node => node.type === 'button' && node.props.onClick)[0];
  assert.equal(resend.props.disabled, false);
});
