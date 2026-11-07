import { apiFetch, ApiError } from "@/lib/api/client";
import type { Order, PaymentMethod } from "@/types";

export interface PaymentAttempt {
  orderId: number;
  method: PaymentMethod;
  mockResult?: "SUCCESS" | "FAILED";
  idempotencyKey: string;
  bankCode?: string;
  pointsUsed?: number;
}

export interface CheckoutSession {
  cartKey: string;
  phase: "creating" | "ready" | "paying" | "redirecting" | "failed" | "paid";
  order?: Order;
  attempt?: PaymentAttempt;
  paidMethod?: PaymentMethod;
  paymentUrl?: string;
}

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type Api = typeof apiFetch;
const paidStatuses = ["PAID", "PREPARING", "READY", "COMPLETED"];

function paymentKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID();
  // Development over LAN HTTP may not expose randomUUID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    (character) => {
      const random = Math.floor(Math.random() * 16);
      return (character === "x" ? random : (random & 3) | 8).toString(16);
    },
  );
}

// Persist before sending a mutation. If storage is unavailable, fail before
// creating/charging anything rather than losing the recovery information.
export class CheckoutFlow {
  constructor(
    private storage: Storage,
    private api: Api = apiFetch,
  ) {}

  private key(userId: number) {
    return `brewlite_checkout_v1_${userId}`;
  }

  read(userId: number, orderId?: number): CheckoutSession | null {
    const value = this.storage.getItem(
      orderId ? `${this.key(userId)}_order_${orderId}` : this.key(userId),
    );
    if (!value && orderId) {
      const active = this.read(userId);
      return active?.order?.id === orderId ? active : null;
    }
    return value ? (JSON.parse(value) as CheckoutSession) : null;
  }

  save(userId: number, session: CheckoutSession, activate = true) {
    const value = JSON.stringify(session);
    if (session.order)
      this.storage.setItem(
        `${this.key(userId)}_order_${session.order.id}`,
        value,
      );
    if (activate) this.storage.setItem(this.key(userId), value);
    return session;
  }

  beginCart(userId: number) {
    const existing = this.read(userId);
    if (existing && !existing.order)
      throw new Error(
        "Chưa xác định được kết quả tạo đơn. Hãy kiểm tra lịch sử đơn hàng trước khi đặt lại.",
      );
    if (existing) this.save(userId, existing, false);
    this.storage.removeItem(this.key(userId));
  }

  resetAttempt(userId: number, orderId?: number) {
    const existing = this.read(userId, orderId);
    if (!existing) return null;
    return this.save(
      userId,
      {
        ...existing,
        phase: "ready",
        attempt: undefined,
        paymentUrl: undefined,
      },
      !orderId || this.read(userId)?.order?.id === orderId,
    );
  }

  clear(userId: number, orderId?: number) {
    const targetOrderId = orderId ?? this.read(userId)?.order?.id;
    if (targetOrderId)
      this.storage.removeItem(`${this.key(userId)}_order_${targetOrderId}`);
    if (!orderId || this.read(userId)?.order?.id === orderId)
      this.storage.removeItem(this.key(userId));
  }

  startOrder(userId: number, order: Order) {
    const existing = this.read(userId, order.id);
    return this.save(userId, {
      ...existing,
      cartKey: existing?.cartKey ?? `order_${order.id}`,
      phase: paidStatuses.includes(order.status)
        ? "paid"
        : order.status === "PAYMENT_FAILED"
          ? "failed"
          : (existing?.phase ?? "ready"),
      ...(order.status === "PAYMENT_FAILED"
        ? { attempt: undefined, paymentUrl: undefined }
        : {}),
      order,
    });
  }

