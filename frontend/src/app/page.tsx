'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Product } from '@/types';
import { apiFetch } from '@/lib/api/client';
import { useAuthStore } from '@/store/auth-store';
import { ProductCard } from '@/components/products/product-card';

export default function LandingPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);

  useEffect(() => {
    // Tải 4 món nổi bật từ Backend
    apiFetch<{ data: Product[] }>('/products?limit=4')
      .then((res) => {
        setFeaturedProducts(res.data || []);
      })
      .catch(() => {
        // Fallback im lặng nếu backend chưa sẵn sàng
      });
  }, []);

  const handleOrderFeatured = (product: Product) => {
    if (!user) {
      const targetUrl = `/menu?openProduct=${product.id}`;
      router.push(`/login?redirect=${encodeURIComponent(targetUrl)}`);
      return;
    }
    router.push(`/menu?openProduct=${product.id}`);
  };

  return (
    <div className="min-h-screen dark:bg-stone-950 dark:text-stone-100 transition-colors">
      {/* 1. HERO SECTION - ẢNH CHỦ ĐẠO & CÂU GIỚI THIỆU */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#18120e] via-[#221812] to-[#140e0b] text-white py-16 sm:py-24 px-4 border-b border-[#2e2019]/60 dark:border-stone-850">
        {/* Glow hiệu ứng tinh tế */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-amber-500/10 blur-[120px] pointer-events-none rounded-full" />

        <div className="relative max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
          {/* Cột chữ giới thiệu */}
          <div className="lg:col-span-7 space-y-6 text-center lg:text-left">
            <span className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-400/25 text-amber-300 text-xs font-semibold px-4 py-1.5 rounded-full shadow-sm">
              <span>☕</span>
              <span>Chào mừng đến với Tiệm Cà Phê BrewLite</span>
            </span>

            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-tight sm:leading-[1.18]">
              <span className="block">Hương Vị Cà Phê</span>
              <span className="inline-block pt-1 pb-1 pr-3 bg-gradient-to-r from-amber-200 via-amber-400 to-amber-200 bg-clip-text text-transparent italic">
                Nguyên Bản Tinh Tế
              </span>
            </h1>

            <p className="text-sm sm:text-base text-stone-300/90 max-w-xl mx-auto lg:mx-0 leading-relaxed font-light">
              Từng hạt cà phê tuyển chọn được rang xay và pha chế theo chuẩn vị. Trải nghiệm đặt món trực tuyến, thanh toán không tiền mặt và nhận đồ uống ngay tại quầy không cần xếp hàng.
            </p>

            {/* Nút Khám phá menu nổi bật */}
            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3.5 pt-2">
              <Link
                href="/menu"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-stone-950 font-black text-sm px-8 py-3.5 rounded-2xl shadow-lg shadow-amber-500/25 transition-all active:scale-95 text-center"
              >
                <span>Khám Phá Menu Ngay</span>
                <span>→</span>
              </Link>

              <a
                href="#steps"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/15 text-amber-200 font-semibold text-sm px-6 py-3.5 rounded-2xl transition-all text-center"
              >
                <span>Cách thức đặt món</span>
                <span>↓</span>
              </a>
            </div>

            <div className="flex items-center justify-center lg:justify-start gap-6 pt-3 text-xs text-amber-300/80 font-medium">
              <div className="flex items-center gap-2">
                <span className="text-amber-400">✓</span>
                <span>100% Không tiền mặt</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-amber-400">✓</span>
                <span>Tích điểm thưởng mỗi đơn</span>
              </div>
            </div>
          </div>

          {/* Cột ảnh chủ đạo */}
          <div className="lg:col-span-5 flex justify-center">
            <div className="relative w-72 sm:w-88 aspect-square rounded-3xl overflow-hidden shadow-2xl border-4 border-amber-900/40 ring-1 ring-amber-500/20 group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=800&auto=format&fit=crop&q=80"
                alt="Không gian quán cà phê BrewLite"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent flex items-end p-5">
                <div>
                  <span className="text-[10px] text-amber-400 font-bold uppercase tracking-widest block mb-0.5">
                    Không gian mở ấm cúng
                  </span>
                  <span className="text-sm font-bold text-white">
                    Ghé thăm & thưởng thức tại chỗ hoặc mang đi
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. MÓN NỔI BẬT (FEATURED DRINKS) */}
      <section className="py-16 sm:py-24 px-4 max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
          <div>
            <span className="inline-block uppercase tracking-widest text-[11px] font-black text-amber-700 dark:text-amber-400 bg-amber-100/70 dark:bg-amber-950/50 px-3 py-1 rounded-full border border-amber-300/40 dark:border-amber-800/40 mb-2">
              Best-Sellers
            </span>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-stone-900 dark:text-stone-100 tracking-tight">
              Món Nổi Bật Được Yêu Thích
            </h2>
          </div>
          <Link
            href="/menu"
            className="text-xs font-bold text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 flex items-center gap-1.5 transition-colors self-start sm:self-auto py-1 px-3 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/40"
          >
            <span>Xem toàn bộ thực đơn</span>
            <span>→</span>
          </Link>
        </div>

        {featuredProducts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {featuredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onSelect={handleOrderFeatured}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-stone-400 dark:text-stone-500 text-xs">
            Đang tải món nổi bật...
          </div>
        )}
      </section>

      {/* 3. QUY TRÌNH 3 BƯỚC ĐẶT TRƯỚC, NHẬN TẠI QUẦY & TÍCH ĐIỂM */}
      <section id="steps" className="py-16 sm:py-24 bg-[#f4ece3] dark:bg-[#14100e] border-y border-[#e6d9cb] dark:border-[#241c17] px-4 transition-colors">
        <div className="max-w-5xl mx-auto text-center space-y-12">
          <div className="space-y-2">
            <span className="inline-block uppercase tracking-widest text-[11px] font-black text-amber-700 dark:text-amber-400 bg-amber-100/70 dark:bg-amber-950/50 px-3 py-1 rounded-full border border-amber-300/40 dark:border-amber-800/40 mb-1">
              Trải nghiệm thông minh
            </span>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-stone-900 dark:text-stone-100 tracking-tight">
              Quy Trình 3 Bước Tiện Lợi
            </h2>
            <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 max-w-md mx-auto">
              Không còn cảm giác mệt mỏi vì xếp hàng giờ cao điểm
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Bước 1 */}
            <div className="bg-white/95 dark:bg-[#1a1512] p-7 rounded-3xl border border-stone-200/70 dark:border-[#2a221c] shadow-[0_4px_20px_rgba(40,25,15,0.05)] dark:shadow-none hover:-translate-y-1 transition-all text-left space-y-3.5">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-700 text-white flex items-center justify-center text-xl font-black shadow-md shadow-amber-900/20">
                1
              </div>
              <h3 className="font-bold text-stone-900 dark:text-stone-100 text-base">
                Chọn món & Tùy biến
              </h3>
              <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
                Tự do chọn Size (S/M/L), thêm topping trân châu, thạch và ghi chú khẩu vị riêng (<i>Ít ngọt, ít đá</i>) ngay trên điện thoại hoặc máy tính.
              </p>
            </div>

            {/* Bước 2 */}
            <div className="bg-white/95 dark:bg-[#1a1512] p-7 rounded-3xl border border-stone-200/70 dark:border-[#2a221c] shadow-[0_4px_20px_rgba(40,25,15,0.05)] dark:shadow-none hover:-translate-y-1 transition-all text-left space-y-3.5">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-700 text-white flex items-center justify-center text-xl font-black shadow-md shadow-blue-900/20">
                2
              </div>
              <h3 className="font-bold text-stone-900 dark:text-stone-100 text-base">
                Thanh toán không tiền mặt
              </h3>
              <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
                Thanh toán tức thì qua Ví điện tử hoặc Thẻ ngân hàng. Mỗi 1.000₫ thanh toán đều được tự động tích 1 điểm thưởng thành viên.
              </p>
            </div>

            {/* Bước 3 */}
            <div className="bg-white/95 dark:bg-[#1a1512] p-7 rounded-3xl border border-stone-200/70 dark:border-[#2a221c] shadow-[0_4px_20px_rgba(40,25,15,0.05)] dark:shadow-none hover:-translate-y-1 transition-all text-left space-y-3.5">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white flex items-center justify-center text-xl font-black shadow-md shadow-emerald-900/20">
                3
              </div>
              <h3 className="font-bold text-stone-900 dark:text-stone-100 text-base">
                Nhận tại quầy liền tay
              </h3>
              <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
                Đơn hàng được gửi thẳng đến quầy Barista. Khi trạng thái chuyển sang "Sẵn sàng", bạn chỉ việc ghé quầy nhận đồ uống thơm ngon.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. ĐỊA CHỈ, GIỜ MỞ CỬA & LIÊN HỆ */}
      <section className="py-16 sm:py-24 px-4 max-w-6xl mx-auto">
        <div className="bg-gradient-to-br from-[#1c1410] via-[#241a14] to-[#140e0b] text-white rounded-3xl p-8 sm:p-12 shadow-2xl border border-amber-900/40 dark:border-[#2a221c] grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
          <div className="space-y-5">
            <span className="text-xs font-bold uppercase tracking-widest text-amber-400">
              Ghé thăm BrewLite
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Không Gian Cà Phê Yên Tĩnh & Thân Thiện
            </h2>
            <p className="text-xs sm:text-sm text-stone-300 leading-relaxed">
              Chúng tôi luôn sẵn sàng phục vụ những ly cà phê tươi mới mỗi ngày. Cho dù bạn cần một chỗ ngồi làm việc với Wi-Fi tốc độ cao, hay một góc nhỏ trò chuyện cùng bạn bè.
            </p>

            <div className="space-y-3 text-xs pt-2">
              <div className="flex items-start gap-3">
                <span className="text-base shrink-0">📍</span>
                <div>
                  <span className="font-bold text-white block">Địa chỉ quán:</span>
                  <span className="text-amber-200/90">123 Đường Cà Phê, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh</span>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="text-base shrink-0">⏰</span>
                <div>
                  <span className="font-bold text-white block">Giờ mở cửa:</span>
                  <span className="text-amber-200/90">07:00 – 22:00 (Mở cửa tất cả các ngày trong tuần)</span>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="text-base shrink-0">📞</span>
                <div>
                  <span className="font-bold text-white block">Hotline & Hỗ trợ:</span>
                  <span className="text-amber-200/90">1900 6868 • Email: contact@brewlite.com</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center p-6 sm:p-8 bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 text-center space-y-4">
            <span className="text-5xl">☕</span>
            <h3 className="text-lg font-bold text-amber-200">
              Sẵn sàng thưởng thức ly cà phê của bạn?
            </h3>
            <p className="text-xs text-stone-300 max-w-xs">
              Mã <span className="font-mono bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-bold border border-amber-400/30">BREW10</span> đang có hiệu lực giảm ngay 10% cho đơn hàng của bạn.
            </p>
            <Link
              href="/menu"
              className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-stone-950 font-black text-xs px-7 py-3.5 rounded-xl shadow-lg shadow-amber-500/20 transition-all active:scale-95"
            >
              Xem Menu & Đặt món ngay →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
