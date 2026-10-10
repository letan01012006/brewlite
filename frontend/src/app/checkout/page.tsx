"use client";

import { apiFetch } from "@/lib/api/client";
import { AuthGate } from "@/components/auth/auth-gate";
import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCartStore } from "@/store/cart-store";
import { useAuthStore } from "@/store/auth-store";
import type { Order, PaymentMethod } from "@/types";
import { CheckoutFlow, type CheckoutSession } from "@/lib/checkout-flow";
import { cartKey, orderItems } from "@/lib/order-payload";

function checkoutFlow(token?: string) {
  return new CheckoutFlow(window.sessionStorage, (path, options) =>
    apiFetch(path, { ...options, token }),
  );
}

export default function CheckoutPage() {
  const userId = useAuthStore((state) => state.user?.id);
  return (
    <AuthGate path="/checkout">
      <CheckoutContent key={userId} />
    </AuthGate>
  );
}

function CheckoutContent() {
  const router = useRouter();
  const {
    items,
    promoCode: cartPromoCode,
    discountAmount: cartDiscount,
    isValidatingPromo,
    isRefreshing,
    isHydrated,
    getSubtotal,
    getTotal,
    clearCart,
  } = useCartStore();

  const { user, token, initAuth, isLoading: isLoadingAuth } = useAuthStore();

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("WALLET");
  const [mockResult, setMockResult] = useState<"SUCCESS" | "FAILED">("SUCCESS");

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successOrder, setSuccessOrder] = useState<Order | null>(null);

  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [recoveryId, setRecoveryId] = useState("");
  const busy = useRef(false);
  const order = session?.order;
  const subtotal = order?.subtotal ?? getSubtotal();
  const total = order?.total ?? getTotal();
  const discountAmount = order?.discountAmount ?? cartDiscount;
  const promoCode = order ? order.promoCode : cartPromoCode;
  const pointsEarned = successOrder?.pointsEarned ?? Math.floor(total / 1000);
  const displayItems = order
    ? order.items.map((item) => ({
        id: String(item.id),
        product: { name: item.productName },
        size: item.size,
        quantity: item.qty,
        lineTotal: item.lineTotal,
      }))
    : items;

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const restored = useAuthStore.getState().user
          ? checkoutFlow().read(useAuthStore.getState().user!.id)
          : null;
        setSession(restored);
        setSuccessOrder(
          restored?.phase === "paid" ? (restored.order ?? null) : null,
        );
        if (restored?.paidMethod) setPaymentMethod(restored.paidMethod);
        else if (restored?.attempt) {
          setPaymentMethod(restored.attempt.method);
          setMockResult(restored.attempt.mockResult);
        }
      } catch {
        setErrorMsg(
          "Không thể khôi phục phiên đặt hàng. Vui lòng kiểm tra bộ nhớ trình duyệt và lịch sử đơn hàng.",
        );
      }
      setIsRestoring(false);
    });
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  // Kiểm tra nếu chưa đăng nhập hoặc giỏ hàng trống
  useEffect(() => {
    if (!token && typeof window !== "undefined") {
      const stored = localStorage.getItem("brewlite_token");
      if (!stored) {
        router.push("/login?redirect=/checkout");
      }
    }
  }, [token, router]);

  if (isRestoring || isLoadingAuth || !isHydrated)
    return <p className="p-8 text-center">Đang khôi phục đơn hàng...</p>;

  // Nếu đã đặt hàng thành công, hiển thị màn hình chúc mừng
  if (successOrder) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 text-center animate-fadeIn">
        <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200/80 dark:border-stone-800 p-8 sm:p-12 shadow-xl space-y-6">
          <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-4xl mx-auto border border-emerald-200 dark:border-emerald-800 shadow-sm animate-bounce">
            ✓
          </div>

          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-950/50 px-3 py-1 rounded-full border border-emerald-200/50 dark:border-emerald-800/50">
              Thanh Toán Thành Công
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-stone-900 dark:text-stone-100">
              Cảm ơn bạn đã đặt món!
            </h1>
            <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 max-w-sm mx-auto">
              Đơn hàng của bạn đã được chuyển tới quầy pha chế của Barista.
            </p>
          </div>

          {/* Chi tiết đơn tóm tắt */}
          <div className="bg-stone-50 dark:bg-stone-800/80 rounded-2xl p-4.5 border border-stone-200/70 dark:border-stone-700 text-left space-y-2.5 text-xs text-stone-600 dark:text-stone-300">
            <div className="flex justify-between">
              <span className="text-stone-400 dark:text-stone-500">Mã đơn hàng:</span>
              <span className="font-bold text-stone-900 dark:text-stone-100 font-mono text-sm">
                #{successOrder.id}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-400 dark:text-stone-500">Phương thức:</span>
              <span className="font-semibold text-stone-800 dark:text-stone-200">
                {paymentMethod === "WALLET" ? "Ví điện tử" : "Thẻ ngân hàng"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-400 dark:text-stone-500">Tổng thanh toán:</span>
              <span className="font-extrabold text-amber-900 dark:text-amber-400 font-mono text-sm">
                {successOrder.total.toLocaleString("vi-VN")}₫
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t border-stone-200 dark:border-stone-700 text-amber-800 dark:text-amber-400">
              <span>⭐ Điểm tích lũy nhận được:</span>
              <span className="font-bold">+{pointsEarned} điểm</span>
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-3">
            <Link
              href="/orders"
              onClick={() => user && checkoutFlow().clear(user.id)}
              className="flex-1 py-3 px-4 rounded-xl font-bold text-xs sm:text-sm bg-amber-600 hover:bg-amber-700 text-white shadow-md shadow-amber-600/20 transition-all text-center"
            >
              Theo dõi đơn hàng của tôi →
            </Link>
            <Link
              href="/menu"
              onClick={() => user && checkoutFlow().clear(user.id)}
              className="py-3 px-5 rounded-xl font-semibold text-xs sm:text-sm bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200 transition-colors text-center"
            >
              Về Menu chính
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Nếu giỏ hàng trống (chưa đặt thành công)
  if (items.length === 0 && !session) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center space-y-4">
        <div className="text-5xl">☕</div>
        <h2 className="text-xl font-bold text-stone-800">
          Giỏ hàng của bạn đang trống
        </h2>
        <p className="text-xs text-stone-500">
          Vui lòng chọn món trước khi tiến hành thanh toán.
        </p>
        <Link
          href="/"
          className="inline-block bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-sm transition-all"
        >
          Quay lại Menu đặt món
        </Link>
      </div>
    );
  }

  const runAction = async (action: () => Promise<void>) => {
    if (busy.current || !user || !token) return;
    busy.current = true;
    setIsProcessing(true);
    setErrorMsg(null);
    try {
      await action();
    } catch (error) {
      setErrorMsg(
        error instanceof Error ? error.message : "Không thể xử lý đơn hàng.",
      );
    } finally {
      try {
        setSession(checkoutFlow().read(user.id));
      } catch {
        /* Keep the visible snapshot. */
      }
      busy.current = false;
      setIsProcessing(false);
    }
  };

  const handlePayOrder = () =>
    runAction(async () => {
      if (!user || useCartStore.getState().isValidatingPromo) return;
      const flow = checkoutFlow(token!);
      if (!flow.read(user.id)) {
        if (!(await useCartStore.getState().refreshCart()))
          throw new Error(
            useCartStore.getState().cartError ||
              "Giỏ hàng đang được cập nhật. Vui lòng thử lại.",
          );
        if (useAuthStore.getState().token !== token) return;
        const refreshed = useCartStore.getState();
        if (!refreshed.items.length)
          throw new Error(
            "Giỏ hàng không còn món khả dụng. Vui lòng chọn món khác.",
          );
        if (refreshed.getTotal() !== total)
          throw new Error(
            "Giá hoặc khuyến mãi đã thay đổi. Vui lòng kiểm tra tổng tiền và xác nhận lại.",
          );
      }
      const current = useCartStore.getState();
      const prepared = await flow.prepare(
        user.id,
        cartKey(current.items, current.promoCode),
        {
          items: orderItems(current.items),
          promoCode: current.promoCode || undefined,
        },
      );
      setSession(prepared);
      // Creation fixes the server price. Never charge an amount the customer has
      // not seen: a changed total requires a second explicit confirmation.
      if (prepared.order!.total !== total) {
        setErrorMsg(
          `Tổng tiền được cập nhật thành ${prepared.order!.total.toLocaleString("vi-VN")}₫. Vui lòng kiểm tra và xác nhận lại, hoặc hủy đơn để sửa giỏ hàng.`,
        );
        return;
      }
      if (useAuthStore.getState().token !== token) return;
      const paid = await flow.pay(user.id, paymentMethod, mockResult);
      if (paid.order && useAuthStore.getState().token === token) {
        const latest = useCartStore.getState();
        if (cartKey(latest.items, latest.promoCode) === paid.cartKey)
          clearCart();
        setSuccessOrder(paid.order);
        setPaymentMethod(paid.paidMethod ?? paymentMethod);
        // The receipt stays in component state; a later visit can start a new
        // purchase even when the customer leaves through the global navbar.
        flow.clear(user.id);
        await useAuthStore.getState().refreshUser();
      }
    });

  const handleCancel = () => {
    if (
      !user ||
      !confirm("Hủy đơn này để hoàn lại tồn kho và chỉnh sửa giỏ hàng?")
    )
      return;
    void runAction(async () => {
      await checkoutFlow(token!).cancel(user.id);
      await useAuthStore.getState().refreshUser();
    });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 sm:py-12">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400 mb-2">
        <Link href="/" className="hover:text-amber-800 dark:hover:text-amber-400">
          Trang chủ
        </Link>
        <span>/</span>
        <Link href="/menu" className="hover:text-amber-800 dark:hover:text-amber-400">
          Menu
        </Link>
        <span>/</span>
        <Link href="/cart" className="hover:text-amber-800 dark:hover:text-amber-400">
          Giỏ hàng
        </Link>
        <span>/</span>
        <span className="text-stone-800 dark:text-stone-200 font-medium">Thanh toán</span>
      </div>

      <h1 className="text-2xl sm:text-3xl font-extrabold text-stone-900 dark:text-stone-100 tracking-tight mb-8">
        Xác Nhận & Thanh Toán Không Tiền Mặt
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* CỘT TRÁI (7 cols): Chọn Phương Thức Thanh Toán */}
        <div className="lg:col-span-7 space-y-6">
          {/* 1. Thông tin khách hàng */}
          <div className="bg-white dark:bg-[#161210] rounded-2xl border border-[#ede5dc] dark:border-[#2a221c] p-5 shadow-sm space-y-3">
            <h3 className="font-bold text-stone-900 dark:text-[#f4ede6] text-sm flex items-center gap-2">
              <span>👤</span>
              <span>Thông tin khách hàng</span>
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-stone-50 dark:bg-[#1f1915] p-3 rounded-xl border border-[#ede5dc] dark:border-[#2e241e]">
                <span className="text-stone-400 dark:text-[#7d6e62] block mb-0.5">Họ và tên:</span>
                <span className="font-semibold text-stone-800 dark:text-[#f4ede6]">
                  {user?.fullName || "Khách hàng"}
                </span>
              </div>
              <div className="bg-stone-50 dark:bg-[#1f1915] p-3 rounded-xl border border-[#ede5dc] dark:border-[#2e241e]">
                <span className="text-stone-400 dark:text-[#7d6e62] block mb-0.5">
                  Email tài khoản:
                </span>
                <span className="font-semibold text-stone-800 dark:text-[#f4ede6] truncate block">
                  {user?.email}
                </span>
              </div>
            </div>
          </div>

          {/* 2. Phương thức thanh toán không tiền mặt */}
          <div className="bg-white dark:bg-[#161210] rounded-2xl border border-[#ede5dc] dark:border-[#2a221c] p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-stone-900 dark:text-[#f4ede6] text-sm flex items-center gap-2">
                <span>💳</span>
                <span>Phương thức thanh toán</span>
              </h3>
              <span className="text-[11px] bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full font-medium border border-emerald-200/60 dark:border-emerald-800/60">
                Cashless 100%
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* Option WALLET */}
              <label
                className={`flex items-start gap-3 p-3.5 rounded-2xl border cursor-pointer transition-all ${
                  paymentMethod === "WALLET"
                    ? "border-amber-600 bg-amber-500/10 dark:bg-amber-500/15 ring-2 ring-amber-500/30 text-amber-950 dark:text-amber-200 font-medium"
                    : "border-[#ede5dc] dark:border-[#2a221c] hover:border-amber-400 dark:hover:border-amber-700/60 bg-white dark:bg-[#1a1411] text-stone-700 dark:text-[#cfc3b9]"
                }`}
              >
                <input
                  type="radio"
                  disabled={isProcessing || !!session?.attempt}
                  name="paymentMethod"
                  value="WALLET"
                  checked={paymentMethod === "WALLET"}
                  onChange={() => setPaymentMethod("WALLET")}
                  className="mt-0.5 accent-amber-600 cursor-pointer"
                />
                <div className="space-y-1">
                  <div className="font-bold text-sm flex items-center gap-1.5">
                    <span>📱</span>
                    <span>Ví Điện Tử</span>
                  </div>
                  <p className="text-[11px] text-stone-500 dark:text-[#9e8f83] leading-relaxed">
                    Momo, ZaloPay, VNPay (Quét mã QR siêu nhanh)
                  </p>
                </div>
              </label>

              {/* Option CARD */}
              <label
                className={`flex items-start gap-3 p-3.5 rounded-2xl border cursor-pointer transition-all ${
                  paymentMethod === "CARD"
                    ? "border-amber-600 bg-amber-500/10 dark:bg-amber-500/15 ring-2 ring-amber-500/30 text-amber-950 dark:text-amber-200 font-medium"
                    : "border-[#ede5dc] dark:border-[#2a221c] hover:border-amber-400 dark:hover:border-amber-700/60 bg-white dark:bg-[#1a1411] text-stone-700 dark:text-[#cfc3b9]"
                }`}
              >
                <input
                  type="radio"
                  disabled={isProcessing || !!session?.attempt}
                  name="paymentMethod"
                  value="CARD"
                  checked={paymentMethod === "CARD"}
                  onChange={() => setPaymentMethod("CARD")}
                  className="mt-0.5 accent-amber-600 cursor-pointer"
                />
                <div className="space-y-1">
                  <div className="font-bold text-sm flex items-center gap-1.5">
                    <span>💳</span>
                    <span>Thẻ Ngân Hàng</span>
                  </div>
                  <p className="text-[11px] text-stone-500 dark:text-[#9e8f83] leading-relaxed">
                    ATM / Visa / Mastercard / Napas nội địa
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* 3. Tùy chọn Demo / Test Cổng thanh toán */}
          <div className="bg-amber-50/50 dark:bg-[#1c1612] border border-amber-200/80 dark:border-[#33261f] rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                <span>⚙️</span>
                <span>Chế độ Demo Cổng Thanh Toán</span>
              </span>
              <span className="text-[10px] text-stone-500 dark:text-[#8e7e72]">
                Hỗ trợ kiểm thử đề tài
              </span>
            </div>
            <div className="flex gap-4 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  disabled={isProcessing || !!session?.attempt}
                  name="mockResult"
                  value="SUCCESS"
                  checked={mockResult === "SUCCESS"}
                  onChange={() => setMockResult("SUCCESS")}
                  className="accent-emerald-600 cursor-pointer"
                />
                <span className="font-medium text-emerald-800 dark:text-emerald-300">
                  ✓ Giả lập Thành công (201)
                </span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  disabled={isProcessing || !!session?.attempt}
                  name="mockResult"
                  value="FAILED"
                  checked={mockResult === "FAILED"}
                  onChange={() => setMockResult("FAILED")}
                  className="accent-rose-600 cursor-pointer"
                />
                <span className="font-medium text-rose-800 dark:text-rose-300">
                  ✕ Giả lập Thất bại (402)
                </span>
              </label>
            </div>
          </div>

          {session && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 text-sm space-y-3 text-stone-800 dark:text-stone-200">
              {order ? (
                <>
                  <p>
                    Đang tiếp tục đơn #{order.id}. Món và giá đã được giữ theo
                    đơn này.
                  </p>
                  {session.attempt && (
                    <p>
                      Chưa xác định kết quả giao dịch. Bấm kiểm tra để tiếp tục
                      an toàn trên cùng đơn.
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={handleCancel}
                    className="underline font-semibold"
                  >
                    Hủy / đóng đơn để sửa giỏ hàng
                  </button>
                </>
              ) : (
                <>
                  <p>
                    Chưa nhận được kết quả tạo đơn. Hãy kiểm tra lịch sử để
                    tránh đặt trùng.
                  </p>
                  <Link href="/orders" className="underline">
                    Mở lịch sử đơn hàng
                  </Link>
                  <label className="block">
                    Mã đơn cần tiếp tục
                    <input
                      type="number"
                      min="1"
                      value={recoveryId}
                      onChange={(e) => setRecoveryId(e.target.value)}
                      className="border rounded p-2 ml-2 w-28 bg-white dark:bg-stone-800 dark:border-stone-700"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={
                      isProcessing ||
                      !Number.isSafeInteger(Number(recoveryId)) ||
                      Number(recoveryId) < 1
                    }
                    onClick={() =>
                      void runAction(async () => {
                        if (user)
                          await checkoutFlow().recover(
                            user.id,
                            Number(recoveryId),
                          );
                      })
                    }
                    className="underline mr-4"
                  >
                    Tiếp tục đơn này
                  </button>
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => {
                      if (
                        user &&
                        confirm(
                          "Bạn đã kiểm tra lịch sử và chắc chắn không có đơn vừa tạo, hoặc đã hủy đơn đó?",
                        )
                      ) {
                        checkoutFlow().clear(user.id);
                        setSession(null);
                        setErrorMsg(null);
                      }
                    }}
                    className="underline"
                  >
                    Đã kiểm tra, bắt đầu lại
                  </button>
                </>
              )}
            </div>
          )}

          {/* Báo lỗi nếu có */}
          {errorMsg && (
            <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-2xl p-4 text-xs text-rose-700 dark:text-rose-300 space-y-1 animate-fadeIn">
              <div className="font-bold flex items-center gap-1.5">
                <span>⚠️</span>
                <span>Thanh toán không thành công:</span>
              </div>
              <p className="text-[11px] text-rose-600 dark:text-rose-400">{errorMsg}</p>
            </div>
          )}
        </div>

        {/* CỘT PHẢI (5 cols): Tóm tắt chi phí & Nút Xác Nhận */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white dark:bg-[#161210] rounded-2xl border border-[#ede5dc] dark:border-[#2a221c] p-5 shadow-sm space-y-4">
            <h3 className="font-bold text-stone-900 dark:text-[#f4ede6] text-sm pb-2 border-b border-[#ede5dc] dark:border-[#2a221c] flex items-center justify-between">
              <span>Đơn hàng của bạn</span>
              <span className="text-xs text-stone-500 dark:text-[#9e8f83] font-normal">
                {displayItems.length} món
              </span>
            </h3>

            {/* Danh sách món tóm tắt */}
            <div className="max-h-48 overflow-y-auto space-y-2 pr-1 text-xs">
              {displayItems.map((item) => (
                <div
                  key={item.id}
                  className="flex justify-between items-start gap-2"
                >
                  <div className="truncate flex-1">
                    <span className="font-bold text-stone-800 dark:text-[#f4ede6]">
                      {item.quantity}x
                    </span>{" "}
                    <span className="text-stone-700 dark:text-[#cfc3b9]">{item.product.name}</span>{" "}
                    <span className="text-stone-400 dark:text-[#7d6e62]">({item.size})</span>
                  </div>
                  <span className="font-mono text-stone-700 dark:text-[#cfc3b9] shrink-0">
                    {item.lineTotal.toLocaleString("vi-VN")}₫
                  </span>
                </div>
              ))}
            </div>

            <div className="space-y-2 pt-3 border-t border-[#ede5dc] dark:border-[#2a221c] text-xs text-stone-600 dark:text-[#9e8f83]">
              <div className="flex justify-between">
                <span>Tạm tính:</span>
                <span className="font-mono font-medium text-stone-800 dark:text-[#f4ede6]">
                  {subtotal.toLocaleString("vi-VN")}₫
                </span>
              </div>
              {promoCode && (
                <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                  <span>Mã {promoCode}:</span>
                  <span className="font-mono font-medium">
                    -{discountAmount.toLocaleString("vi-VN")}₫
                  </span>
                </div>
              )}
              <div className="flex justify-between text-amber-700 dark:text-amber-400 pt-1 border-t border-dashed border-[#ede5dc] dark:border-[#2a221c]">
                <span>⭐ Tích lũy điểm:</span>
                <span className="font-bold">+{pointsEarned} điểm</span>
              </div>
            </div>

            <div className="pt-3 border-t border-[#ede5dc] dark:border-[#2a221c] flex justify-between items-baseline">
              <span className="font-bold text-stone-900 dark:text-[#f4ede6] text-sm">
                Tổng thanh toán:
              </span>
              <span className="text-2xl font-black text-amber-900 dark:text-amber-400 font-mono">
                {total.toLocaleString("vi-VN")}₫
              </span>
            </div>

            <button
              type="button"
              onClick={handlePayOrder}
              disabled={
                isProcessing ||
                isValidatingPromo ||
                isRefreshing ||
                !token ||
                (session !== null && !order)
              }
              className="w-full bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 disabled:opacity-40 text-white font-bold text-sm py-3.5 px-4 rounded-xl shadow-md shadow-amber-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed active:scale-98"
            >
              {isProcessing ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <span>Đang xử lý thanh toán...</span>
                </>
              ) : (
                <span>
                  {session?.attempt
                    ? "Kiểm tra / tiếp tục giao dịch"
                    : "Xác Nhận Thanh Toán"}{" "}
                  ({total.toLocaleString("vi-VN")}₫)
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
