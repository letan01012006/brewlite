'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';

export default function OfflinePage() {
  useEffect(() => {
    const handleOnline = () => {
      window.location.reload();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  const handleRetry = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-900 text-stone-100 p-4">
      <div className="max-w-md w-full bg-stone-850/90 backdrop-blur border border-stone-800 rounded-3xl p-8 text-center shadow-2xl">
        <div className="relative w-24 h-24 mx-auto mb-6 flex items-center justify-center rounded-2xl bg-gradient-to-br from-amber-600/30 to-amber-900/40 border border-amber-600/30">
          <span className="text-5xl select-none">☕</span>
          <span className="absolute -top-2 -right-2 px-2.5 py-0.5 text-[11px] font-bold uppercase rounded-full bg-red-600 text-white shadow">
            Mất mạng
          </span>
        </div>

        <h1 className="text-2xl font-extrabold text-amber-100 mb-2">
          Bạn đang ngoại tuyến
        </h1>
        <p className="text-sm text-stone-400 mb-8 leading-relaxed">
          Không có kết nối Internet. Vui lòng kiểm tra Wi-Fi hoặc dữ liệu di động (4G/5G) để tiếp tục đặt cà phê tại BrewLite.
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={handleRetry}
            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white font-bold text-sm shadow-lg shadow-amber-900/40 active:scale-[0.98] transition-all"
          >
            🔄 Thử kết nối lại
          </button>
          <Link
            href="/"
            className="w-full py-3 px-4 rounded-xl bg-stone-800/80 hover:bg-stone-700/80 text-stone-300 font-semibold text-sm transition-all text-center"
          >
            Về trang chủ
          </Link>
        </div>

        <div className="mt-8 pt-6 border-t border-stone-800/80 text-xs text-stone-500">
          BrewLite PWA • Trải nghiệm đặt cà phê không tiền mặt
        </div>
      </div>
    </div>
  );
}
