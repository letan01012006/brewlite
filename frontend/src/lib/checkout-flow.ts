import { apiFetch, ApiError } from "@/lib/api/client";
import type { Order, PaymentMethod } from "@/types";

export interface PaymentAttempt {
  orderId: number;
  method: PaymentMethod;
  mockResult: "SUCCESS" | "FAILED";
  idempotencyKey: string;
}

export interface CheckoutSession {
  cartKey: string;
  phase: "creating" | "ready" | "paying" | "failed" | "paid";
  order?: Order;
  attempt?: PaymentAttempt;
  paidMethod?: PaymentMethod;
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

  read(userId: number): CheckoutSession | null {
    const value = this.storage.getItem(this.key(userId));
    return value ? (JSON.parse(value) as CheckoutSession) : null;
  }

  private save(userId: number, session: CheckoutSession) {
    this.storage.setItem(this.key(userId), JSON.stringify(session));
    return session;
  }

  clear(userId: number) {
    this.storage.removeItem(this.key(userId));
  }

  async prepare(userId: number, cartKey: string, payload: unknown) {
    const existing = this.read(userId);
    if (existing) {
      if (!existing.order)
        throw new Error(
          "Chưa xác định được kết quả tạo đơn. Hãy kiểm tra lịch sử đơn hàng trước khi tiếp tục.",
        );
      return existing;
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
    mockResult: "SUCCESS" | "FAILED",
  ) {
    let session = this.read(userId);
    if (!session?.order) throw new Error("Chưa có đơn hàng để thanh toán.");
    const order = await this.api<Order>(`/orders/${session.order.id}`);
    if (paidStatuses.includes(order.status)) {
      return this.save(userId, {
        ...session,
        order,
        phase: "paid",
        paidMethod:
          order.payments?.find((p) => p.status === "SUCCESS")?.method ??
          session.attempt?.method ??
          method,
      });
    }
    if (order.status === "CANCELLED")
      throw new Error(
        "Đơn đã được hủy. Hãy đóng đơn này trước khi đặt đơn khác.",
      );
    if (
      !session.attempt &&
      order.payments?.some((p) => p.status === "PROCESSING")
    ) {
      throw new Error("Giao dịch đang được xử lý. Vui lòng kiểm tra lại sau.");
    }
    const attempt = session.attempt ?? {
      orderId: order.id,
      method,
      mockResult,
      idempotencyKey: paymentKey(),
    };
    session = this.save(userId, {
      ...session,
      order,
      phase: "paying",
      attempt,
    });
    try {
      const result = await this.api<{
        payment: { method: PaymentMethod };
        order: Pick<Order, "id" | "status" | "total" | "pointsEarned">;
      }>("/payments", { method: "POST", body: JSON.stringify(attempt) });
      return this.save(userId, {
        ...session,
        order: { ...order, ...result.order },
        phase: "paid",
        paidMethod: result.payment.method,
      });
    } catch (error) {
      // Only a definitive declined payment permits a new key. Network errors,
      // 5xx and PAYMENT_IN_PROGRESS retain the exact key AND request body.
      if (
        error instanceof ApiError &&
        error.statusCode === 402 &&
        error.code === "PAYMENT_FAILED"
      ) {
        this.save(userId, {
          ...session,
          phase: "failed",
          attempt: undefined,
          order: { ...order, status: "PAYMENT_FAILED" },
        });
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
    this.clear(userId);
  }
}
