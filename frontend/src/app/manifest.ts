import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BrewLite - Tiệm Cà Phê Không Tiền Mặt',
    short_name: 'BrewLite',
    description: 'Ứng dụng đặt cà phê trực tuyến & thanh toán không dùng tiền mặt',
    start_url: '/',
    display: 'standalone',
    background_color: '#1c1410',
    theme_color: '#1c1410',
    orientation: 'portrait',
    scope: '/',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  };
}
