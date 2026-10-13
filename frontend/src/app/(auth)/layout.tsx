import React from 'react';
import Link from 'next/link';
import { ThemeToggle } from '@/components/theme/theme-toggle';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen bg-stone-50 dark:bg-[#0c0a09] text-stone-900 dark:text-stone-100 relative overflow-hidden transition-colors">
      {/* Background ambient warm coffee glow for desktop */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/5 dark:bg-amber-500/10 blur-[140px] rounded-full pointer-events-none" />

      {/* Responsive Top Bar across full width on desktop */}
      <header className="w-full max-w-7xl mx-auto h-[var(--app-header-height)] pt-[env(safe-area-inset-top,0px)] px-4 sm:px-6 lg:px-8 flex items-center justify-between shrink-0 relative z-10">
        <Link
          href="/"
          className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-stone-600 hover:text-amber-600 dark:text-stone-300 dark:hover:text-amber-400 transition-colors group"
        >
          <span className="w-7 h-7 rounded-lg bg-stone-200/80 dark:bg-stone-800 flex items-center justify-center text-xs group-hover:-translate-x-0.5 transition-transform">
            ←
          </span>
          <span>Về trang chủ</span>
        </Link>

        {/* Brand center on tablet/desktop */}
        <Link href="/" className="hidden sm:flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-sm shadow">
            ☕
          </div>
          <span className="font-extrabold text-sm tracking-tight text-amber-100">
            BrewLite
          </span>
        </Link>

        <div className="flex items-center gap-3">
          <ThemeToggle />
        </div>
      </header>

      {/* Centered Auth Card Viewport */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 relative z-10">
        <div className="w-full max-w-md sm:max-w-md">{children}</div>
      </main>
    </div>
  );
}
