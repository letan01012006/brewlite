"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuthStore } from "@/store/auth-store";
import { CheckoutFlow } from "@/lib/checkout-flow";
import type { Order, Payment } from "@/types";

interface ReturnResult {
  payment: Payment;
  order: Order;
  message?: string;
}

function VnpayReturnContent() {
  const searchParams = useSearchParams();
  const {
    user,
    token,
    initAuth,
    refreshUser,
    isLoading: isLoadingAuth,
  } = useAuthStore();
  const userId = user?.id;

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<ReturnResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  useEffect(() => {
    if (isLoadingAuth) return;
    let active = true;

    const verify = async () => {
      try {
        const queryStr = searchParams.toString();
        if (!queryStr) {
          setError(
            "Không tìm thấy thông tin phản hồi từ cổng thanh toán VNPAY.",
          );
          setLoading(false);
          return;
        }

        const effectiveToken =
          token ??
          (typeof window !== "undefined"
            ? localStorage.getItem("brewlite_token")
            : null);

        if (!effectiveToken) {
          setError("Vui lòng đăng nhập lại để xem kết quả thanh toán.");
          setLoading(false);
          return;
        }

        const data = await apiFetch<ReturnResult>(
          `/payments/vnpay/return?${queryStr}`,
          {
            method: "GET",
            token: effectiveToken,
          },
        );

        if (!active) return;
        setResult(data);

        if (
          data.payment.status === "SUCCESS" &&
          ["PAID", "PREPARING", "READY", "COMPLETED"].includes(
            data.order.status,
          )
        ) {
          if (userId) {
            const flow = new CheckoutFlow(window.sessionStorage);
            flow.startOrder(userId, data.order, false);
            flow.clear(userId, data.order.id);
          }
          await refreshUser();
        } else if (
          ["FAILED", "EXPIRED", "CANCELLED"].includes(data.payment.status)
        ) {
          // Giao dịch không thành công / hủy: xóa attempt cũ để lượt thanh toán sau tạo key mới
          if (userId && typeof window !== "undefined") {
            new CheckoutFlow(window.sessionStorage).resetAttempt(
              userId,
              data.order.id,
            );
          }
          await refreshUser();
        }
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiError) {
          setError(err.message || "Xác thực giao dịch VNPAY thất bại.");
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Có lỗi xảy ra khi xác thực giao dịch VNPAY.");
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void verify();
    return () => {
      active = false;
    };
  }, [searchParams, token, isLoadingAuth, userId, refreshUser]);

  if (loading) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-amber-600 border-t-transparent" />
        <h2 className="text-lg font-bold text-stone-800 dark:text-stone-100">
          Đang xác thực kết quả thanh toán VNPAY...
        </h2>
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Vui lòng đợi giây lát, hệ thống đang đối soát an toàn với cổng VNPAY.
        </p>
      </div>
    );
  }

  const isSuccess =
    result?.payment.status === "SUCCESS" &&
    ["PAID", "PREPARING", "READY", "COMPLETED"].includes(result.order.status);

  return (
    <div className="max-w-xl mx-auto px-4 py-12 text-center animate-fadeIn">
      <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200/80 dark:border-stone-800 p-8 sm:p-12 shadow-xl space-y-6">
        {isSuccess ? (
          <>
            <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-4xl mx-auto border border-emerald-200 dark:border-emerald-800 shadow-sm animate-bounce">
              ✓
            </div>

            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-950/50 px-3 py-1 rounded-full border border-emerald-200/50 dark:border-emerald-800/50">
                Thanh Toán Thành Công
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-stone-900 dark:text-stone-100">
                Giao dịch VNPAY hoàn tất!
              </h1>
              <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 max-w-sm mx-auto">
                Đơn hàng đã được thanh toán và chuyển đến quầy pha chế của
                Barista.
              </p>
            </div>

            {/* Chi tiết đơn */}
            <div className="bg-stone-50 dark:bg-stone-800/80 rounded-2xl p-4.5 border border-stone-200/70 dark:border-stone-700 text-left space-y-2.5 text-xs text-stone-600 dark:text-stone-300">
              <div className="flex justify-between">
                <span className="text-stone-400 dark:text-stone-500">
                  Mã đơn hàng:
                </span>
                <span className="font-bold text-stone-900 dark:text-stone-100 font-mono text-sm">
                  #{result?.order.id}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-400 dark:text-stone-500">
                  Phương thức:
                </span>
                <span className="font-semibold text-stone-800 dark:text-stone-200">
                  Cổng VNPAY ({result?.payment.bankCode || "QR / Ngân Hàng"})
                </span>
              </div>
              {result?.payment.providerRef && (
                <div className="flex justify-between">
                  <span className="text-stone-400 dark:text-stone-500">
                    Mã giao dịch VNPAY:
                  </span>
                  <span className="font-mono text-stone-800 dark:text-stone-200">
                    {result.payment.providerRef}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-stone-400 dark:text-stone-500">
                  Số tiền thanh toán:
                </span>
                <span className="font-extrabold text-amber-900 dark:text-amber-400 font-mono text-sm">
                  {result?.payment.amount.toLocaleString("vi-VN")}₫
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-stone-200 dark:border-stone-700 text-amber-800 dark:text-amber-400">
                <span>⭐ Tích lũy điểm thưởng:</span>
                <span className="font-bold">
                  +{Math.floor((result?.order.total ?? 0) / 1000)} điểm (cộng
                  khi hoàn tất)
                </span>
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
                className="py-3 px-5 rounded-xl font-semibold text-xs sm:text-sm bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200 transition-colors text-center"
              >
                Về Menu chính
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="w-20 h-20 rounded-full bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center text-4xl mx-auto border border-rose-200 dark:border-rose-800 shadow-sm">
              ✕
            </div>

            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400 bg-rose-100/70 dark:bg-rose-950/50 px-3 py-1 rounded-full border border-rose-200/50 dark:border-rose-800/50">
                Thanh Toán Không Thành Công
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-stone-900 dark:text-stone-100">
                Giao dịch chưa hoàn tất
              </h1>
              <p className="text-xs sm:text-sm text-rose-600 dark:text-rose-400 max-w-sm mx-auto">
                {error ||
                  result?.message ||
                  "Giao dịch bị gián đoạn hoặc khách hàng đã hủy."}
              </p>
            </div>

            {result?.order && (
              <div className="bg-stone-50 dark:bg-stone-800/80 rounded-2xl p-4 border border-stone-200/70 dark:border-stone-700 text-left space-y-2 text-xs text-stone-600 dark:text-stone-300">
                <div className="flex justify-between">
                  <span>Mã đơn:</span>
                  <span className="font-mono font-bold">
                    #{result.order.id}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Trạng thái đơn:</span>
                  <span className="font-bold text-amber-700 dark:text-amber-400">
                    {result.order.status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Tổng tiền:</span>
                  <span className="font-mono font-bold">
                    {result.order.total.toLocaleString("vi-VN")}₫
                  </span>
                </div>
              </div>
            )}

            <div className="pt-2 flex flex-col sm:flex-row gap-3">
              <Link
                href="/orders"
                className="flex-1 py-3 px-4 rounded-xl font-bold text-xs sm:text-sm bg-amber-600 hover:bg-amber-700 text-white shadow-md shadow-amber-600/20 transition-all text-center"
              >
                Xem danh sách đơn hàng
              </Link>
              <Link
                href={
                  result?.order
                    ? `/checkout?orderId=${result.order.id}`
                    : "/checkout"
                }
                className="py-3 px-5 rounded-xl font-semibold text-xs sm:text-sm bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200 transition-colors text-center"
              >
                Thử lại thanh toán
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function VnpayReturnPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-md mx-auto px-4 py-20 text-center">
          <p className="text-stone-500">Đang tải kết quả VNPAY...</p>
        </div>
      }
    >
      <VnpayReturnContent />
    </Suspense>
  );
}