  async prepare(userId: number, cartKey: string, payload: unknown) {
    const existing = this.read(userId);
    if (existing) {
      if (!existing.order)
        throw new Error(
          "Chưa xác định được kết quả tạo đơn. Hãy kiểm tra lịch sử đơn hàng trước khi tiếp tục.",
        );
      if (existing.cartKey === cartKey) return existing;
      this.beginCart(userId);
    }
    this.save(userId, { cartKey, phase: "creating" });
    try {
      const order = await this.api<Order>("/orders", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return this.save(userId, { cartKey, phase: "ready", order });
    } catch (error) {
      // A transport error / 5xx may occur after the order was committed.
      if (
        error instanceof ApiError &&
        [400, 401, 403, 404, 409, 422].includes(error.statusCode)
      )
        this.clear(userId);
      throw error;
    }
  }

  async recover(userId: number, orderId: number) {
    const session = this.read(userId);
    if (!session || session.order)
      throw new Error("Không có đơn cần khôi phục.");
    const order = await this.api<Order>(`/orders/${orderId}`);
    return this.save(userId, { ...session, order, phase: "ready" });
  }

  async pay(
    userId: number,
    method: PaymentMethod,
    mockResult?: "SUCCESS" | "FAILED",
    bankCode?: string,
    pointsUsed?: number,
    retry = false,
  ) {
    let session = this.read(userId);
    if (!session?.order) throw new Error("Chưa có đơn hàng để thanh toán.");
    const order = await this.api<Order>(`/orders/${session.order.id}`);
    if (paidStatuses.includes(order.status)) {
      return this.save(
        userId,
        {
          ...session,
          order,
          phase: "paid",
          paidMethod:
            order.payments?.find((p) => p.status === "SUCCESS")?.method ??
            session.attempt?.method ??
            method,
        },
        this.read(userId)?.order?.id === order.id,
      );
    }
    if (order.status === "CANCELLED")
      throw new Error(
        "Đơn đã được hủy. Hãy đóng đơn này trước khi đặt đơn khác.",
      );
    const processing = order.payments?.find((p) => p.status === "PROCESSING");
    if (!retry && !session.attempt && processing) {
      if (
        processing.method === "VNPAY" &&
        processing.paymentUrl &&
        (!processing.expiresAt || Date.parse(processing.expiresAt) > Date.now())
      ) {
        return this.save(
          userId,
          {
            ...session,
            order,
            phase: "redirecting",
            paymentUrl: processing.paymentUrl,
          },
          this.read(userId)?.order?.id === order.id,
        );
      }
      throw new Error("Giao dịch đang được xử lý. Vui lòng kiểm tra lại sau.");
    }
    const shouldCreateNewKey =
      (retry && session.phase !== "paying") ||
      session.phase === "redirecting" ||
      session.phase === "failed" ||
      order.status === "PAYMENT_FAILED";

    const attempt: PaymentAttempt = (shouldCreateNewKey
      ? null
      : session.attempt) ?? {
      orderId: order.id,
      method,
      ...((method === "WALLET" || method === "CARD") && mockResult
        ? { mockResult }
        : {}),
      ...(bankCode ? { bankCode } : {}),
      ...(pointsUsed ? { pointsUsed } : {}),
      idempotencyKey: paymentKey(),
    };
    // Older sessions included this demo field for VNPAY. The backend excludes
    // it from VNPAY's request hash, so removing it preserves replay identity.
    if (attempt.method === "VNPAY") delete attempt.mockResult;
    session = this.save(
      userId,
      {
        ...session,
        order,
        phase: "paying",
        attempt,
      },
      this.read(userId)?.order?.id === order.id,
    );
    try {
      const result = await this.api<{
        payment: {
          id: number;
          method: PaymentMethod;
          status: string;
          paymentUrl?: string | null;
        };
        order: Pick<Order, "id" | "status" | "total" | "pointsEarned">;
      }>("/payments", {
        method: "POST",
        headers: { "Idempotency-Key": attempt.idempotencyKey },
        body: JSON.stringify(attempt),
      });

      if (result.payment.paymentUrl) {
        return this.save(
          userId,
          {
            ...session,
            order: { ...order, ...result.order },
            phase: "redirecting",
            paymentUrl: result.payment.paymentUrl,
          },
          this.read(userId)?.order?.id === order.id,
        );
      }

      return this.save(
        userId,
        {
          ...session,
          order: { ...order, ...result.order },
          phase: "paid",
          paidMethod: result.payment.method,
        },
        this.read(userId)?.order?.id === order.id,
      );
    } catch (error) {
      // Only a definitive declined payment permits a new key. Network errors,
      // 5xx and PAYMENT_IN_PROGRESS retain the exact key AND request body.
      if (error instanceof ApiError && error.statusCode === 402) {
        this.save(
          userId,
          {
            ...session,
            phase: "failed",
            attempt: undefined,
            order: { ...order, status: "PAYMENT_FAILED" },
          },
          this.read(userId)?.order?.id === order.id,
        );
      } else if (
        error instanceof ApiError &&
        [
          "INSUFFICIENT_LOYALTY_POINTS",
          "POINTS_EXCEED_ORDER_TOTAL",
          "INVALID_POINTS_AMOUNT",
          "VNPAY_MIN_AMOUNT_INVALID",
          "VALIDATION_ERROR",
        ].includes(error.code) &&
        [400, 422].includes(error.statusCode)
      ) {
        this.resetAttempt(userId, order.id);
      }
      throw error;
    }
  }

  async cancel(userId: number) {
    const session = this.read(userId);
    if (!session?.order) throw new Error("Chưa xác định được đơn cần hủy.");
    const order = await this.api<Order>(`/orders/${session.order.id}`);
    if (order.status !== "CANCELLED")
      await this.api(`/orders/${order.id}/cancel`, { method: "POST" });
    // A lost cancellation response is safe: the next GET sees CANCELLED.
    this.clear(userId, session.order.id);
  }
}
