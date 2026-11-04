"use client";

import { AuthGate } from "@/components/auth/auth-gate";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { useAuthStore } from "@/store/auth-store";
import { ApiError } from "@/lib/api/client";
import {
  UNIT_LABEL,
  createIngredient,
  getMovements,
  getStock,
  postStock,
  updateIngredient,
  validQuantity,
} from "@/lib/api/inventory";
import type { IngredientUnit, InventoryMovement, StockRow } from "@/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const KIND_LABEL: Record<InventoryMovement["kind"], string> = {
  RECEIPT: "Nhập kho",
  ADJUSTMENT: "Điều chỉnh",
  HOLD: "Giữ cho đơn",
  RELEASE: "Trả lại",
  CONSUME: "Tiêu hao",
};
const card =
  "bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-4 shadow-sm light:bg-cafe-surface light:border-cafe-line light:shadow-cafe-card";
const input =
  "w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-transparent px-3 py-2 text-sm text-stone-900 dark:text-stone-100 light:border-cafe-line light:text-cafe-ink";
const selectStyle =
  `${input} cursor-pointer bg-white dark:bg-stone-900 light:bg-cafe-surface [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-amber-600`;
const optionStyle = "bg-white text-stone-900 dark:bg-stone-900 dark:text-stone-100";
const tableHead = "px-3 py-3 text-left font-semibold whitespace-nowrap";
const tableNumberHead = "px-3 py-3 text-right font-semibold whitespace-nowrap";
const tableCell = "px-3 py-3 align-middle";
const tableNumberCell = "px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap align-middle";

function displayQuantity(value: string | number) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(number)
    : String(value);
}

const btn =
  "rounded-lg bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white font-bold text-xs py-2 px-3 cursor-pointer";

function errorText(e: unknown) {
  return e instanceof ApiError || e instanceof Error ? e.message : "Đã có lỗi xảy ra";
}

export default function BaristaInventoryPage() {
  const userId = useAuthStore((s) => s.user?.id);
  return (
    <AuthGate path="/barista/inventory" barista>
      <InventoryContent key={userId} />
    </AuthGate>
  );
}

