"use client";

import React, { Suspense, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuthStore } from "@/store/auth-store";
import { useCartStore } from "@/store/cart-store";
import { CheckoutFlow } from "@/lib/checkout-flow";
import type { OrderStatus, PaymentStatus } from "@/types";

interface VnpayReturnResponse {
  isValidSignature: boolean;
  responseCode: string | null;
  payment: {
    id: number;
    orderId: number;
    amount: number;
    pointsUsed: number;
    pointsAmount: number;
    status: PaymentStatus;
    method: string;
  } | null;
  order: {
    id: number;
    status: OrderStatus;
    total: number;
  } | null;
}

export default function VnpayReturnPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-xl mx-auto px-4 py-16 text-center text-sm text-stone-500">
          Đang tải thông tin kết quả thanh toán...
        </div>
      }
    >
      <VnpayReturnContent />
    </Suspense>
  );
}

function VnpayReturnContent() {
  const searchParams = useSearchParams();
  const { user, refreshUser } = useAuthStore();
  const clearCart = useCartStore((s) => s.clearCart);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [data, setData] = useState<VnpayReturnResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const processedRef = useRef<boolean>(false);

  const responseCode = searchParams.get("vnp_ResponseCode") || "";
  const transactionNo = searchParams.get("vnp_TransactionNo") || "";
  const bankCode = searchParams.get("vnp_BankCode") || "";
  const txnRef = searchParams.get("vnp_TxnRef") || "";

  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;

    async function verifyReturn() {
      setIsLoading(true);
      setErrorMsg(null);
      try {
        const queryString = searchParams.toString();
        const res = await apiFetch<VnpayReturnResponse>(
          `/payments/vnpay/return?${queryString}`,
        );
        setData(res);

        // Làm mới điểm thưởng và thông tin tài khoản
        await refreshUser();

        // Nếu thanh toán thành công, xóa giỏ hàng và clear session
        if (
          res.isValidSignature &&
          (res.responseCode === "00" ||
            res.payment?.status === "SUCCESS" ||
            res.order?.status === "PAID")
        ) {
          clearCart();
          if (typeof window !== "undefined" && user?.id) {
            new CheckoutFlow(window.sessionStorage).clear(user.id);
          }
        }
      } catch (err) {
        setErrorMsg(
          err instanceof ApiError
            ? err.message
            : "Không thể xác thực kết quả thanh toán với hệ thống.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    void verifyReturn();
  }, [searchParams, refreshUser, clearCart, user?.id]);

  if (isLoading) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-4 animate-fadeIn">
        <div className="w-16 h-16 border-4 border-amber-600 border-t-transparent rounded-full animate-spin mx-auto" />
        <h2 className="text-lg font-bold text-stone-800 dark:text-stone-100">
          Đang xác thực kết quả thanh toán từ VNPAY...
        </h2>
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Vui lòng đợi giây lát, hệ thống đang kiểm tra chữ ký số và đối soát giao dịch.
        </p>
      </div>
    );
  }

  // Chữ ký giả mạo hoặc lỗi hệ thống
  if (errorMsg || (data && !data.isValidSignature)) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 text-center animate-fadeIn">
        <div className="bg-white dark:bg-stone-900 rounded-3xl border border-rose-200 dark:border-rose-900/60 p-8 sm:p-12 shadow-xl space-y-6">
          <div className="w-20 h-20 rounded-full bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center text-4xl mx-auto border border-rose-200 dark:border-rose-800 shadow-sm">
            ✕
          </div>

          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400 bg-rose-100/70 dark:bg-rose-950/50 px-3 py-1 rounded-full border border-rose-200/50">
              Chữ Ký Không Hợp Lệ
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-stone-900 dark:text-stone-100">
              Xác thực giao dịch thất bại!
            </h1>
            <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 max-w-sm mx-auto">
              {errorMsg ||
                "Chữ ký bảo mật (SecureHash) không khớp với cấu hình hệ thống. Yêu cầu đã bị từ chối để chống giả mạo."}
            </p>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-3">
            <Link
              href="/orders"
              className="flex-1 py-3 px-4 rounded-xl font-bold text-xs sm:text-sm bg-stone-800 hover:bg-stone-900 text-white transition-all text-center"
            >
              Xem lịch sử đơn hàng
            </Link>
            <Link
              href="/menu"
              className="py-3 px-5 rounded-xl font-semibold text-xs sm:text-sm bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 text-stone-700 dark:text-stone-200 transition-colors text-center"
            >
              Về Menu chính
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isSuccess =
    data?.isValidSignature &&
    (data.responseCode === "00" ||
      data.payment?.status === "SUCCESS" ||
      data.order?.status === "PAID");

  const orderId = data?.order?.id ?? data?.payment?.orderId;
  const pointsUsed = data?.payment?.pointsUsed ?? 0;
  const pointsAmount = data?.payment?.pointsAmount ?? 0;
  const paidAmount = data?.payment?.amount ?? 0;
  const expectedPointsEarned = Math.floor(paidAmount / 1000);

  // MÀN HÌNH THÀNH CÔNG
  if (isSuccess) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 text-center animate-fadeIn">
        <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200/80 dark:border-stone-800 p-8 sm:p-12 shadow-xl space-y-6">
          <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-4xl mx-auto border border-emerald-200 dark:border-emerald-800 shadow-sm animate-bounce">
            ✓
          </div>

          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-950/50 px-3 py-1 rounded-full border border-emerald-200/50">
              Thanh Toán VNPAY Thành Công
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-stone-900 dark:text-stone-100">
              Cảm ơn bạn đã đặt món!
            </h1>
            <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 max-w-sm mx-auto">
              Đơn hàng đã được thanh toán qua VNPAY Sandbox và chuyển tới quầy Barista.
            </p>
          </div>

          {/* Chi tiết đơn tóm tắt */}
          <div className="bg-stone-50 dark:bg-stone-800/80 rounded-2xl p-4.5 border border-stone-200/70 dark:border-stone-700 text-left space-y-2.5 text-xs text-stone-600 dark:text-stone-300">
            <div className="flex justify-between">
              <span className="text-stone-400 dark:text-stone-500">Mã đơn hàng:</span>
              <span className="font-bold text-stone-900 dark:text-stone-100 font-mono text-sm">
                #{orderId}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-400 dark:text-stone-500">Phương thức:</span>
              <span className="font-semibold text-stone-800 dark:text-stone-200">
                VNPAY Sandbox {bankCode ? `(${bankCode})` : ""}
              </span>
            </div>
            {transactionNo && (
              <div className="flex justify-between">
                <span className="text-stone-400 dark:text-stone-500">Mã giao dịch VNPAY:</span>
                <span className="font-mono text-stone-800 dark:text-stone-200">
                  {transactionNo}
                </span>
              </div>
            )}
            {txnRef && (
              <div className="flex justify-between">
                <span className="text-stone-400 dark:text-stone-500">Mã tham chiếu:</span>
                <span className="font-mono text-stone-800 dark:text-stone-200">
                  {txnRef}
                </span>
              </div>
            )}
            {pointsUsed > 0 && (
              <div className="flex justify-between text-amber-700 dark:text-amber-400">
                <span>Điểm thưởng đã dùng:</span>
                <span className="font-semibold font-mono">
                  {pointsUsed} điểm (-{pointsAmount.toLocaleString("vi-VN")}₫)
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-stone-400 dark:text-stone-500">Số tiền qua VNPAY:</span>
              <span className="font-extrabold text-amber-900 dark:text-amber-400 font-mono text-sm">
                {paidAmount.toLocaleString("vi-VN")}₫
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t border-stone-200 dark:border-stone-700 text-amber-800 dark:text-amber-400">
              <span>⭐ Điểm thưởng tích lũy (dự kiến khi hoàn thành):</span>
              <span className="font-bold font-mono">+{expectedPointsEarned} điểm</span>
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-3">
            <Link
              href="/orders"
              className="flex-1 py-3 px-4 rounded-xl font-bold text-xs sm:text-sm bg-amber-600 hover:bg-amber-700 text-white shadow-md shadow-amber-600/20 transition-all text-center"
            >
              Theo dõi đơn hàng của tôi →
            </Link>
            <Link
              href="/menu"
              className="py-3 px-5 rounded-xl font-semibold text-xs sm:text-sm bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 text-stone-700 dark:text-stone-200 transition-colors text-center"
            >
              Về Menu chính
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // MÀN HÌNH THẤT BẠI HOẶC HỦY
  return (
    <div className="max-w-xl mx-auto px-4 py-12 text-center animate-fadeIn">
      <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200/80 dark:border-stone-800 p-8 sm:p-12 shadow-xl space-y-6">
        <div className="w-20 h-20 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center text-4xl mx-auto border border-amber-200 dark:border-amber-800 shadow-sm">
          !
        </div>

        <div className="space-y-2">
          <span className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300 bg-amber-100/70 dark:bg-amber-950/50 px-3 py-1 rounded-full border border-amber-200/50">
            Thanh Toán Chưa Hoàn Tất (Mã: {responseCode || "24"})
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-stone-900 dark:text-stone-100">
            Giao dịch VNPAY đã bị hủy hoặc thất bại
          </h1>
          <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 max-w-sm mx-auto">
            Bạn đã hủy thanh toán hoặc giao dịch ngân hàng không thành công.
          </p>
        </div>

        {/* Thông báo hoàn điểm */}
        <div className="bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/50 rounded-2xl p-4 text-xs text-emerald-800 dark:text-emerald-300 text-left space-y-1">
          <div className="font-bold flex items-center gap-1.5">
            <span>🛡️</span>
            <span>Bảo vệ quyền lợi khách hàng:</span>
          </div>
          <p className="text-[11px] leading-relaxed">
            Nếu bạn đã chọn áp dụng điểm thưởng cho đơn hàng này, toàn bộ số điểm đã dùng được tự động hoàn lại đầy đủ vào ví điểm của bạn.
          </p>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row gap-3">
          <Link
            href="/checkout"
            className="flex-1 py-3 px-4 rounded-xl font-bold text-xs sm:text-sm bg-amber-600 hover:bg-amber-700 text-white shadow-md shadow-amber-600/20 transition-all text-center"
          >
            Thử thanh toán lại đơn hàng
          </Link>
          <Link
            href="/orders"
            className="py-3 px-5 rounded-xl font-semibold text-xs sm:text-sm bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 text-stone-700 dark:text-stone-200 transition-colors text-center"
          >
            Xem lịch sử đơn hàng
          </Link>
        </div>
      </div>
    </div>
  );
}
