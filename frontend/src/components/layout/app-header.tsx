'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth-store';
import { useCartStore } from '@/store/cart-store';
import { ThemeToggle } from '@/components/theme/theme-toggle';

export function AppHeader() {
  const pathname = usePathname();
  const { user, logout, initAuth, refreshUser } = useAuthStore();
  const totalItemCount = useCartStore((state) => state.getTotalItemCount());

  useEffect(() => {
    void initAuth();
    const sync = () => {
      void initAuth().then(() => useAuthStore.getState().refreshUser());
    };
    const storage = (event: StorageEvent) => {
      if (event.key === 'brewlite_token' || event.key === null) void initAuth();
    };
    window.addEventListener('focus', sync);
    window.addEventListener('storage', storage);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshUser();
    }, 30000);
    return () => {
      window.removeEventListener('focus', sync);
      window.removeEventListener('storage', storage);
      clearInterval(interval);
    };
  }, [initAuth, refreshUser]);

  const firstName = user?.fullName ? user.fullName.trim().split(' ').slice(-1)[0] : null;

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-md bg-[#1c1410]/95 dark:bg-[#0c0a09]/95 border-b border-[#2e2019]/60 dark:border-stone-850 text-stone-100 shadow-sm transition-colors duration-200 pt-[env(safe-area-inset-top,0px)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Left: Logo & Brand */}
        <Link href="/" className="flex items-center gap-2 group shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-base shadow-sm shadow-amber-900/30 group-hover:scale-105 transition-transform">
            ☕
          </div>
          <div className="flex flex-col">
            <span className="font-extrabold text-base tracking-tight text-amber-100 group-hover:text-amber-200 transition-colors leading-none">
              BrewLite
            </span>
            <span className="text-[8px] uppercase tracking-widest text-amber-400/80 font-semibold mt-0.5">
              Coffee & Pay
            </span>
          </div>
        </Link>

        {/* Center: Desktop Navigation Bar (hidden on mobile, shown on md:) */}
        <nav className="hidden md:flex items-center gap-4 lg:gap-8 text-sm font-semibold ml-4 mr-auto">
          <Link
            href="/"
            className={`transition-colors py-1 ${
              pathname === '/'
                ? 'text-amber-400 font-extrabold border-b-2 border-amber-400'
                : 'text-stone-300 hover:text-white'
            }`}
          >
            Trang chủ
          </Link>
          <Link
            href="/menu"
            className={`transition-colors py-1 ${
              pathname.startsWith('/menu')
                ? 'text-amber-400 font-extrabold border-b-2 border-amber-400'
                : 'text-stone-300 hover:text-white'
            }`}
          >
            Thực đơn
          </Link>
          <Link
            href="/orders"
            className={`transition-colors py-1 ${
              pathname.startsWith('/orders')
                ? 'text-amber-400 font-extrabold border-b-2 border-amber-400'
                : 'text-stone-300 hover:text-white'
            }`}
          >
            Đơn hàng
          </Link>
        </nav>

        {/* Center/Mobile: Greeting or Loyalty Points */}
        <div className="hidden lg:flex lg:flex-initial items-center justify-center md:justify-end min-w-0">
          {user ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs">
              <span className="text-stone-300 truncate max-w-[90px] sm:max-w-[150px]">
                {firstName ? `Chào, ${firstName}` : 'Thành viên'}
              </span>
              <span className="text-amber-400 font-bold shrink-0">
                ⭐ {user.loyaltyPoints ?? 0}đ
              </span>
            </div>
          ) : (
            <span className="text-xs text-stone-400 hidden sm:inline md:hidden truncate">
              Đặt nhanh • Tích điểm thông minh
            </span>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {user?.role === 'BARISTA' && (
            <Link
              href="/barista"
              className="text-[11px] font-bold text-amber-300 hover:text-amber-100 bg-amber-900/50 px-2 py-1 rounded-lg border border-amber-600/40 transition-colors"
            >
              Barista
            </Link>
          )}

          <ThemeToggle />

          {/* Quick Cart Button */}
          <Link
            href="/cart"
            aria-label="Giỏ hàng"
            className="relative p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-amber-200 hover:text-amber-100 transition-all active:scale-95 flex items-center justify-center"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
              />
            </svg>
            {totalItemCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-amber-500 text-stone-950 text-[10px] font-extrabold rounded-full flex items-center justify-center shadow-md animate-pulse">
                {totalItemCount > 99 ? '99+' : totalItemCount}
              </span>
            )}
          </Link>

          {/* User Profile or Logout */}
          {user ? (
            <button
              onClick={() => logout()}
              title="Đăng xuất"
              aria-label="Đăng xuất"
              className="p-1.5 text-stone-400 hover:text-red-300 hover:bg-red-950/30 rounded-lg transition-colors text-xs"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          ) : (
            <Link
              href="/login"
              className="text-xs font-semibold px-2.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 transition-colors shadow-sm"
            >
              Đăng nhập
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
