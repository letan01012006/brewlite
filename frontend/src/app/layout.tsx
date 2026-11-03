import type { Metadata, Viewport } from 'next';
import { Inter, Geist_Mono } from 'next/font/google';
import './globals.css';
import { LegacyPwaCleanup } from '@/components/layout/legacy-pwa-cleanup';

const inter = Inter({
  variable: '--font-geist-sans',
  subsets: ['latin', 'vietnamese'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const viewport: Viewport = {
  themeColor: '#1c1410',
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'BrewLite - Tiệm Cà Phê Không Tiền Mặt',
  description: 'Đặt cà phê nhanh chóng, thanh toán không tiền mặt và tích điểm thông minh.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="vi"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const stored = localStorage.getItem('brewlite_theme');
                  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  if (stored === 'dark' || (!stored && prefersDark)) {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 transition-colors duration-200 light:bg-cafe-page light:text-cafe-ink ">
        <div className="flex-1 flex flex-col">{children}</div>
        <LegacyPwaCleanup />
      </body>
    </html>
  );
}