function InventoryContent() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<StockRow | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);

  const [newIng, setNewIng] = useState({ code: "", name: "", unit: "GRAM" as IngredientUnit });
  const [stockForm, setStockForm] = useState({
    kind: "receipts" as "receipts" | "adjustments",
    quantity: "",
    reason: "",
    key: crypto.randomUUID(),
  });

  const load = useCallback(async () => {
    try {
      setRows(await getStock());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  const loadMovements = useCallback(async (id?: number) => {
    try {
      setMovements((await getMovements({ ingredientId: id, limit: 20 })).data);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getStock(controller.signal)
      .then((data) => { setRows(data); setError(null); })
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(errorText(e)); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    getMovements({ ingredientId: selected?.id, limit: 20 }, controller.signal)
      .then((r) => setMovements(r.data))
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(errorText(e)); });
    return () => controller.abort();
  }, [selected?.id]);

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await action();
      setNotice(ok);
      await load();
      await loadMovements(selected?.id);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitIngredient(e: React.FormEvent) {
    e.preventDefault();
    if (!newIng.code.trim() || !newIng.name.trim()) return setError("Nhập mã và tên nguyên liệu.");
    if (await run(() => createIngredient(newIng), "Đã thêm nguyên liệu."))
      setNewIng({ code: "", name: "", unit: "GRAM" });
  }

  async function submitStock(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const signed = stockForm.kind === "adjustments";
    if (!validQuantity(stockForm.quantity, selected.unit, signed))
      return setError(
        selected.unit === "PIECE" ? "Số lượng phải là số nguyên khác 0." : "Số lượng không hợp lệ (tối đa 3 chữ số thập phân).",
      );
    if (!stockForm.reason.trim()) return setError("Nhập lý do.");
    const ok = await run(
      () =>
        postStock(
          stockForm.kind,
          { ingredientId: selected.id, quantity: stockForm.quantity.trim(), reason: stockForm.reason.trim() },
          stockForm.key,
        ),
      signed ? "Đã điều chỉnh tồn kho." : "Đã nhập kho.",
    );
    // Chỉ tạo khóa mới khi thành công; nếu lỗi mạng, gửi lại dùng cùng khóa để không nhập trùng.
    if (ok) setStockForm((f) => ({ ...f, quantity: "", reason: "", key: crypto.randomUUID() }));
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 light:bg-cafe-bg p-4 md:p-6 space-y-4">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-black text-stone-900 dark:text-stone-100 light:text-cafe-ink">Nguyên liệu &amp; Kho</h1>
          <p className="text-xs text-stone-500 dark:text-stone-400 light:text-cafe-muted">
            Quản lý danh mục nguyên liệu, nhập kho, điều chỉnh và xem lịch sử.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/barista" className="text-xs font-bold text-amber-700 hover:underline">
            ← Bếp
          </Link>
          <ThemeToggle />
        </div>
      </header>

      {error && <div role="alert" className="rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-sm px-3 py-2">{error}</div>}
      {notice && <div role="status" className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-sm px-3 py-2">{notice}</div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className={`${card} lg:col-span-2 min-w-0`}>
          <h2 className="font-bold text-sm mb-3 text-stone-900 dark:text-stone-100 light:text-cafe-ink">Tồn kho</h2>
          {loading ? (
            <p className="text-xs text-stone-500">Đang tải…</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-stone-500">Chưa có nguyên liệu.</p>
          ) : (
            <div className="w-full overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-800">
              <table className="w-full min-w-[950px] border-collapse text-xs sm:text-sm">
                <thead className="bg-stone-100 text-stone-600 dark:bg-stone-800/70 dark:text-stone-300 light:text-cafe-muted">
                  <tr>
                    <th className={tableHead}>Mã</th>
                    <th className={tableHead}>Tên nguyên liệu</th>
                    <th className={tableNumberHead}>Tồn</th>
                    <th className={tableNumberHead}>Đang giữ</th>
                    <th className={tableNumberHead}>Khả dụng</th>
                    <th className={tableHead}>Trạng thái</th>
                    <th className="px-3 py-3 text-right font-semibold">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="text-stone-800 dark:text-stone-200 light:text-cafe-ink">
                  {rows.map((r) => (
                    <tr key={r.id} className={`border-t border-stone-200 dark:border-stone-800 hover:bg-stone-100/70 dark:hover:bg-stone-800/40 ${selected?.id === r.id ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}>
                      <td className={`${tableCell} font-mono text-xs whitespace-nowrap`}>{r.code}</td>
                      <td className={`${tableCell} min-w-[140px] font-medium`}>{r.name}</td>
                      <td className={tableNumberCell}>{displayQuantity(r.stockQuantity)} {UNIT_LABEL[r.unit]}</td>
                      <td className={tableNumberCell}>{displayQuantity(r.reservedQuantity)}</td>
                      <td className={`${tableNumberCell} ${Number(r.availableQuantity) <= 0 ? "text-rose-600 font-bold" : ""}`}>{displayQuantity(r.availableQuantity)}</td>
                      <td className={tableCell}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => run(() => updateIngredient(r.id, { isActive: !r.isActive }), r.isActive ? "Đã ngừng dùng." : "Đã kích hoạt.")}
                          className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap disabled:opacity-50 ${r.isActive ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-700"}`}
                          title="Bấm để đổi trạng thái"
                        >
                          {r.isActive ? "Đang dùng" : "Ngừng"}
                        </button>
                      </td>
                      <td className={`${tableCell} text-right`}>
                        <button type="button" className="whitespace-nowrap text-amber-600 font-bold hover:underline cursor-pointer" onClick={() => setSelected(selected?.id === r.id ? null : r)}>
                          {selected?.id === r.id ? "Bỏ chọn" : "Chọn"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="space-y-4">
          <form onSubmit={submitIngredient} className={`${card} space-y-2`}>
            <h2 className="font-bold text-sm text-stone-900 dark:text-stone-100 light:text-cafe-ink">Thêm nguyên liệu</h2>
            <input aria-label="Mã" placeholder="Mã (VD: COFFEE_BEANS)" className={input} maxLength={100} value={newIng.code} onChange={(e) => setNewIng({ ...newIng, code: e.target.value })} />
            <input aria-label="Tên" placeholder="Tên" className={input} maxLength={200} value={newIng.name} onChange={(e) => setNewIng({ ...newIng, name: e.target.value })} />
            <label htmlFor="ingredient-unit" className="block text-xs font-semibold text-stone-600 dark:text-stone-300">Đơn vị tính</label>
            <select id="ingredient-unit" aria-label="Đơn vị" className={selectStyle} value={newIng.unit} onChange={(e) => setNewIng({ ...newIng, unit: e.target.value as IngredientUnit })}>
              <option className={optionStyle} value="GRAM">Gram (g)</option>
              <option className={optionStyle} value="MILLILITRE">Mililit (ml)</option>
              <option className={optionStyle} value="PIECE">Cái</option>
            </select>
            <button type="submit" disabled={busy} className={btn}>Thêm</button>
          </form>

          <form onSubmit={submitStock} className={`${card} space-y-2`}>
            <h2 className="font-bold text-sm text-stone-900 dark:text-stone-100 light:text-cafe-ink">
              Nhập / điều chỉnh kho {selected ? `– ${selected.name}` : ""}
            </h2>
            {!selected ? (
              <p className="text-xs text-stone-500">Chọn một nguyên liệu trong bảng.</p>
            ) : (
              <>
                <label htmlFor="stock-operation" className="block text-xs font-semibold text-stone-600 dark:text-stone-300">Loại thao tác</label>
                <select id="stock-operation" aria-label="Loại" className={selectStyle} value={stockForm.kind} onChange={(e) => setStockForm({ ...stockForm, kind: e.target.value as "receipts" | "adjustments", key: crypto.randomUUID() })}>
                  <option className={optionStyle} value="receipts">Nhập kho (+)</option>
                  <option className={optionStyle} value="adjustments">Điều chỉnh (±, VD: -50)</option>
                </select>
                <input aria-label="Số lượng" placeholder={`Số lượng (${UNIT_LABEL[selected.unit]})`} className={input} inputMode="decimal" value={stockForm.quantity} onChange={(e) => setStockForm({ ...stockForm, quantity: e.target.value })} />
                <input aria-label="Lý do" placeholder="Lý do" className={input} maxLength={500} value={stockForm.reason} onChange={(e) => setStockForm({ ...stockForm, reason: e.target.value })} />
                <button type="submit" disabled={busy} className={btn}>Xác nhận</button>
              </>
            )}
          </form>
        </div>
      </div>

      <section className={`${card} min-w-0`}>
        <h2 className="font-bold text-sm mb-3 text-stone-900 dark:text-stone-100 light:text-cafe-ink">
          Lịch sử biến động {selected ? `– ${selected.name}` : "(tất cả)"}
        </h2>
        {movements.length === 0 ? (
          <p className="text-xs text-stone-500">Chưa có biến động.</p>
        ) : (
          <div className="w-full overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-800">
            <table className="w-full min-w-[820px] border-collapse text-xs sm:text-sm text-stone-800 dark:text-stone-200 light:text-cafe-ink">
              <thead className="bg-stone-100 dark:bg-stone-800/70 text-stone-600 dark:text-stone-300">
                <tr>
                  <th className={tableHead}>Thời gian</th>
                  <th className={tableHead}>Nguyên liệu</th>
                  <th className={tableHead}>Loại</th>
                  <th className={tableNumberHead}>Δ Tồn</th>
                  <th className={tableNumberHead}>Δ Giữ</th>
                  <th className={tableHead}>Lý do</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-t border-stone-200 dark:border-stone-800">
                    <td className={`${tableCell} whitespace-nowrap`}>{new Date(m.createdAt).toLocaleString("vi-VN")}</td>
                    <td className={tableCell}>{m.ingredient?.name ?? m.ingredientId}</td>
                    <td className={`${tableCell} whitespace-nowrap`}>{KIND_LABEL[m.kind]}</td>
                    <td className={tableNumberCell}>{displayQuantity(m.stockDelta)}</td>
                    <td className={tableNumberCell}>{displayQuantity(m.reservedDelta)}</td>
                    <td className={`${tableCell} min-w-[200px] break-words`}>{m.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
