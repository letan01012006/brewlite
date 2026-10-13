import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hostname used by the phone on this LAN; no protocol or port here.
  allowedDevOrigins: ['192.168.100.8'],
  // The browser only contacts Next; the server forwards requests to Nest.
  async rewrites() {
    const backend = (process.env.BACKEND_API_URL || 'http://127.0.0.1:4000/api').replace(/\/$/, '');
    return [{ source: '/api/:path*', destination: `${backend}/:path*` }];
  },
  async headers() {
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
