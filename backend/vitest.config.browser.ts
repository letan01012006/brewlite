import base from './vitest.config.e2e.js';

// Frontend defaults to http://localhost:3001; override PRODUCT_TEST_ORIGIN for dev.
export default {
  ...base,
  test: {
    ...base.test,
    include: ['test/product-setup.browser.ts'],
    testTimeout: 60000,
  },
};
