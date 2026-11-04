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

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("VNPAY");
  const [mockResult, setMockResult] = useState<"SUCCESS" | "FAILED">("SUCCESS");
  const [pointsToUse, setPointsToUse] = useState<number>(0);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successOrder, setSuccessOrder] = useState<Order | null>(null);

  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [recoveryId, setRecoveryId] = useState("");
  const busy = useRef(false);
  const order = session?.order;
  const subtotal = order?.subtotal ?? getSubtotal();
  const orderTotal = order?.total ?? getTotal();
  const discountAmount = order?.discountAmount ?? cartDiscount;
  const promoCode = order ? order.promoCode : cartPromoCode;

  // Tính toán quy đổi điểm: 20 điểm = 1.000đ
  const userLoyaltyPoints = user?.loyaltyPoints ?? 0;
  const maxPointsNeededForTotal = Math.ceil(orderTotal / 1000) * 20;
  const maxUsablePoints = Math.min(
    Math.floor(userLoyaltyPoints / 20) * 20,
    maxPointsNeededForTotal,
  );
  const effectivePointsToUse = Math.min(pointsToUse, maxUsablePoints);
  const discountFromPoints = Math.floor(effectivePointsToUse / 20) * 1000;
  const realAmount = Math.max(0, orderTotal - discountFromPoints);

  // Ngưỡng tối thiểu VNPAY là 5.000đ nếu còn phần tiền
  const isVnpayThresholdWarning =
    paymentMethod === "VNPAY" && realAmount > 0 && realAmount < 5000;
  const safeMaxPointsForVnpay = Math.max(
    0,
    Math.floor((orderTotal - 5000) / 1000) * 20,
  );
  const canPay100PercentWithPoints =
    userLoyaltyPoints >= maxPointsNeededForTotal;

  // Điểm tích lũy dự kiến (chỉ tính trên tiền mặt/thật thực trả: 1.000đ = 1 điểm)
  const pointsEarned =
    successOrder?.pointsEarned ?? Math.floor(realAmount / 1000);

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
          if (restored.attempt.mockResult)
            setMockResult(restored.attempt.mockResult);
          if (restored.attempt.pointsUsed)
            setPointsToUse(restored.attempt.pointsUsed);
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

  // Kiểm tra nếu chưa đăng nhập
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
    const methodLabel =
      paymentMethod === "VNPAY"
        ? "Cổng VNPay Sandbox"
        : paymentMethod === "POINTS"
          ? "Điểm thưởng BrewLite"
          : paymentMethod === "WALLET"
            ? "Ví điện tử"
            : "Thẻ ngân hàng";

    return (
      <div className="max-w-xl mx-auto px-4 py-12 text-center animate-fadeIn">
        <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200/80 dark:border-stone-800 p-8 sm:p-12 shadow-xl space-y-6 light:bg-cafe-surface light:border-cafe-line light:shadow-cafe-card ">
          <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-4xl mx-auto border border-emerald-200 dark:border-emerald-800 shadow-sm animate-bounce light:shadow-cafe-card ">
            ✓
          </div>

          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-950/50 px-3 py-1 rounded-full border border-emerald-200/50 dark:border-emerald-800/50">
              Thanh Toán Thành Công
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-stone-900 dark:text-stone-100 light:text-cafe-ink ">
              Cảm ơn bạn đã đặt món!
            </h1>
            <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 max-w-sm mx-auto light:text-cafe-muted ">
              Đơn hàng của bạn đã được chuyển tới quầy pha chế của Barista.
            </p>
          </div>

          {/* Chi tiết đơn tóm tắt */}
          <div className="bg-stone-50 dark:bg-stone-800/80 rounded-2xl p-4.5 border border-stone-200/70 dark:border-stone-700 text-left space-y-2.5 text-xs text-stone-600 dark:text-stone-300 light:bg-cafe-page light:border-cafe-line light:text-cafe-muted ">
            <div className="flex justify-between">
              <span className="text-stone-400 dark:text-stone-500 light:text-cafe-muted ">Mã đơn hàng:</span>
              <span className="font-bold text-stone-900 dark:text-stone-100 font-mono text-sm light:text-cafe-ink ">
                #{successOrder.id}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-400 dark:text-stone-500 light:text-cafe-muted ">Phương thức:</span>
              <span className="font-semibold text-stone-800 dark:text-stone-200 light:text-cafe-ink ">
                {methodLabel}
              </span>
            </div>
            {effectivePointsToUse > 0 && (
              <div className="flex justify-between text-amber-700 dark:text-amber-400">
                <span>Điểm thưởng đã dùng:</span>
                <span className="font-semibold font-mono">
                  {effectivePointsToUse} điểm (-{discountFromPoints.toLocaleString("vi-VN")}₫)
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-stone-400 dark:text-stone-500 light:text-cafe-muted ">Tiền thanh toán:</span>
              <span className="font-extrabold text-amber-900 dark:text-amber-400 font-mono text-sm light:text-cafe-primary ">
                {realAmount.toLocaleString("vi-VN")}₫
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t border-stone-200 dark:border-stone-700 text-amber-800 dark:text-amber-400 light:border-cafe-line light:text-cafe-primary ">
              <span>⭐ Điểm tích lũy nhận được:</span>
              <span className="font-bold">+{pointsEarned} điểm</span>
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-3">
            <Link
              href="/orders"
              onClick={() => user && checkoutFlow().clear(user.id)}
              className="flex-1 py-3 px-4 rounded-xl font-bold text-xs sm:text-sm bg-amber-600 hover:bg-amber-700 text-white shadow-md shadow-amber-600/20 transition-all text-center light:shadow-cafe-card cafe-primary "
            >
              Theo dõi đơn hàng của tôi →
            </Link>
            <Link
              href="/menu"
              onClick={() => user && checkoutFlow().clear(user.id)}
              className="py-3 px-5 rounded-xl font-semibold text-xs sm:text-sm bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200 transition-colors text-center light:bg-cafe-soft light:hover:bg-cafe-line light:text-cafe-ink "
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
        <h2 className="text-xl font-bold text-stone-800 light:text-cafe-ink ">
          Giỏ hàng của bạn đang trống
        </h2>
        <p className="text-xs text-stone-500 light:text-cafe-muted ">
          Vui lòng chọn món trước khi tiến hành thanh toán.
        </p>
        <Link
          href="/"
          className="inline-block bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-sm transition-all light:shadow-cafe-card cafe-primary "
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
        if (refreshed.requiresReview) {
          refreshed.acknowledgeChanges();
          throw new Error(
            `${refreshed.notice || 'Thành phần giỏ hàng đã thay đổi.'} Hãy kiểm tra các món và bấm thanh toán lần nữa để xác nhận.`,
          );
        }
        if (refreshed.getTotal() !== orderTotal)
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
      if (prepared.order!.total !== orderTotal) {
        setErrorMsg(
          `Tổng tiền được cập nhật thành ${prepared.order!.total.toLocaleString("vi-VN")}₫. Vui lòng kiểm tra và xác nhận lại, hoặc hủy đơn để sửa giỏ hàng.`,
        );
        return;
      }
      if (useAuthStore.getState().token !== token) return;

      const effectiveMethod: PaymentMethod =
        realAmount === 0 ? "POINTS" : paymentMethod;

      const paid = await flow.pay(
        user.id,
        effectiveMethod,
        mockResult,
        effectivePointsToUse,
      );

      // Nếu là luồng VNPAY và trả về paymentUrl
      if (paid.paymentUrl) {
        const latest = useCartStore.getState();
        if (cartKey(latest.items, latest.promoCode) === paid.cartKey) {
          clearCart();
        }
        window.location.href = paid.paymentUrl;
        return;
      }

      if (paid.order && useAuthStore.getState().token === token) {
        const latest = useCartStore.getState();
        if (cartKey(latest.items, latest.promoCode) === paid.cartKey)
          clearCart();
        setSuccessOrder(paid.order);
        setPaymentMethod(paid.paidMethod ?? effectiveMethod);
        // The receipt stays in component state; a later visit can start a new
        // purchase even when the customer leaves through the website header.
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

  const handleRetryPayment = () => {
    if (!user) return;
    checkoutFlow().resetAttempt(user.id);
    setSession(checkoutFlow().read(user.id));
    setErrorMsg(null);
  };

  return (
    <div className="w-full py-2 sm:py-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 mb-1.5 light:text-cafe-muted ">
        <Link href="/" className="hover:text-amber-800 dark:hover:text-amber-400 light:hover:text-cafe-primary ">
          Trang chủ
        </Link>
        <span>/</span>
        <Link href="/menu" className="hover:text-amber-800 dark:hover:text-amber-400 light:hover:text-cafe-primary ">
          Menu
        </Link>
        <span>/</span>
        <Link href="/cart" className="hover:text-amber-800 dark:hover:text-amber-400 light:hover:text-cafe-primary ">
          Giỏ hàng
        </Link>
        <span>/</span>
        <span className="text-stone-800 dark:text-stone-200 font-medium light:text-cafe-ink ">Thanh toán</span>
      </div>

      <h1 className="text-xl sm:text-2xl font-black text-stone-900 dark:text-stone-100 tracking-tight mb-4 light:text-cafe-ink ">
        Xác Nhận & Thanh Toán
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* CỘT TRÁI (7 cols): Chọn Phương Thức Thanh Toán & Điểm Thưởng */}
        <div className="lg:col-span-7 space-y-4">
          {/* 1. Thông tin khách hàng */}
          <div className="bg-white dark:bg-[#161210] rounded-2xl border border-[#ede5dc] dark:border-[#2a221c] p-5 shadow-sm space-y-3 light:bg-cafe-surface light:border-cafe-line light:shadow-cafe-card ">
            <h3 className="font-bold text-stone-900 dark:text-[#f4ede6] text-sm flex items-center gap-2 light:text-cafe-ink ">
              <span>👤</span>
              <span>Thông tin khách hàng</span>
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-stone-50 dark:bg-[#1f1915] p-3 rounded-xl border border-[#ede5dc] dark:border-[#2e241e] light:bg-cafe-page light:border-cafe-line ">
                <span className="text-stone-400 dark:text-[#7d6e62] block mb-0.5 light:text-cafe-muted ">Họ và tên:</span>
                <span className="font-semibold text-stone-800 dark:text-[#f4ede6] light:text-cafe-ink ">
                  {user?.fullName || "Khách hàng"}
                </span>
              </div>
              <div className="bg-stone-50 dark:bg-[#1f1915] p-3 rounded-xl border border-[#ede5dc] dark:border-[#2e241e] light:bg-cafe-page light:border-cafe-line ">
                <span className="text-stone-400 dark:text-[#7d6e62] block mb-0.5 light:text-cafe-muted ">
                  Email tài khoản:
                </span>
                <span className="font-semibold text-stone-800 dark:text-[#f4ede6] truncate block light:text-cafe-ink ">
                  {user?.email}
                </span>
              </div>
            </div>
          </div>

          {/* 2. Dùng Điểm Thưởng BrewLite */}
          {user && userLoyaltyPoints > 0 && (
            <div className="bg-white dark:bg-[#161210] rounded-2xl border border-[#ede5dc] dark:border-[#2a221c] p-5 shadow-sm space-y-3 light:bg-cafe-surface light:border-cafe-line light:shadow-cafe-card ">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-stone-900 dark:text-[#f4ede6] text-sm flex items-center gap-2 light:text-cafe-ink ">
                  <span>⭐</span>
                  <span>Dùng Điểm Thưởng BrewLite</span>
                </h3>
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/20">
                  Số dư: {userLoyaltyPoints.toLocaleString("vi-VN")} điểm
                </span>
              </div>
              <p className="text-[11px] text-stone-500 dark:text-[#9e8f83] light:text-cafe-muted ">
                Quy đổi: mỗi mốc 20 điểm = 1.000₫ giảm trực tiếp vào đơn hàng.
              </p>

              {/* Quick buttons */}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  disabled={isProcessing || !!session?.attempt}
                  onClick={() => setPointsToUse(0)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer disabled:opacity-50 ${
                    effectivePointsToUse === 0
                      ? "bg-amber-600 text-white border-amber-600 font-bold"
                      : "bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border-stone-200 dark:border-stone-700 hover:border-amber-400"
                  }`}
                >
                  Không dùng
                </button>
                {maxUsablePoints >= 100 && (
                  <button
                    type="button"
                    disabled={isProcessing || !!session?.attempt}
                    onClick={() => setPointsToUse(100)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer disabled:opacity-50 ${
                      effectivePointsToUse === 100
                        ? "bg-amber-600 text-white border-amber-600 font-bold"
                        : "bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border-stone-200 dark:border-stone-700 hover:border-amber-400"
                    }`}
                  >
                    100 điểm (-5.000₫)
                  </button>
                )}
                {maxUsablePoints >= 200 && (
                  <button
                    type="button"
                    disabled={isProcessing || !!session?.attempt}
                    onClick={() => setPointsToUse(200)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer disabled:opacity-50 ${
                      effectivePointsToUse === 200
                        ? "bg-amber-600 text-white border-amber-600 font-bold"
                        : "bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border-stone-200 dark:border-stone-700 hover:border-amber-400"
                    }`}
                  >
                    200 điểm (-10.000₫)
                  </button>
                )}
                <button
                  type="button"
                  disabled={isProcessing || !!session?.attempt}
                  onClick={() => setPointsToUse(maxUsablePoints)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer disabled:opacity-50 ${
                    effectivePointsToUse === maxUsablePoints && maxUsablePoints > 0
                      ? "bg-amber-600 text-white border-amber-600 font-bold"
                      : "bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border-stone-200 dark:border-stone-700 hover:border-amber-400"
                  }`}
                >
                  Dùng tối đa ({maxUsablePoints} điểm)
                </button>
              </div>

              {/* Slider điều chỉnh */}
              {maxUsablePoints > 0 && (
                <div className="pt-2 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-stone-600 dark:text-[#9e8f83]">
                      Điểm áp dụng:
                    </span>
                    <span className="font-bold text-amber-800 dark:text-amber-400 font-mono">
                      {effectivePointsToUse} điểm (-{discountFromPoints.toLocaleString("vi-VN")}₫)
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={maxUsablePoints}
                    step="20"
                    value={effectivePointsToUse}
                    disabled={isProcessing || !!session?.attempt}
                    onChange={(e) => setPointsToUse(Number(e.target.value))}
                    className="w-full accent-amber-600 cursor-pointer disabled:opacity-50"
                  />
                </div>
              )}

              {/* Cảnh báo ngưỡng tối thiểu VNPAY */}
              {isVnpayThresholdWarning && (
                <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl p-3 text-xs text-amber-900 dark:text-amber-300 space-y-1 animate-fadeIn">
                  <p className="font-bold flex items-center gap-1.5">
                    <span>⚠️</span>
                    <span>Quy định số tiền thanh toán qua VNPAY:</span>
                  </p>
                  <p className="text-[11px] leading-relaxed">
                    Cổng VNPAY yêu cầu giao dịch tối thiểu 5.000₫ (phần tiền còn lại hiện tại:{" "}
                    <strong>{realAmount.toLocaleString("vi-VN")}₫</strong>).
                    Vui lòng giảm số điểm dùng để tiền thanh toán ≥ 5.000₫{canPay100PercentWithPoints ? ", hoặc thanh toán 100% bằng điểm thưởng" : ""}.
                  </p>
                  {safeMaxPointsForVnpay < effectivePointsToUse && (
                    <button
                      type="button"
                      onClick={() => setPointsToUse(safeMaxPointsForVnpay)}
                      className="mt-1 text-xs underline font-bold text-amber-800 hover:text-amber-900 dark:text-amber-300 cursor-pointer"
                    >
                      → Giảm về mốc tối đa cho VNPAY ({safeMaxPointsForVnpay} điểm)
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 3. Phương thức thanh toán không tiền mặt */}
          <div className="bg-white dark:bg-[#161210] rounded-2xl border border-[#ede5dc] dark:border-[#2a221c] p-5 shadow-sm space-y-3 light:bg-cafe-surface light:border-cafe-line light:shadow-cafe-card ">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-stone-900 dark:text-[#f4ede6] text-sm flex items-center gap-2 light:text-cafe-ink ">
                <span>💳</span>
                <span>Phương thức thanh toán</span>
              </h3>
              <span className="text-[11px] bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full font-medium border border-emerald-200/60 dark:border-emerald-800/60">
                Cashless 100%
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* Option VNPAY Sandbox */}
              <label
                className={`flex items-start gap-3 p-3.5 rounded-2xl border cursor-pointer transition-all ${
                  paymentMethod === "VNPAY" && realAmount > 0
                    ? "border-amber-600 bg-amber-500/10 dark:bg-amber-500/15 ring-2 ring-amber-500/30 text-amber-950 dark:text-amber-200 font-medium light:ring-cafe-primary/30 light:bg-cafe-accent light:text-cafe-primary light:border-cafe-primary "
                    : "border-[#ede5dc] dark:border-[#2a221c] hover:border-amber-400 dark:hover:border-amber-700/60 bg-white dark:bg-[#1a1411] text-stone-700 dark:text-[#cfc3b9] light:border-cafe-line light:hover:border-cafe-primary light:bg-cafe-surface light:text-cafe-ink "
                }`}
              >
                <input
                  type="radio"
                  disabled={isProcessing || !!session?.attempt || realAmount === 0}
                  name="paymentMethod"
                  value="VNPAY"
                  checked={paymentMethod === "VNPAY" && realAmount > 0}
                  onChange={() => setPaymentMethod("VNPAY")}
                  className="mt-0.5 accent-amber-600 cursor-pointer light:accent-cafe-primary "
                />
                <div className="space-y-1">
                  <div className="font-bold text-sm flex items-center gap-1.5">
                    <span>🏦</span>
                    <span>VNPAY Sandbox</span>
                  </div>
                  <p className="text-[11px] text-stone-500 dark:text-[#9e8f83] leading-relaxed light:text-cafe-muted ">
                    Thanh toán quét mã VNPAY-QR, thẻ ATM nội địa & thẻ quốc tế
                  </p>
                </div>
              </label>

              {/* Option Dùng Điểm Thưởng 100% */}
              {canPay100PercentWithPoints && (
                <label
                  className={`flex items-start gap-3 p-3.5 rounded-2xl border cursor-pointer transition-all ${
                    paymentMethod === "POINTS" || realAmount === 0
                      ? "border-amber-600 bg-amber-500/10 dark:bg-amber-500/15 ring-2 ring-amber-500/30 text-amber-950 dark:text-amber-200 font-medium light:ring-cafe-primary/30 light:bg-cafe-accent light:text-cafe-primary light:border-cafe-primary "
                      : "border-[#ede5dc] dark:border-[#2a221c] hover:border-amber-400 dark:hover:border-amber-700/60 bg-white dark:bg-[#1a1411] text-stone-700 dark:text-[#cfc3b9] light:border-cafe-line light:hover:border-cafe-primary light:bg-cafe-surface light:text-cafe-ink "
                  }`}
                >
                  <input
                    type="radio"
                    disabled={isProcessing || !!session?.attempt}
                    name="paymentMethod"
                    value="POINTS"
                    checked={paymentMethod === "POINTS" || realAmount === 0}
                    onChange={() => {
                      setPaymentMethod("POINTS");
                      setPointsToUse(maxPointsNeededForTotal);
                    }}
                    className="mt-0.5 accent-amber-600 cursor-pointer light:accent-cafe-primary "
                  />
                  <div className="space-y-1">
                    <div className="font-bold text-sm flex items-center gap-1.5">
                      <span>⭐</span>
                      <span>100% Điểm Thưởng</span>
                    </div>
                    <p className="text-[11px] text-stone-500 dark:text-[#9e8f83] leading-relaxed light:text-cafe-muted ">
                      Đổi toàn bộ {maxPointsNeededForTotal} điểm, không cần thanh toán tiền
                    </p>
                  </div>
                </label>
              )}

              {/* Option WALLET Mock (Hỗ trợ kiểm thử) */}
              <label
                className={`flex items-start gap-3 p-3.5 rounded-2xl border cursor-pointer transition-all ${
                  paymentMethod === "WALLET" && realAmount > 0
                    ? "border-amber-600 bg-amber-500/10 dark:bg-amber-500/15 ring-2 ring-amber-500/30 text-amber-950 dark:text-amber-200 font-medium light:ring-cafe-primary/30 light:bg-cafe-accent light:text-cafe-primary light:border-cafe-primary "
                    : "border-[#ede5dc] dark:border-[#2a221c] hover:border-amber-400 dark:hover:border-amber-700/60 bg-white dark:bg-[#1a1411] text-stone-700 dark:text-[#cfc3b9] light:border-cafe-line light:hover:border-cafe-primary light:bg-cafe-surface light:text-cafe-ink "
                }`}
              >
                <input
                  type="radio"
                  disabled={isProcessing || !!session?.attempt || realAmount === 0}
                  name="paymentMethod"
                  value="WALLET"
                  checked={paymentMethod === "WALLET" && realAmount > 0}
                  onChange={() => setPaymentMethod("WALLET")}
                  className="mt-0.5 accent-amber-600 cursor-pointer light:accent-cafe-primary "
                />
                <div className="space-y-1">
                  <div className="font-bold text-sm flex items-center gap-1.5">
                    <span>📱</span>
                    <span>Ví Điện Tử (Mock)</span>
                  </div>
                  <p className="text-[11px] text-stone-500 dark:text-[#9e8f83] leading-relaxed light:text-cafe-muted ">
                    Momo, ZaloPay (Mô phỏng thanh toán nhanh)
                  </p>
                </div>
              </label>

              {/* Option CARD Mock (Hỗ trợ kiểm thử) */}
              <label
                className={`flex items-start gap-3 p-3.5 rounded-2xl border cursor-pointer transition-all ${
                  paymentMethod === "CARD" && realAmount > 0
                    ? "border-amber-600 bg-amber-500/10 dark:bg-amber-500/15 ring-2 ring-amber-500/30 text-amber-950 dark:text-amber-200 font-medium light:ring-cafe-primary/30 light:bg-cafe-accent light:text-cafe-primary light:border-cafe-primary "
                    : "border-[#ede5dc] dark:border-[#2a221c] hover:border-amber-400 dark:hover:border-amber-700/60 bg-white dark:bg-[#1a1411] text-stone-700 dark:text-[#cfc3b9] light:border-cafe-line light:hover:border-cafe-primary light:bg-cafe-surface light:text-cafe-ink "
                }`}
              >
                <input
                  type="radio"
                  disabled={isProcessing || !!session?.attempt || realAmount === 0}
                  name="paymentMethod"
                  value="CARD"
                  checked={paymentMethod === "CARD" && realAmount > 0}
                  onChange={() => setPaymentMethod("CARD")}
                  className="mt-0.5 accent-amber-600 cursor-pointer light:accent-cafe-primary "
                />
                <div className="space-y-1">
                  <div className="font-bold text-sm flex items-center gap-1.5">
                    <span>💳</span>
                    <span>Thẻ Ngân Hàng (Mock)</span>
                  </div>
                  <p className="text-[11px] text-stone-500 dark:text-[#9e8f83] leading-relaxed light:text-cafe-muted ">
                    ATM / Visa / Mastercard (Mô phỏng thẻ)
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* 4. Tùy chọn Demo / Test Cổng thanh toán (Chỉ hiện khi chọn Mock WALLET / CARD) */}
          {(paymentMethod === "WALLET" || paymentMethod === "CARD") && (
            <div className="bg-amber-50/50 dark:bg-[#1c1612] border border-amber-200/80 dark:border-[#33261f] rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5 light:text-cafe-primary ">
                  <span>⚙️</span>
                  <span>Chế độ Demo Mock Payment</span>
                </span>
                <span className="text-[10px] text-stone-500 dark:text-[#8e7e72] light:text-cafe-muted ">
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
          )}

          {session && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 text-sm space-y-3 text-stone-800 dark:text-stone-200 light:text-cafe-ink ">
              {order ? (
                <>
                  <p>
                    Đang tiếp tục đơn #{order.id}. Món và giá đã được giữ theo
                    đơn này.
                  </p>
                  {session.phase === "failed" && (
                    <div className="space-y-2">
                      <p className="text-xs text-rose-700 dark:text-rose-300 font-semibold">
                        Giao dịch trước không thành công hoặc đã bị hủy. Điểm thưởng đã được hoàn lại.
                      </p>
                      <button
                        type="button"
                        onClick={handleRetryPayment}
                        className="bg-amber-600 text-white text-xs font-bold px-3 py-1.5 rounded-xl shadow-sm hover:bg-amber-700 cursor-pointer"
                      >
                        Thử thanh toán lại đơn #{order.id}
                      </button>
                    </div>
                  )}
                  {session.attempt && session.phase === "paying" && (
                    <div className="space-y-2">
                      <p className="text-xs text-stone-600 dark:text-stone-400">
                        Chưa xác định kết quả giao dịch. Bấm kiểm tra để tiếp tục an toàn trên cùng đơn.
                      </p>
                      <button
                        type="button"
                        onClick={handleRetryPayment}
                        className="text-xs underline text-amber-800 dark:text-amber-400 font-semibold cursor-pointer mr-3"
                      >
                        Tạo giao dịch mới
                      </button>
                    </div>
                  )}
                  <div>
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={handleCancel}
                      className="underline font-semibold text-xs text-rose-700 dark:text-rose-400 cursor-pointer"
                    >
                      Hủy / đóng đơn để sửa giỏ hàng
                    </button>
                  </div>
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
                      className="border rounded p-2 ml-2 w-28 bg-white dark:bg-stone-800 dark:border-stone-700 light:bg-cafe-surface "
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
          <div className="bg-white dark:bg-[#161210] rounded-2xl border border-[#ede5dc] dark:border-[#2a221c] p-5 shadow-sm space-y-4 light:bg-cafe-surface light:border-cafe-line light:shadow-cafe-card ">
            <h3 className="font-bold text-stone-900 dark:text-[#f4ede6] text-sm pb-2 border-b border-[#ede5dc] dark:border-[#2a221c] flex items-center justify-between light:text-cafe-ink light:border-cafe-line ">
              <span>Đơn hàng của bạn</span>
              <span className="text-xs text-stone-500 dark:text-[#9e8f83] font-normal light:text-cafe-muted ">
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
                    <span className="font-bold text-stone-800 dark:text-[#f4ede6] light:text-cafe-ink ">
                      {item.quantity}x
                    </span>{" "}
                    <span className="text-stone-700 dark:text-[#cfc3b9] light:text-cafe-ink ">{item.product.name}</span>{" "}
                    <span className="text-stone-400 dark:text-[#7d6e62] light:text-cafe-muted ">({item.size})</span>
                  </div>
                  <span className="font-mono text-stone-700 dark:text-[#cfc3b9] shrink-0 light:text-cafe-ink ">
                    {item.lineTotal.toLocaleString("vi-VN")}₫
                  </span>
                </div>
              ))}
            </div>

            <div className="space-y-2 pt-3 border-t border-[#ede5dc] dark:border-[#2a221c] text-xs text-stone-600 dark:text-[#9e8f83] light:border-cafe-line light:text-cafe-muted ">
              <div className="flex justify-between">
                <span>Tạm tính:</span>
                <span className="font-mono font-medium text-stone-800 dark:text-[#f4ede6] light:text-cafe-ink ">
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
              {discountFromPoints > 0 && (
                <div className="flex justify-between text-amber-700 dark:text-amber-400">
                  <span>Giảm từ điểm ({effectivePointsToUse} điểm):</span>
                  <span className="font-mono font-medium">
                    -{discountFromPoints.toLocaleString("vi-VN")}₫
                  </span>
                </div>
              )}
              <div className="flex justify-between text-amber-700 dark:text-amber-400 pt-1 border-t border-dashed border-[#ede5dc] dark:border-[#2a221c] light:text-cafe-primary light:border-cafe-line ">
                <span>⭐ Tích lũy điểm (dự kiến):</span>
                <span className="font-bold font-mono">+{pointsEarned} điểm</span>
              </div>
            </div>

            <div className="pt-3 border-t border-[#ede5dc] dark:border-[#2a221c] flex justify-between items-baseline light:border-cafe-line ">
              <span className="font-bold text-stone-900 dark:text-[#f4ede6] text-sm light:text-cafe-ink ">
                Tổng thanh toán:
              </span>
              <span className="text-2xl font-black text-amber-900 dark:text-amber-400 font-mono light:text-cafe-primary ">
                {realAmount.toLocaleString("vi-VN")}₫
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
                (session !== null && !order) ||
                isVnpayThresholdWarning
              }
              className="w-full h-12 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 disabled:opacity-40 text-white font-bold text-sm px-4 rounded-2xl shadow-lg shadow-amber-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed active:scale-95 light:shadow-cafe-card cafe-primary "
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
                    : paymentMethod === "VNPAY" && realAmount > 0
                      ? "Chuyển tới cổng VNPay"
                      : "Xác Nhận Thanh Toán"}{" "}
                  ({realAmount.toLocaleString("vi-VN")}₫)
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
