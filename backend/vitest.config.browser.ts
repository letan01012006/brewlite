import base from './vitest.config.e2e.js';

// Manual browser suite: frontend must be running at http://localhost:3000.
export default {
  ...base,
  test: {
    ...base.test,
    include: ['test/product-setup.browser.ts'],
    testTimeout: 60000,
  },
};
