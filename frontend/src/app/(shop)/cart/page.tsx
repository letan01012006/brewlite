"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCartStore } from "@/store/cart-store";
import { useAuthStore } from "@/store/auth-store";
import { getProductImageUrl } from "@/lib/constants/product-images";

export default function CartPage() {
  const router = useRouter();
  const {
    items,
    isHydrated,
    isRefreshing,
    cartError,
    notice,
    refreshCart,
    promoCode,
    discountAmount,
    isValidatingPromo,
    promoError,
    validatePromo,
    updateQuantity,
    removeItem,
    clearCart,
    setPromo,
    getSubtotal,
    getTotal,
    getTotalItemCount,
  } = useCartStore();

  const { user } = useAuthStore();

  useEffect(() => {
    if (!isHydrated) return;
    void refreshCart();
  }, [isHydrated, refreshCart, user?.id]);

  const [inputCode, setInputCode] = useState(() => promoCode || "");
  const subtotal = getSubtotal();
  const total = getTotal();
  const totalCount = getTotalItemCount();
  const estimatedPoints = Math.floor(total / 1000);
  const promoSuccessMsg =
    promoCode && !isValidatingPromo
      ? `Đã áp dụng mã ${promoCode} (Giảm ${discountAmount.toLocaleString("vi-VN")}₫)`
      : null;

  const handleApplyPromo = (event: React.FormEvent) => {
    event.preventDefault();
    void validatePromo(inputCode);
  };
  const handleRemovePromo = () => {
    setPromo(null, 0);
    setInputCode("");
  };
  const handleUpdateQty = updateQuantity;
  const handleRemoveItem = removeItem;

  // Chuyển sang trang checkout
  const handleProceedToCheckout = () => {
    if (
      useCartStore.getState().isValidatingPromo ||
      useCartStore.getState().isRefreshing ||
      !isHydrated ||
      cartError
    )
      return;
    if (!user) {
      // Nếu chưa đăng nhập, chuyển sang trang login với query redirect về checkout
      router.push("/login?redirect=/checkout");
    } else {
      router.push("/checkout");
    }
  };

  if (!isHydrated)
    return <p className="p-8 text-center">Đang khôi phục giỏ hàng...</p>;

  return (
    <div className="w-full py-8 sm:py-12">
      {notice && (
        <p
          role="status"
          className="p-3 mb-4 bg-amber-50 text-amber-900 rounded-xl light:text-cafe-primary "
        >
          {notice}
        </p>
      )}
      {cartError && (
        <div
          role="alert"
          className="p-3 mb-4 bg-rose-50 text-rose-700 rounded-xl"
        >
          <p>{cartError}</p>
          <button onClick={() => void refreshCart()} className="underline">
            Kiểm tra lại giỏ hàng
          </button>
        </div>
      )}
      {isRefreshing && <p role="status">Đang kiểm tra giá và tồn kho...</p>}
      {/* Tiêu đề & Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-4 border-b border-stone-200 dark:border-stone-800 light:border-cafe-line ">
        <div>
          <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400 mb-1 light:text-cafe-muted ">
            <Link href="/" className="hover:text-amber-800 dark:hover:text-amber-400 transition-colors light:hover:text-cafe-primary ">
              Trang chủ
            </Link>
            <span>/</span>
            <Link href="/menu" className="hover:text-amber-800 dark:hover:text-amber-400 transition-colors light:hover:text-cafe-primary ">
              Menu
            </Link>
            <span>/</span>
            <span className="text-stone-800 dark:text-stone-200 font-medium light:text-cafe-ink ">Giỏ hàng của bạn</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-stone-900 dark:text-stone-100 tracking-tight light:text-cafe-ink ">
            Giỏ Hàng <span className="text-amber-600 dark:text-amber-500 light:text-cafe-primary ">({totalCount} món)</span>
          </h1>
        </div>

        {items.length > 0 && (
          <button
            onClick={() => {
              if (
                confirm("Bạn có chắc chắn muốn xóa toàn bộ món trong giỏ hàng?")
              ) {
                clearCart();
                setPromo(null, 0);
              }
            }}
            className="text-xs text-stone-500 dark:text-stone-400 hover:text-rose-600 dark:hover:text-rose-400 flex items-center gap-1.5 transition-colors cursor-pointer self-start sm:self-auto light:text-cafe-muted "
          >
            <span>🗑️</span>
            <span>Xóa toàn bộ giỏ</span>
          </button>
        )}
      </div>

      {/* Trạng thái 1: Giỏ hàng trống */}
      {items.length === 0 ? (
        <div className="bg-white dark:bg-[#161210] rounded-3xl border border-[#ede5dc] dark:border-[#2a221c] p-12 sm:p-16 text-center max-w-lg mx-auto shadow-sm space-y-5 my-8 light:bg-cafe-surface light:border-cafe-line light:shadow-cafe-card ">
          <div className="w-20 h-20 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 flex items-center justify-center text-4xl mx-auto border border-amber-200/60 dark:border-amber-800/50 light:text-cafe-primary ">
            ☕
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-stone-900 dark:text-[#f4ede6] light:text-cafe-ink ">
              Giỏ hàng của bạn đang trống
            </h2>
            <p className="text-xs sm:text-sm text-stone-500 dark:text-[#a39589] max-w-xs mx-auto light:text-cafe-muted ">
              Chưa có ly đồ uống nào được chọn. Hãy khám phá menu cà phê thơm
              ngon của BrewLite nhé!
            </p>
          </div>
          <Link
            href="/menu"
            className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white font-bold text-sm px-6 py-3 rounded-xl shadow-md shadow-amber-600/20 transition-all active:scale-95 light:shadow-cafe-card cafe-primary "
          >
            <span>← Khám phá Menu chọn món</span>
          </Link>
        </div>
      ) : (
        /* Trạng thái 2: Giỏ hàng có món */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* CỘT TRÁI (8 cols): Danh sách các món trong giỏ */}
          <div className="lg:col-span-7 xl:col-span-8 space-y-4">
            {items.map((item) => {
              const imageSrc = getProductImageUrl(
                item.product.name,
                item.product.category,
                item.product.imageUrl,
              );

              return (
                <div
                  key={item.id}
                  className="bg-white dark:bg-[#181310] rounded-2xl border border-[#ede5dc] dark:border-[#281f19] p-4 sm:p-5 shadow-sm hover:shadow-md transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 light:bg-cafe-surface light:border-cafe-line light:shadow-cafe-card light:hover:shadow-cafe-card "
                >
                  {/* Ảnh và thông tin món */}
                  <div className="flex items-start gap-4 flex-1">
                    <div className="w-20 h-20 rounded-xl overflow-hidden bg-amber-50 dark:bg-[#201814] shrink-0 border border-amber-200/40 dark:border-[#33261f]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
              loading="lazy"
              decoding="async"
                        src={imageSrc}
                        alt={item.product.name}
                        className="w-full h-full object-cover"
                      />
                    </div>

                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-stone-900 dark:text-[#f4ede6] text-base light:text-cafe-ink ">
                          {item.product.name}
                        </h3>
                        <span className="text-[11px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 px-2 py-0.5 rounded-md border border-amber-200/50 dark:border-amber-800/40 light:text-cafe-primary ">
                          Size {item.size}
                        </span>
                      </div>

                      {/* Topping list */}
                      {item.selectedToppings.length > 0 && (
                        <div className="flex flex-wrap gap-1 text-[11px] text-stone-600 dark:text-[#a39589] light:text-cafe-muted ">
                          <span className="text-stone-400 dark:text-[#78695d] light:text-cafe-muted ">Topping:</span>
                          {item.selectedToppings.map((t) => (
                            <span
                              key={t.id}
                              className="bg-stone-100 dark:bg-[#231b16] text-stone-700 dark:text-[#cfc3b9] px-1.5 py-0.5 rounded border border-transparent dark:border-[#33261f] light:bg-cafe-soft light:text-cafe-ink "
                            >
                              +{t.name}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Ghi chú */}
                      {item.note && (
                        <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-950/40 px-2 py-0.5 rounded inline-block border border-amber-200/40 dark:border-amber-800/30 light:text-cafe-primary ">
                          ✍️ {item.note}
                        </p>
                      )}

                      <div className="text-xs font-semibold text-stone-500 dark:text-[#8e7e72] pt-0.5 light:text-cafe-muted ">
                        Đơn giá: {item.unitPrice.toLocaleString("vi-VN")}₫
                      </div>
                    </div>
                  </div>

                  {/* Bộ điều khiển số lượng và thành tiền */}
                  <div className="flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-[#ede5dc] dark:border-[#281f19] light:border-cafe-line ">
                    <div className="text-right">
                      <span className="text-base sm:text-lg font-bold text-amber-900 dark:text-amber-400 light:text-cafe-primary ">
                        {item.lineTotal.toLocaleString("vi-VN")}₫
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      {/* Tăng giảm số lượng */}
                      <div className="flex items-center border border-[#ede5dc] dark:border-[#2e241e] rounded-xl bg-stone-50 dark:bg-[#1f1915] shadow-sm overflow-hidden h-9 light:border-cafe-line light:bg-cafe-page light:shadow-cafe-card ">
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateQty(item.id, item.quantity - 1)
                          }
                          aria-label="Giảm"
                          className="w-9 h-9 flex items-center justify-center text-stone-600 dark:text-[#c4b6ab] hover:bg-stone-200 dark:hover:bg-[#281f19] active:scale-95 cursor-pointer transition-colors text-base font-bold light:text-cafe-muted light:hover:bg-cafe-line "
                        >
                          −
                        </button>
                        <span className="w-8 text-center font-bold text-xs text-stone-800 dark:text-[#f4ede6] light:text-cafe-ink ">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateQty(item.id, item.quantity + 1)
                          }
                          disabled={item.quantity >= 20}
                          aria-label="Tăng"
                          className="w-9 h-9 flex items-center justify-center text-stone-600 dark:text-[#c4b6ab] hover:bg-stone-200 dark:hover:bg-[#281f19] active:scale-95 disabled:opacity-40 cursor-pointer transition-colors text-base font-bold light:text-cafe-muted light:hover:bg-cafe-line "
                        >
                          +
                        </button>
                      </div>

                      {/* Nút Xóa */}
                      <button
                        onClick={() => handleRemoveItem(item.id)}
                        className="w-9 h-9 flex items-center justify-center text-stone-400 hover:text-rose-600 dark:hover:text-rose-400 p-1.5 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/30 active:scale-90 transition-all cursor-pointer text-sm light:text-cafe-muted "
                        title="Xóa món này"
                        aria-label="Xóa món"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Nút quay lại chọn thêm món */}
            <div className="pt-2">
              <Link
                href="/menu"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 transition-colors light:text-cafe-primary light:hover:text-cafe-primary "
              >
                <span>+ Thêm món khác vào giỏ</span>
              </Link>
            </div>
          </div>

          {/* CỘT PHẢI (5 cols): Khuyến mãi & Tóm tắt thanh toán */}
          <div className="lg:col-span-5 xl:col-span-4 space-y-5">
            {/* 1. Ô Nhập Voucher Khuyến Mãi */}
            <div className="bg-white dark:bg-[#161210] rounded-2xl border border-[#ede5dc] dark:border-[#2a221c] p-5 shadow-sm space-y-3 light:bg-cafe-surface light:border-cafe-line light:shadow-cafe-card ">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-stone-900 dark:text-[#f4ede6] text-sm flex items-center gap-1.5 light:text-cafe-ink ">
                  <span>🎟️</span>
                  <span>Mã khuyến mãi (Voucher)</span>
                </h3>
                <span className="text-[11px] text-amber-700 dark:text-amber-400 font-mono font-medium light:text-cafe-primary ">
                  Gợi ý: BREW10
                </span>
              </div>

              <form onSubmit={handleApplyPromo} className="flex gap-2">
                <input
                  type="text"
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                  placeholder="Nhập mã (BREW10, GIAM15K)..."
                  disabled={isValidatingPromo || isRefreshing}
                  className="flex-1 uppercase font-mono text-sm px-3.5 py-2.5 rounded-xl border border-[#ede5dc] dark:border-[#2a221c] bg-white dark:bg-[#1a1411] text-stone-900 dark:text-[#f4ede6] focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 placeholder:normal-case placeholder:font-sans placeholder:text-stone-400 dark:placeholder:text-[#6e5f54] light:border-cafe-line light:bg-cafe-surface light:text-cafe-ink light:focus:border-cafe-primary light:focus:ring-cafe-primary/20 light:placeholder:text-cafe-muted "
                />
                <button
                  type="submit"
                  disabled={isValidatingPromo || !inputCode.trim()}
                  className="bg-gradient-to-r from-amber-700 to-amber-800 hover:from-amber-600 hover:to-amber-700 disabled:opacity-40 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-sm transition-all cursor-pointer disabled:cursor-not-allowed light:shadow-cafe-card cafe-primary "
                >
                  {isValidatingPromo ? "Đang kiểm tra..." : "Áp dụng"}
                </button>
              </form>

              {/* Thông báo lỗi mã */}
              {promoError && (
                <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl p-2.5 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-1.5 animate-fadeIn">
                  <span className="shrink-0 mt-0.5">⚠️</span>
                  <span>{promoError}</span>
                </div>
              )}

              {/* Thông báo áp dụng thành công */}
              {promoSuccessMsg && (
                <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 rounded-xl p-2.5 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-1.5 animate-fadeIn">
                  <div className="flex items-center gap-1.5">
                    <span>✓</span>
                    <span className="font-medium">{promoSuccessMsg}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemovePromo}
                    className="text-emerald-700 dark:text-emerald-400 hover:text-rose-600 dark:hover:text-rose-400 font-semibold text-[11px] underline cursor-pointer"
                  >
                    Bỏ mã
                  </button>
                </div>
              )}
            </div>

            {/* 2. Bảng Tóm Tắt Chi Phí Đơn Hàng */}
            <div className="bg-white dark:bg-[#161210] rounded-2xl border border-[#ede5dc] dark:border-[#2a221c] p-5 shadow-sm space-y-4 light:bg-cafe-surface light:border-cafe-line light:shadow-cafe-card ">
              <h3 className="font-bold text-stone-900 dark:text-[#f4ede6] text-sm pb-2 border-b border-[#ede5dc] dark:border-[#2a221c] light:text-cafe-ink light:border-cafe-line ">
                Tóm tắt đơn hàng
              </h3>

              <div className="space-y-2.5 text-xs text-stone-600 dark:text-[#a39589] light:text-cafe-muted ">
                <div className="flex justify-between">
                  <span>Tiền hàng ({totalCount} ly):</span>
                  <span className="font-semibold text-stone-800 dark:text-[#f4ede6] font-mono light:text-cafe-ink ">
                    {subtotal.toLocaleString("vi-VN")}₫
                  </span>
                </div>

                <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                  <span>Giảm giá khuyến mãi:</span>
                  <span className="font-semibold font-mono">
                    {discountAmount > 0
                      ? `-${discountAmount.toLocaleString("vi-VN")}₫`
                      : "0₫"}
                  </span>
                </div>

                <div className="flex justify-between text-amber-700 dark:text-amber-400 pt-1 border-t border-dashed border-[#ede5dc] dark:border-[#2a221c] light:text-cafe-primary light:border-cafe-line ">
                  <span className="flex items-center gap-1">
                    <span>⭐</span>
                    <span>Tích lũy dự kiến:</span>
                  </span>
                  <span className="font-bold">+{estimatedPoints} điểm</span>
                </div>
              </div>

              {/* Tổng thanh toán */}
              <div className="pt-3 border-t border-[#ede5dc] dark:border-[#2a221c] flex items-baseline justify-between light:border-cafe-line ">
                <div>
                  <span className="text-sm font-bold text-stone-900 dark:text-[#f4ede6] block light:text-cafe-ink ">
                    Tổng thanh toán:
                  </span>
                  <span className="text-[11px] text-stone-400 dark:text-[#78695d] light:text-cafe-muted ">
                    (Đã bao gồm thuế GTGT)
                  </span>
                </div>
                <span className="text-2xl font-extrabold text-amber-900 dark:text-amber-400 font-mono light:text-cafe-primary ">
                  {total.toLocaleString("vi-VN")}₫
                </span>
              </div>

              {/* Nhắc nhở đăng nhập nếu chưa login */}
              {!user && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/50 rounded-xl p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1 light:text-cafe-primary ">
                  <div className="font-semibold">💡 Bạn chưa đăng nhập?</div>
                  <p className="text-[11px] text-amber-800/90 dark:text-amber-300/90 leading-relaxed light:text-cafe-primary ">
                    Đăng nhập để tự động tích điểm thưởng và theo dõi quá trình
                    pha chế của đơn hàng.
                  </p>
                </div>
              )}

              {/* Nút Tiến Hành Thanh Toán */}
              <button
                type="button"
                onClick={handleProceedToCheckout}
                disabled={isValidatingPromo || isRefreshing || !!cartError}
                className="w-full bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white font-bold text-sm py-3.5 px-4 rounded-xl shadow-md shadow-amber-600/25 transition-all flex items-center justify-center gap-2 active:scale-98 cursor-pointer light:shadow-cafe-card cafe-primary "
              >
                <span>
                  {isValidatingPromo
                    ? "Đang kiểm tra khuyến mãi..."
                    : "Tiến hành Đặt hàng & Thanh toán"}
                </span>
                <span>→</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
