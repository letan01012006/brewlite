import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    env: { OTP_HASH_SECRET: 'test-only-otp-hmac-secret-at-least-32-characters', AUTH_OTP_DEMO: 'false' },
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});
