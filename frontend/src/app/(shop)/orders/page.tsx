"use client";

import { Modal } from "@/components/ui/modal";
import { AuthGate } from "@/components/auth/auth-gate";
import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useAuthStore } from "@/store/auth-store";
import { apiFetch, ApiError } from "@/lib/api/client";
import { StatusBadge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { CheckoutFlow } from "@/lib/checkout-flow";
import type { Order, PaginatedResponse } from "@/types";

interface OrderSummary {
  id: number;
  code: string;
  status: Order["status"];
  total: number;
  itemCount: number;
  createdAt: string;
}

export default function MyOrdersPage() {
  const userId = useAuthStore((state) => state.user?.id);
  return (
    <AuthGate path="/orders">
      <OrdersContent key={userId} />
    </AuthGate>
  );
}

function OrdersContent() {
  const { user, token, refreshUser } = useAuthStore();

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalOrders, setTotalOrders] = useState(0);
  const listRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchMyOrders = useCallback(async () => {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<PaginatedResponse<OrderSummary>>(
        `/orders/me?limit=20&page=${page}`,
        { token: token ?? undefined, signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      if (page > res.meta.totalPages) {
        setPage(res.meta.totalPages);
        return;
      }
      setOrders(res.data);
      setTotalPages(res.meta.totalPages);
      setTotalOrders(res.meta.total);
    } catch (err) {
      if (controller.signal.aborted) return;
      setErrorMsg(
        err instanceof ApiError
          ? err.message
          : "Không thể tải lịch sử đơn hàng. Vui lòng thử lại.",
      );
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [page, token]);

  useEffect(() => {
    const initial = setTimeout(() => void fetchMyOrders(), 0);
    return () => {
      clearTimeout(initial);
      listRequest.current?.abort();
    };
  }, [fetchMyOrders]);
  useEffect(
    () => () => {
      detailRequest.current?.abort();
    },
    [],
  );
  const closeDetail = () => {
    detailRequest.current?.abort();
    setSelectedOrder(null);
    setIsLoadingDetail(false);
  };
  const changePage = (next: number) => {
    setOrders([]);
    setIsLoading(true);
    closeDetail();
    setPage(next);
  };

  // Tải chi tiết một đơn hàng khi bấm xem
  const handleViewOrderDetail = async (orderId: number) => {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setIsLoadingDetail(true);
    try {
      const detail = await apiFetch<Order>(`/orders/${orderId}`, {
        token: token ?? undefined,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setSelectedOrder(detail);
    } catch (err) {
      if (!controller.signal.aborted)
        alert(
          err instanceof ApiError
            ? err.message
            : "Không thể xem chi tiết đơn hàng",
        );
    } finally {
      if (!controller.signal.aborted) setIsLoadingDetail(false);
    }
  };

  // Hủy đơn hàng (POST /api/orders/:id/cancel)
  const handleCancelOrder = async (orderId: number) => {
    if (
      !confirm(
        "Bạn có chắc chắn muốn hủy đơn hàng này? Toàn bộ tồn kho, mã giảm giá và tiền sẽ được hoàn trả.",
      )
    ) {
      return;
    }

    setIsCancelling(true);
    try {
      await apiFetch(`/orders/${orderId}/cancel`, {
        method: "POST",
        token: token ?? undefined,
      });

      alert(
        "Đã hủy đơn hàng thành công! Tồn kho và quyền lợi đã được hoàn lại.",
      );
      // Đóng modal và tải lại danh sách
      setSelectedOrder(null);
      await Promise.all([fetchMyOrders(), refreshUser()]);
    } catch (err) {
      alert(
        err instanceof ApiError ? err.message : "Không thể hủy đơn hàng này",
      );
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="w-full py-2 sm:py-4">
      {/* Breadcrumb & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-stone-200 dark:border-stone-800 light:border-cafe-line ">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 mb-1 light:text-cafe-muted ">
            <Link href="/" className="hover:text-amber-800 dark:hover:text-amber-400 light:hover:text-cafe-primary ">
              Trang chủ
            </Link>
            <span>/</span>
            <Link href="/menu" className="hover:text-amber-800 dark:hover:text-amber-400 light:hover:text-cafe-primary ">
              Menu
            </Link>
            <span>/</span>
            <span className="text-stone-800 dark:text-stone-200 font-medium light:text-cafe-ink ">Lịch sử đơn hàng</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-stone-900 dark:text-stone-100 tracking-tight light:text-cafe-ink ">
            Lịch Sử Đơn Hàng
          </h1>
        </div>

        {user && (
          <div className="bg-amber-50/50 dark:bg-[#1c1612] border border-amber-200/80 dark:border-[#33261f] rounded-2xl px-4 py-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-3 light:text-cafe-primary ">
            <div>
              <span className="text-stone-400 dark:text-[#7d6e62] block text-[10px] light:text-cafe-muted ">
                Tài khoản:
              </span>
              <span className="font-bold text-stone-800 dark:text-[#f4ede6] light:text-cafe-ink ">{user.fullName}</span>
            </div>
            <div className="border-l border-amber-200 dark:border-[#33261f] pl-3">
              <span className="text-stone-400 dark:text-[#7d6e62] block text-[10px] light:text-cafe-muted ">
                Điểm tích lũy:
              </span>
              <span className="font-black text-amber-800 dark:text-amber-400 light:text-cafe-primary ">
                {user.loyaltyPoints} điểm
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between items-center mb-4 text-sm text-stone-600 dark:text-[#9e8f83] light:text-cafe-muted ">
        <span>{totalOrders} đơn hàng</span>
        <button
          onClick={() => void fetchMyOrders()}
          disabled={isLoading}
          className="underline hover:text-amber-600 dark:hover:text-amber-400 cursor-pointer light:hover:text-cafe-primary "
        >
          Làm mới trạng thái
        </button>
      </div>
      {isLoadingDetail && (
        <p role="status" className="p-3 bg-amber-50/70 dark:bg-[#1c1612] text-amber-900 dark:text-amber-200 rounded-xl mb-4 text-xs border border-amber-200/50 dark:border-[#33261f] light:text-cafe-primary ">
          Đang tải chi tiết đơn hàng...
        </p>
      )}
      {/* Loading state */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="bg-white dark:bg-[#161210] rounded-2xl border border-[#ede5dc] dark:border-[#2a221c] p-5 animate-pulse space-y-3 light:bg-cafe-surface light:border-cafe-line "
            >
              <div className="h-4 bg-stone-200 dark:bg-[#281f19] rounded w-1/4 light:bg-cafe-line " />
              <div className="h-3 bg-stone-200 dark:bg-[#281f19] rounded w-1/2 light:bg-cafe-line " />
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {!isLoading && errorMsg && (
        <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-2xl p-6 text-center text-xs text-rose-700 dark:text-rose-300 space-y-2">
          <p className="font-bold">{errorMsg}</p>
          <button
            onClick={fetchMyOrders}
            className="bg-rose-600 text-white px-3 py-1.5 rounded-lg font-semibold text-xs cursor-pointer"
          >
            Thử lại
          </button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !errorMsg && orders.length === 0 && (
        <div className="bg-white dark:bg-[#161210] rounded-3xl border border-[#ede5dc] dark:border-[#2a221c] p-12 text-center max-w-md mx-auto shadow-sm space-y-4 my-8 light:bg-cafe-surface light:border-cafe-line light:shadow-cafe-card ">
          <span className="text-5xl block">☕</span>
          <h3 className="text-lg font-bold text-stone-900 dark:text-[#f4ede6] light:text-cafe-ink ">
            Bạn chưa có đơn hàng nào
          </h3>
          <p className="text-xs text-stone-500 dark:text-[#a39589] light:text-cafe-muted ">
            Hãy chọn những ly cà phê hoặc thức uống tươi ngon ngay trên menu
            nhé!
          </p>
          <Link
            href="/menu"
            className="inline-block bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-sm transition-all light:shadow-cafe-card cafe-primary "
          >
            Xem Menu đặt món
          </Link>
        </div>
      )}

      {/* Danh sách đơn hàng */}
      {!isLoading && !errorMsg && orders.length > 0 && (
        <div className="space-y-3.5">
          {orders.map((order) => {
            const dateStr = new Date(order.createdAt).toLocaleString("vi-VN", {
              hour: "2-digit",
              minute: "2-digit",
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            });

            return (
              <div
                key={order.id}
                className="bg-white dark:bg-[#181310] rounded-2xl border border-[#ede5dc] dark:border-[#261f1a] p-5 shadow-sm hover:shadow-md transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 light:bg-cafe-surface light:border-cafe-line light:shadow-cafe-card light:hover:shadow-cafe-card "
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-3">
                    <span className="font-extrabold text-stone-900 dark:text-[#f4ede6] font-mono text-base light:text-cafe-ink ">
                      {order.code}
                    </span>
                    <StatusBadge status={order.status} />
                  </div>
                  <div className="text-xs text-stone-500 dark:text-[#9e8f83] flex items-center gap-2 light:text-cafe-muted ">
                    <span>🕒 {dateStr}</span>
                    <span>•</span>
                    <span>{order.itemCount} ly đồ uống</span>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto gap-4 pt-2 sm:pt-0 border-t sm:border-t-0 border-[#ede5dc] dark:border-[#261f1a] light:border-cafe-line ">
                  <div className="text-right">
                    <span className="text-xs text-stone-400 dark:text-[#7d6e62] block light:text-cafe-muted ">
                      Tổng tiền
                    </span>
                    <span className="font-black text-amber-900 dark:text-amber-400 font-mono text-base light:text-cafe-primary ">
                      {order.total.toLocaleString("vi-VN")}₫
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {["PENDING", "PAYMENT_FAILED"].includes(order.status) && (
                      <Link
                        href="/checkout"
                        onClick={async () => {
                          if (user) {
                            try {
                              await new CheckoutFlow(window.sessionStorage).recover(user.id, order.id);
                            } catch {
                              // session may already exist
                            }
                          }
                        }}
                        className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-3.5 py-2 rounded-xl transition-all cursor-pointer shadow-sm shadow-amber-600/25 inline-flex items-center"
                      >
                        Thanh toán tiếp →
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => handleViewOrderDetail(order.id)}
                      className="bg-amber-500/10 dark:bg-amber-500/15 hover:bg-amber-500/20 text-amber-900 dark:text-amber-200 border border-amber-500/30 font-bold text-xs px-3.5 py-2 rounded-xl transition-all cursor-pointer light:text-cafe-primary "
                    >
                      Chi tiết →
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Chi Tiết Đơn Hàng */}
      <Pagination
        page={page}
        totalPages={totalPages}
        onChange={changePage}
        disabled={isLoading}
      />
      {selectedOrder && (
        <Modal onClose={closeDetail} labelledBy="order-detail-title">
          <div className="relative z-10 w-full max-w-lg bg-[#fdfbf9] dark:bg-[#161210] rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh] border border-[#ede5dc] dark:border-[#2a221c] animate-fadeIn light:bg-cafe-surface light:shadow-cafe-card light:border-cafe-line ">
            {/* Modal Header */}
            <div className="p-5 bg-stone-50 dark:bg-[#1a1411] border-b border-[#ede5dc] dark:border-[#2a221c] flex items-center justify-between light:bg-cafe-page light:border-cafe-line ">
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 id="order-detail-title" className="text-lg font-black text-stone-900 dark:text-[#f4ede6] font-mono light:text-cafe-ink ">
                    {selectedOrder.code}
                  </h2>
                  <StatusBadge status={selectedOrder.status} />
                </div>
                <span className="text-[11px] text-stone-500 dark:text-[#9e8f83] light:text-cafe-muted ">
                  Đặt lúc:{" "}
                  {new Date(selectedOrder.createdAt).toLocaleString("vi-VN")}
                </span>
              </div>
              <button
                onClick={closeDetail}
                className="w-8 h-8 rounded-full bg-stone-200 dark:bg-[#281f19] hover:bg-stone-300 dark:hover:bg-[#33261f] text-stone-700 dark:text-[#cfc3b9] flex items-center justify-center text-xs cursor-pointer transition-colors light:bg-cafe-line light:hover:bg-cafe-line light:text-cafe-ink "
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-5 flex-1">
              {/* Danh sách món */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-[#9e8f83] mb-2 light:text-cafe-muted ">
                  Danh sách món đã đặt
                </h3>
                <div className="space-y-2">
                  {selectedOrder.items.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 bg-white dark:bg-[#1a1411] rounded-xl border border-[#ede5dc] dark:border-[#2a221c] text-xs space-y-1 light:bg-cafe-surface light:border-cafe-line "
                    >
                      <div className="flex justify-between font-semibold text-stone-900 dark:text-[#f4ede6] light:text-cafe-ink ">
                        <span>
                          {item.qty}x {item.productName} ({item.size})
                        </span>
                        <span className="font-mono text-amber-900 dark:text-amber-400 light:text-cafe-primary ">
                          {item.lineTotal.toLocaleString("vi-VN")}₫
                        </span>
                      </div>
                      {item.toppings && item.toppings.length > 0 && (
                        <div className="text-[11px] text-stone-500 dark:text-[#9e8f83] light:text-cafe-muted ">
                          Topping: {item.toppings.map((t) => t.name).join(", ")}
                        </div>
                      )}
                      {item.note && (
                        <div className="text-[11px] text-amber-800 dark:text-amber-300 light:text-cafe-primary ">
                          Ghi chú: {item.note}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Tóm tắt thanh toán */}
              <div className="bg-white dark:bg-[#1a1411] rounded-xl p-3.5 border border-[#ede5dc] dark:border-[#2a221c] space-y-1.5 text-xs text-stone-600 dark:text-[#9e8f83] light:bg-cafe-surface light:border-cafe-line light:text-cafe-muted ">
                <div className="flex justify-between">
                  <span>Tiền hàng:</span>
                  <span className="font-mono text-stone-800 dark:text-[#f4ede6] light:text-cafe-ink ">
                    {selectedOrder.subtotal.toLocaleString("vi-VN")}₫
                  </span>
                </div>
                {selectedOrder.discountAmount > 0 && (
                  <div className="flex justify-between text-emerald-700 dark:text-emerald-400 font-medium">
                    <span>Giảm giá ({selectedOrder.promoCode}):</span>
                    <span className="font-mono">
                      -{selectedOrder.discountAmount.toLocaleString("vi-VN")}₫
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-amber-800 dark:text-amber-400 font-medium light:text-cafe-primary ">
                  <span>Điểm thưởng nhận được:</span>
                  <span>+{selectedOrder.pointsEarned} điểm</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-[#ede5dc] dark:border-[#2a221c] text-stone-900 dark:text-[#f4ede6] font-black text-sm light:border-cafe-line light:text-cafe-ink ">
                  <span>Tổng thanh toán:</span>
                  <span className="font-mono text-amber-900 dark:text-amber-400 light:text-cafe-primary ">
                    {selectedOrder.total.toLocaleString("vi-VN")}₫
                  </span>
                </div>
              </div>

              {/* Lịch sử giao dịch thanh toán */}
              {selectedOrder.payments && selectedOrder.payments.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-2 light:text-cafe-muted ">
                    Lịch sử giao dịch thanh toán
                  </h3>
                  <div className="space-y-1.5 text-[11px]">
                    {selectedOrder.payments.map((p) => {
                      const isNeedsRefund = p.status === "NEEDS_REFUND";
                      const isRefunded =
                        !!p.refundedAt ||
                        (typeof p.refundedAmount === "number" &&
                          p.refundedAmount > 0);
                      return (
                        <div
                          key={p.id}
                          className="p-2.5 bg-stone-50 dark:bg-stone-800/50 rounded-lg border border-stone-200/50 dark:border-stone-700 flex justify-between items-center light:bg-cafe-page light:border-cafe-line "
                        >
                          <div>
                            <span className="font-semibold block text-stone-800 dark:text-stone-200 light:text-cafe-ink ">
                              {p.method === "VNPAY"
                                ? "Cổng VNPAY"
                                : p.method === "WALLET"
                                  ? "Ví điện tử"
                                  : "Thẻ ngân hàng"}
                            </span>
                            <span className="text-stone-400 dark:text-stone-500 font-mono light:text-cafe-muted ">
                              {p.providerRef || p.gatewayTxnRef || `GD #${p.id}`}
                            </span>
                          </div>
                          <div className="text-right">
                            <span
                              className={`font-bold block ${
                                p.status === "SUCCESS"
                                  ? "text-emerald-700 dark:text-emerald-400"
                                  : isNeedsRefund
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-rose-600 dark:text-rose-400"
                              }`}
                            >
                              {p.status}
                            </span>
                            {isRefunded ? (
                              <span className="text-emerald-600 dark:text-emerald-400 font-semibold block text-[10px]">
                                Đã hoàn tiền
                              </span>
                            ) : isNeedsRefund ? (
                              <span className="text-amber-600 dark:text-amber-400 font-semibold block text-[10px] animate-pulse">
                                Đang hoàn tiền
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer: Nút Hủy đơn (chỉ cho phép nếu trạng thái PENDING, PAYMENT_FAILED, hoặc PAID) */}
            <div className="p-4 bg-stone-50 dark:bg-stone-800/60 border-t border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3 light:bg-cafe-page light:border-cafe-line ">
              <div className="flex items-center gap-2">
                {["PENDING", "PAYMENT_FAILED"].includes(
                  selectedOrder.status,
                ) && (
                  <Link
                    href="/checkout"
                    onClick={async () => {
                      if (user) {
                        try {
                          await new CheckoutFlow(window.sessionStorage).recover(
                            user.id,
                            selectedOrder.id,
                          );
                        } catch {
                          // ignore
                        }
                      }
                    }}
                    className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all cursor-pointer shadow-sm shadow-amber-600/25 inline-flex items-center"
                  >
                    Thanh toán tiếp →
                  </Link>
                )}
                {["PENDING", "PAYMENT_FAILED", "PAID"].includes(
                  selectedOrder.status,
                ) ? (
                  <button
                    type="button"
                    onClick={() => handleCancelOrder(selectedOrder.id)}
                    disabled={isCancelling}
                    className="bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/50 font-bold text-xs px-4 py-2.5 rounded-xl transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isCancelling ? "Đang hủy..." : "Hủy đơn hàng này"}
                  </button>
                ) : (
                  <span className="text-[11px] text-stone-400 dark:text-stone-500 self-center light:text-cafe-muted ">
                    (Đơn hàng đang làm hoặc đã xong, không thể hủy)
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={closeDetail}
                className="bg-stone-800 hover:bg-stone-900 text-white font-semibold text-xs px-5 py-2.5 rounded-xl transition-all cursor-pointer ml-auto light:bg-cafe-ink light:hover:bg-cafe-ink "
              >
                Đóng
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
