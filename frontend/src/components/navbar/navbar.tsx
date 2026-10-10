'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth-store';
import { useCartStore } from '@/store/cart-store';
import { ThemeToggle } from '@/components/theme/theme-toggle';

export function Navbar() {
  const { user, logout, initAuth, refreshUser, error } = useAuthStore();
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

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-md bg-[#1c1410]/95 dark:bg-[#0c0a09]/95 border-b border-[#2e2019]/60 dark:border-stone-850 text-stone-100 shadow-sm transition-colors duration-300">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-lg shadow-sm shadow-amber-900/30 group-hover:scale-105 transition-transform">
            ☕
          </div>
          <div className="flex flex-col">
            <span className="font-extrabold text-lg tracking-tight text-amber-100 group-hover:text-amber-200 transition-colors">
              BrewLite
            </span>
            <span className="text-[9px] uppercase tracking-widest text-amber-400/80 font-semibold -mt-1">
              Specialty Coffee
            </span>
          </div>
        </Link>

        {/* Navigation links */}
        <nav className="flex items-center gap-2 sm:gap-5 text-xs sm:text-sm font-medium">
          <Link
            href="/"
            className="text-stone-300 hover:text-amber-300 py-1.5 px-2.5 rounded-lg hover:bg-white/5 transition-all"
          >
            Trang chủ
          </Link>

          <Link
            href="/menu"
            className="text-stone-300 hover:text-amber-300 py-1.5 px-2.5 rounded-lg hover:bg-white/5 transition-all"
          >
            Menu
          </Link>

          {user && (
            <Link
              href="/orders"
              className="text-stone-300 hover:text-amber-300 py-1.5 px-2.5 rounded-lg hover:bg-white/5 transition-all"
            >
              Lịch sử đơn
            </Link>
          )}

          {user?.role === 'BARISTA' && (
            <Link
              href="/barista"
              className="text-amber-300 hover:text-amber-100 font-semibold bg-amber-900/40 dark:bg-stone-800/80 px-2.5 py-1 rounded-lg border border-amber-700/50 dark:border-stone-700 transition-colors"
            >
              Quầy Barista
            </Link>
          )}

          {/* Theme Toggle (Dark / Light) */}
          <ThemeToggle />

          {/* Cart Icon */}
          <Link
            href="/cart"
            className="relative p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 dark:border-stone-700 transition-all text-amber-200 hover:text-amber-100 flex items-center"
            aria-label="Giỏ hàng"
          >
            <svg
              className="w-5 h-5"
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
              <span className="absolute -top-1.5 -right-1.5 bg-gradient-to-r from-amber-500 to-amber-600 text-stone-950 text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center shadow-md">
                {totalItemCount > 9 ? '9+' : totalItemCount}
              </span>
            )}
          </Link>

          {/* Auth Button */}
          {user ? (
            <div className="flex items-center gap-2.5 pl-1 sm:pl-2">
              <div className="hidden sm:flex flex-col text-right">
                <span className="text-xs font-bold text-stone-200">
                  {user.fullName}
                </span>
                <span className="text-[10px] text-amber-400 font-medium">
                  ⭐ {user.loyaltyPoints.toLocaleString('vi-VN')} điểm
                  {error ? ' (lỗi đồng bộ)' : ''}
                </span>
              </div>
              <button
                onClick={logout}
                className="text-xs text-stone-300 hover:text-white bg-white/5 hover:bg-rose-950/40 hover:text-rose-300 hover:border-rose-800/50 px-2.5 py-1.5 rounded-xl border border-white/10 transition-all cursor-pointer"
              >
                Đăng xuất
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="text-xs font-bold bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white px-4 py-2 rounded-xl shadow-md shadow-amber-950/40 transition-all active:scale-95"
            >
              Đăng nhập
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
