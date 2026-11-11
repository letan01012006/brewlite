import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // The browser only contacts Next; the server forwards requests to Nest.
  async rewrites() {
    const backend = (process.env.BACKEND_API_URL || 'http://127.0.0.1:4000/api').replace(/\/$/, '');
    return [{ source: '/api/:path*', destination: `${backend}/:path*` }];
  },
  async headers() {
    // Keep the legacy worker URL fresh until the PWA retirement period ends.
    return [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }] }];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
