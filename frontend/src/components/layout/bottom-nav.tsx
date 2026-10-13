'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCartStore } from '@/store/cart-store';
import { useAuthStore } from '@/store/auth-store';

export function BottomNav() {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const totalItemCount = useCartStore((state) => state.getTotalItemCount());
  const totalMoney = useCartStore((state) => state.getTotal());
  const isHydrated = useCartStore((state) => state.isHydrated);

  // Don't show floating cart on cart or checkout pages
  const showFloatingCart =
    isHydrated &&
    totalItemCount > 0 &&
    !pathname.startsWith('/cart') &&
    !pathname.startsWith('/checkout');

  const navItems = [
    {
      label: 'Trang chủ',
      href: '/',
      active: pathname === '/',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={pathname === '/' ? 2.5 : 1.8}
            d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
          />
        </svg>
      ),
    },
    {
      label: 'Menu',
      href: '/menu',
      active: pathname.startsWith('/menu'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={pathname.startsWith('/menu') ? 2.5 : 1.8}
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </svg>
      ),
    },
    {
      label: 'Đơn hàng',
      href: '/orders',
      active: pathname.startsWith('/orders'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={pathname.startsWith('/orders') ? 2.5 : 1.8}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
          />
        </svg>
      ),
    },
    {
      label: user ? 'Tài khoản' : 'Đăng nhập',
      href: user ? (user.role === 'BARISTA' ? '/barista' : '/orders') : '/login',
      active:
        pathname.startsWith('/login') ||
        pathname.startsWith('/register') ||
        pathname.startsWith('/barista'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={
              pathname.startsWith('/login') || pathname.startsWith('/barista') ? 2.5 : 1.8
            }
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
      ),
    },
  ];

  return (
    <>
      {/* Floating Cart Bar (Appears only on mobile/tablet when cart has items) */}
      {showFloatingCart && (
        <div className="fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] left-0 right-0 z-40 px-4 pointer-events-none md:hidden">
          <div className="max-w-md mx-auto pointer-events-auto">
            <Link
              href="/cart"
              className="flex items-center justify-between p-3 rounded-2xl bg-gradient-to-r from-amber-600 to-amber-700 text-white shadow-xl shadow-amber-950/40 hover:from-amber-500 hover:to-amber-600 active:scale-[0.98] transition-all border border-amber-400/30"
            >
              <div className="flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-black shadow-inner">
                  {totalItemCount}
                </span>
                <div className="flex flex-col">
                  <span className="text-[11px] font-semibold text-amber-100 uppercase tracking-wider">
                    Giỏ hàng của bạn
                  </span>
                  <span className="text-sm font-extrabold">
                    {totalMoney.toLocaleString('vi-VN')}đ
                  </span>
                </div>
              </div>
              <span className="text-xs font-bold bg-white text-stone-900 px-3 py-1.5 rounded-xl shadow-sm flex items-center gap-1">
                Xem giỏ →
              </span>
            </Link>
          </div>
        </div>
      )}

      {/* Bottom Navigation Bar (Mobile only, hidden on md: and up) */}
      <nav
        aria-label="Điều hướng chính di động"
        className="fixed bottom-0 left-0 right-0 z-40 bg-[#1c1410]/95 dark:bg-[#0c0a09]/95 backdrop-blur-lg border-t border-[#2e2019]/70 dark:border-stone-850 text-stone-300 shadow-2xl transition-colors duration-200 pb-[env(safe-area-inset-bottom,0px)] md:hidden"
      >
        <div className="max-w-md mx-auto px-2 h-16 flex items-center justify-around">
          {navItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={`flex flex-col items-center justify-center flex-1 py-1 px-1 rounded-xl transition-all duration-150 relative active:scale-90 ${
                item.active
                  ? 'text-amber-400 font-extrabold'
                  : 'text-stone-400 hover:text-stone-200 font-medium'
              }`}
            >
              <div className="relative">
                {item.icon}
                {/* Badge on Menu tab or Orders */}
                {item.label === 'Menu' && totalItemCount > 0 && !item.active && (
                  <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-stone-950 text-[9px] font-black flex items-center justify-center shadow">
                    {totalItemCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] mt-1 tracking-tight leading-none">
                {item.label}
              </span>
              {item.active && (
                <span className="w-1 h-1 rounded-full bg-amber-400 mt-0.5" />
              )}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
