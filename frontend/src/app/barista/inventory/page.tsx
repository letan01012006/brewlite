"use client";

import { AuthGate } from "@/components/auth/auth-gate";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { useAuthStore } from "@/store/auth-store";
import { ApiError } from "@/lib/api/client";
import { getProductImageUrl } from "@/lib/constants/product-images";
import {
  UNIT_LABEL,
  UNIT_NAME,
  calculateRecipeCups,
  calculateToppingServings,
  createIngredient,
  createTopping,
  getMovementTypeLabel,
  getMovements,
  getPreparedToppings,
  getProductRecipe,
  getProductsCatalog,
  getStock,
  postStock,
  saveProductRecipe,
  saveToppingRecipe,
  updateIngredient,
  updateProductStatus,
  validQuantity,
} from "@/lib/api/inventory";
import type {
  IngredientUnit,
  InventoryMovement,
  MovementKindFilter,
  PreparedTopping,
  Product,
  Size,
  StockRow,
} from "@/types";
import Link from "next/link";
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

const SIZES: Size[] = ["S", "M", "L"];

const KIND_BADGE: Record<InventoryMovement["kind"], string> = {
  RECEIPT:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300/60 dark:border-emerald-800/60",
  ADJUSTMENT:
    "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300/60 dark:border-rose-800/60",
  HOLD:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300/60 dark:border-amber-800/60",
  RELEASE:
    "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-300/60 dark:border-sky-800/60",
  CONSUME:
    "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-300/60 dark:border-purple-800/60",
};

function getMovementBadgeClass(m: InventoryMovement): string {
  if (m.kind === "ADJUSTMENT" && Number(m.stockDelta) > 0) {
    return "bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-300/60 dark:border-teal-800/60";
  }
  return KIND_BADGE[m.kind];
}

const cardClass =
  "bg-white dark:bg-[#181310] rounded-2xl border border-stone-200/90 dark:border-stone-800 p-5 shadow-sm light:bg-cafe-surface light:border-cafe-line light:shadow-cafe-card";
const inputClass =
  "w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3.5 py-2.5 text-sm text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/80 light:bg-cafe-surface light:border-cafe-line light:text-cafe-ink";
const primaryBtnClass =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white font-bold text-xs sm:text-sm py-2.5 px-4 shadow-sm transition-all cursor-pointer disabled:cursor-not-allowed";
const secondaryBtnClass =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-800 dark:text-stone-200 font-semibold text-xs sm:text-sm py-2.5 px-4 transition-all cursor-pointer light:bg-cafe-surface light:border-cafe-line light:text-cafe-ink";

function displayQuantity(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "0";
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(number)
    : String(value);
}

function sanitizePositiveInput(raw: string) {
  return raw.replace(/-/g, "");
}

function errorText(e: unknown) {
  return e instanceof ApiError || e instanceof Error
    ? e.message
    : "Đã có lỗi xảy ra. Vui lòng thử lại.";
}

interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  sublabel?: string;
  badge?: string;
}

/**
 * Custom accessible dropdown (tránh lỗi nền trắng chữ nhạt của native select trên Windows Chrome dark mode).
 */
function CustomSelect<T extends string = string>({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  id?: string;
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  const generatedId = useId();
  const buttonId = id ?? generatedId;
  const listboxId = `${buttonId}-listbox`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selected = options[selectedIndex] ?? options[0];

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled || options.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setActiveIndex(selectedIndex);
        setOpen(true);
      } else {
        setActiveIndex((i) => (i + 1) % options.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setActiveIndex(selectedIndex);
        setOpen(true);
      } else {
        setActiveIndex((i) => (i - 1 + options.length) % options.length);
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) {
        setActiveIndex(selectedIndex);
        setOpen(true);
      } else if (options[activeIndex]) {
        onChange(options[activeIndex].value);
        setOpen(false);
      }
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        id={buttonId}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => {
          if (!disabled) {
            setActiveIndex(selectedIndex);
            setOpen((o) => !o);
          }
        }}
        onKeyDown={handleKeyDown}
        className={`${inputClass} flex items-center justify-between gap-2 text-left cursor-pointer disabled:opacity-50`}
      >
        <span className="truncate font-medium">
          {selected ? selected.label : "Chọn..."}
          {selected?.sublabel ? (
            <span className="ml-1.5 text-xs text-stone-500 dark:text-stone-400 font-normal">
              ({selected.sublabel})
            </span>
          ) : null}
        </span>
        <span className="text-stone-400 dark:text-stone-500 text-xs shrink-0">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && options.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="absolute z-50 mt-1.5 max-h-64 w-full overflow-y-auto rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-[#1f1916] p-1.5 shadow-xl ring-1 ring-black/10 dark:ring-white/10"
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isFocused = idx === activeIndex;
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs sm:text-sm cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-amber-600 text-white font-bold"
                    : isFocused
                      ? "bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
                      : "text-stone-800 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate">{opt.label}</div>
                  {opt.sublabel && (
                    <div
                      className={`text-[11px] truncate ${
                        isSelected
                          ? "text-amber-100"
                          : "text-stone-500 dark:text-stone-400"
                      }`}
                    >
                      {opt.sublabel}
                    </div>
                  )}
                </div>
                {opt.badge && (
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-mono ${
                      isSelected
                        ? "bg-amber-700 text-white"
                        : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300"
                    }`}
                  >
                    {opt.badge}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
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
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const [toppings, setToppings] = useState<PreparedTopping[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);
  const [toppingsError, setToppingsError] = useState<string | null>(null);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [togglingProductIds, setTogglingProductIds] = useState<
    Record<number, boolean>
  >({});

  const handleToggleProductStatus = useCallback(async (product: Product) => {
    const currentActive = product.isActive !== false;
    const nextActive = !currentActive;
    setTogglingProductIds((prev) => ({ ...prev, [product.id]: true }));
    setError(null);
    try {
      const updated = await updateProductStatus(product.id, nextActive);
      setProducts((prev) =>
        prev.map((p) =>
          p.id === product.id
            ? { ...p, ...updated, isActive: updated.isActive }
            : p,
        ),
      );
      setNotice(
        nextActive
          ? `Đã mở bán lại món "${product.name}".`
          : `Đã tạm dừng bán món "${product.name}".`,
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setTogglingProductIds((prev) => ({ ...prev, [product.id]: false }));
    }
  }, []);

  const [togglingIngredientIds, setTogglingIngredientIds] = useState<
    Record<number, boolean>
  >({});
  const handleToggleIngredientStatus = useCallback(
    async (ingredient: StockRow) => {
      const currentActive = ingredient.isActive;
      const nextActive = !currentActive;
      const confirmed = window.confirm(
        nextActive
          ? `Kích hoạt lại nguyên liệu "${ingredient.name}"?\nCác món và topping sử dụng nguyên liệu này sẽ tính lại khả năng phục vụ theo tồn kho.`
          : `Tạm dừng nguyên liệu "${ingredient.name}"?\nCác món và topping sử dụng nguyên liệu này sẽ tạm dừng phục vụ các size tương ứng.`,
      );
      if (!confirmed) return;

      setTogglingIngredientIds((prev) => ({ ...prev, [ingredient.id]: true }));
      setError(null);
      try {
        const updated = await updateIngredient(ingredient.id, {
          isActive: nextActive,
        });
        setStockRows((prev) =>
          prev.map((r) =>
            r.id === ingredient.id
              ? { ...r, ...updated, isActive: updated.isActive }
              : r,
          ),
        );
        setNotice(
          nextActive
            ? `Đã kích hoạt lại nguyên liệu "${ingredient.name}".`
            : `Đã tạm dừng nguyên liệu "${ingredient.name}".`,
        );
        void getProductsCatalog()
          .then((prods) => setProducts(prods))
          .catch(() => {});
      } catch (err) {
        setError(errorText(err));
      } finally {
        setTogglingIngredientIds((prev) => ({
          ...prev,
          [ingredient.id]: false,
        }));
      }
    },
    [],
  );

  // Active modals
  const [activeModal, setActiveModal] = useState<
    | null
    | { type: "receipt"; defaultTarget?: string }
    | { type: "wastage"; defaultTarget?: string }
    | { type: "history"; defaultIngredientId?: number }
    | { type: "add-ingredient" }
    | { type: "add-topping"; editTopping?: PreparedTopping }
    | { type: "recipe"; product: Product }
  >(null);

  const applySettledLoad = useCallback(
    (
      results: [
        PromiseSettledResult<StockRow[]>,
        PromiseSettledResult<PreparedTopping[]>,
        PromiseSettledResult<Product[]>,
      ],
    ) => {
      const [stockRes, topRes, prodRes] = results;
      const errors: string[] = [];

      if (stockRes.status === "fulfilled") {
        setStockRows(stockRes.value);
        setStockError(null);
      } else {
        const msg = errorText(stockRes.reason);
        setStockError(msg);
        errors.push(`Nguyên liệu kho: ${msg}`);
      }

      if (topRes.status === "fulfilled") {
        setToppings(topRes.value);
        setToppingsError(null);
      } else {
        const msg = errorText(topRes.reason);
        setToppingsError(msg);
        errors.push(`Topping: ${msg}`);
      }

      if (prodRes.status === "fulfilled") {
        setProducts(prodRes.value);
        setProductsError(null);
      } else {
        const msg = errorText(prodRes.reason);
        setProductsError(msg);
        errors.push(`Sản phẩm: ${msg}`);
      }

      setError(errors.length > 0 ? errors.join(" · ") : null);
    },
    [],
  );

  const loadAll = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const results = await Promise.allSettled([
          getStock(signal),
          getPreparedToppings(signal),
          getProductsCatalog(signal),
        ]);
        if (signal?.aborted) return;
        applySettledLoad(results);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [applySettledLoad],
  );

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      getStock(controller.signal),
      getPreparedToppings(controller.signal),
      getProductsCatalog(controller.signal),
    ])
      .then((results) => {
        if (controller.signal.aborted) return;
        applySettledLoad(results);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [applySettledLoad]);

  const stockById = useMemo(
    () => new Map(stockRows.map((row) => [row.id, row])),
    [stockRows],
  );

  // Unified target options for Receipt / Wastage / History filter: includes both Ingredients and Linked Toppings
  const stockTargetOptions = useMemo<SelectOption<string>[]>(() => {
    const ingOpts: SelectOption<string>[] = stockRows
      .filter((r) => r.isActive)
      .map((r) => ({
        value: `ing:${r.id}`,
        label: `Nguyên liệu: ${r.name}`,
        sublabel: `Đơn vị: ${UNIT_LABEL[r.unit]}`,
        badge: `Khả dụng: ${displayQuantity(r.availableQuantity)} ${UNIT_LABEL[r.unit]}`,
      }));
    const topOpts: SelectOption<string>[] = toppings
      .filter((t) => t.ingredientId !== null)
      .map((t) => {
        const linked = t.ingredientId ? stockById.get(t.ingredientId) : undefined;
        const servings = linked
          ? calculateToppingServings(
              linked.availableQuantity,
              t.quantityPerServing,
            )
          : null;
        return {
          value: `top:${t.id}:${t.ingredientId}`,
          label: `Topping: ${t.name}`,
          sublabel: linked
            ? `Kho: ${linked.name} (${displayQuantity(t.quantityPerServing)} ${UNIT_LABEL[linked.unit]}/phần)`
            : undefined,
          badge:
            servings !== null && linked
              ? `${displayQuantity(servings)} phần (${displayQuantity(linked.availableQuantity)} ${UNIT_LABEL[linked.unit]})`
              : undefined,
        };
      });
    return [...ingOpts, ...topOpts];
  }, [stockRows, toppings, stockById]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q),
    );
  }, [products, productSearch]);

  const lowStockCount = useMemo(
    () => stockRows.filter((r) => Number(r.availableQuantity) <= 0).length,
    [stockRows],
  );
  const reservedActiveCount = useMemo(
    () => stockRows.filter((r) => Number(r.reservedQuantity) > 0).length,
    [stockRows],
  );

  return (
    <div className="min-h-screen bg-[#f8f5f0] dark:bg-[#0f0c0a] light:bg-cafe-bg text-stone-900 dark:text-stone-100">
      {/* Top Bar */}
      <div className="bg-[#1c1410] dark:bg-[#0c0a09] border-b border-stone-800 px-4 md:px-6 py-2.5 flex items-center justify-between text-stone-100 light:bg-cafe-surface light:border-cafe-line light:text-cafe-ink">
        <div className="flex items-center gap-3">
          <Link
            href="/barista"
            className="text-xs font-semibold text-stone-300 hover:text-amber-400 flex items-center gap-1.5 transition-colors light:text-cafe-muted"
          >
            <span>←</span>
            <span>Quầy pha chế (Barista)</span>
          </Link>
          <span className="text-stone-600">•</span>
          <Link
            href="/menu"
            className="text-xs font-semibold text-stone-300 hover:text-amber-400 transition-colors light:text-cafe-muted"
          >
            Thực đơn khách
          </Link>
        </div>
        <ThemeToggle />
      </div>

      <main className="max-w-[1600px] mx-auto px-4 md:px-6 py-5 space-y-5">
        {/* Page Header + 3 Action Buttons on Top Right */}
        <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 bg-white dark:bg-[#181310] rounded-2xl border border-stone-200/90 dark:border-stone-800 p-4 md:p-5 shadow-sm light:bg-cafe-surface light:border-cafe-line light:shadow-cafe-card">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl md:text-2xl font-black tracking-tight text-stone-900 dark:text-stone-100 light:text-cafe-ink">
                Nguyên liệu &amp; Kho pha chế
              </h1>
              <span className="rounded-full bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 px-2.5 py-0.5 text-xs font-bold">
                {loading
                  ? "Đang tải…"
                  : `${stockError ? "Lỗi tải" : stockRows.length} nguyên liệu · ${toppingsError ? "Lỗi tải" : toppings.length} topping`}
              </span>
              {reservedActiveCount > 0 && (
                <span className="rounded-full bg-purple-100 dark:bg-purple-950/70 text-purple-800 dark:text-purple-300 px-2.5 py-0.5 text-xs font-bold">
                  {reservedActiveCount} nguyên liệu đang giữ cho đơn
                </span>
              )}
              {lowStockCount > 0 && (
                <span className="rounded-full bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 px-2.5 py-0.5 text-xs font-bold">
                  {lowStockCount} mặt hàng hết khả dụng
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 light:text-cafe-muted">
              <strong className="font-semibold text-stone-700 dark:text-stone-300">
                Tồn
              </strong>{" "}
              là lượng hiện đang có ·{" "}
              <strong className="font-semibold text-amber-700 dark:text-amber-400">
                Đang giữ
              </strong>{" "}
              là lượng tạm giữ để pha đơn đã thanh toán ·{" "}
              <strong className="font-semibold text-emerald-700 dark:text-emerald-400">
                Khả dụng = Tồn − Đang giữ
              </strong>
            </p>
          </div>

          {/* 3 Action Buttons on Top Right */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveModal({ type: "receipt" })}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm py-2.5 px-4 shadow-sm transition-all cursor-pointer"
            >
              <span>＋</span>
              <span>Nhập kho</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveModal({ type: "wastage" })}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs sm:text-sm py-2.5 px-4 shadow-sm transition-all cursor-pointer"
            >
              <span>－</span>
              <span>Ghi nhận hao hụt</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveModal({ type: "history" })}
              className={secondaryBtnClass}
            >
              <span>◷</span>
              <span>Lịch sử biến động</span>
            </button>
          </div>
        </header>

        {/* Feedback Banners */}
        {error && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-xl border border-rose-300 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 text-sm px-4 py-3"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-xs font-bold underline cursor-pointer"
            >
              Đóng
            </button>
          </div>
        )}
        {notice && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 rounded-xl border border-emerald-300 dark:border-emerald-800/80 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 text-sm px-4 py-3"
          >
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-xs font-bold underline cursor-pointer"
            >
              Đóng
            </button>
          </div>
        )}

        {/* Main 60% / 40% Split Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT (~60% = 7/12 columns): Ingredients Table on top, Prepared Toppings Table below */}
          <div className="lg:col-span-7 space-y-6 min-w-0">
            {/* 1. Bảng nguyên liệu pha chế */}
            <section className={cardClass} aria-labelledby="heading-ingredients">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-stone-200/80 dark:border-stone-800 light:border-cafe-line">
                <div>
                  <h2
                    id="heading-ingredients"
                    className="text-base sm:text-lg font-extrabold text-stone-900 dark:text-stone-100 light:text-cafe-ink"
                  >
                    Bảng nguyên liệu pha chế
                  </h2>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    Định lượng tồn thực tế, lượng đang giữ cho đơn và lượng khả dụng theo đơn vị gốc
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveModal({ type: "add-ingredient" })}
                  className={primaryBtnClass}
                >
                  + Thêm nguyên liệu
                </button>
              </div>

              {loading ? (
                <div className="py-12 text-center text-sm text-stone-500 dark:text-stone-400">
                  Đang tải dữ liệu nguyên liệu kho…
                </div>
              ) : stockError ? (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-300 dark:border-rose-800/80 bg-rose-50/70 dark:bg-rose-950/40 p-6 text-center space-y-3"
                >
                  <p className="text-sm font-semibold text-rose-700 dark:text-rose-200">
                    Không thể tải danh sách nguyên liệu kho: {stockError}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setLoading(true);
                      void loadAll();
                    }}
                    className={secondaryBtnClass}
                  >
                    Thử tải lại
                  </button>
                </div>
              ) : stockRows.length === 0 ? (
                <div className="py-12 text-center text-sm text-stone-500 dark:text-stone-400">
                  Chưa có nguyên liệu nào trong kho. Hãy bấm &ldquo;+ Thêm nguyên liệu&rdquo; để tạo mới.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-stone-200/80 dark:border-stone-800">
                  <table className="w-full border-collapse text-xs sm:text-sm">
                    <thead className="bg-stone-100/90 dark:bg-stone-900/90 text-stone-600 dark:text-stone-300 border-b border-stone-200 dark:border-stone-800">
                      <tr>
                        <th className="px-4 py-3 text-left font-bold">Tên nguyên liệu</th>
                        <th className="px-4 py-3 text-right font-bold">Tồn</th>
                        <th className="px-4 py-3 text-right font-bold">Đang giữ</th>
                        <th className="px-4 py-3 text-right font-bold">Khả dụng</th>
                        <th className="px-4 py-3 text-right font-bold">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200/70 dark:divide-stone-800/80">
                      {stockRows.map((row) => {
                        const unit = UNIT_LABEL[row.unit];
                        const reservedNum = Number(row.reservedQuantity);
                        const availNum = Number(row.availableQuantity);
                        return (
                          <tr
                            key={row.id}
                            className="hover:bg-amber-50/40 dark:hover:bg-stone-800/40 transition-colors"
                          >
                            <td className="px-4 py-3 font-semibold text-stone-900 dark:text-stone-100">
                              <span>{row.name}</span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums text-stone-800 dark:text-stone-200 whitespace-nowrap">
                              <span className="font-semibold">
                                {displayQuantity(row.stockQuantity)}
                              </span>{" "}
                              <span className="text-xs text-stone-500 dark:text-stone-400">
                                {unit}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                              <span
                                className={
                                  reservedNum > 0
                                    ? "font-bold text-amber-700 dark:text-amber-400"
                                    : "text-stone-500 dark:text-stone-400"
                                }
                              >
                                {displayQuantity(row.reservedQuantity)}
                              </span>{" "}
                              <span className="text-xs text-stone-500 dark:text-stone-400">
                                {unit}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-bold ${
                                  availNum <= 0
                                    ? "bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300"
                                    : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                                }`}
                              >
                                <span>{displayQuantity(row.availableQuantity)}</span>
                                <span className="text-xs font-normal opacity-80">
                                  {unit}
                                </span>
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-2">
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold border ${
                                    row.isActive
                                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                                      : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-800"
                                  }`}
                                >
                                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                                  <span>{row.isActive ? "Hoạt động" : "Tạm dừng"}</span>
                                </span>
                                <button
                                  type="button"
                                  disabled={togglingIngredientIds[row.id]}
                                  onClick={() => handleToggleIngredientStatus(row)}
                                  className={`inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-xs font-bold border transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                                    row.isActive
                                      ? "border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 dark:hover:bg-rose-950/50 dark:hover:text-rose-300 dark:hover:border-rose-800 text-stone-700 dark:text-stone-300"
                                      : "border-emerald-500/70 bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs"
                                  }`}
                                >
                                  {togglingIngredientIds[row.id]
                                    ? "Đang xử lý…"
                                    : row.isActive
                                      ? "Tạm dừng"
                                      : "Kích hoạt lại"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* 2. Bảng topping đã chuẩn bị */}
            <section className={cardClass} aria-labelledby="heading-toppings">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-stone-200/80 dark:border-stone-800 light:border-cafe-line">
                <div>
                  <h2
                    id="heading-toppings"
                    className="text-base sm:text-lg font-extrabold text-stone-900 dark:text-stone-100 light:text-cafe-ink"
                  >
                    Bảng topping đã chuẩn bị
                  </h2>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    Liên kết trực tiếp với nguyên liệu kho; hiển thị định lượng mỗi phần và số phần khả dụng
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveModal({ type: "add-topping" })}
                  className={primaryBtnClass}
                >
                  + Thêm topping
                </button>
              </div>

              {loading ? (
                <div className="py-10 text-center text-sm text-stone-500 dark:text-stone-400">
                  Đang tải danh sách topping…
                </div>
              ) : toppingsError ? (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-300 dark:border-rose-800/80 bg-rose-50/70 dark:bg-rose-950/40 p-6 text-center space-y-3"
                >
                  <p className="text-sm font-semibold text-rose-700 dark:text-rose-200">
                    Không thể tải danh sách topping: {toppingsError}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setLoading(true);
                      void loadAll();
                    }}
                    className={secondaryBtnClass}
                  >
                    Thử tải lại
                  </button>
                </div>
              ) : toppings.length === 0 ? (
                <div className="py-10 text-center text-sm text-stone-500 dark:text-stone-400">
                  Chưa có topping nào. Hãy bấm &ldquo;+ Thêm topping&rdquo; để tạo mới.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-stone-200/80 dark:border-stone-800">
                  <table className="w-full border-collapse text-xs sm:text-sm">
                    <thead className="bg-stone-100/90 dark:bg-stone-900/90 text-stone-600 dark:text-stone-300 border-b border-stone-200 dark:border-stone-800">
                      <tr>
                        <th className="px-3.5 py-3 text-left font-bold">Tên topping</th>
                        <th className="px-3.5 py-3 text-right font-bold">Tồn</th>
                        <th className="px-3.5 py-3 text-right font-bold">Đang giữ</th>
                        <th className="px-3.5 py-3 text-right font-bold">Khả dụng</th>
                        <th className="px-3.5 py-3 text-right font-bold">Định lượng / phần</th>
                        <th className="px-3.5 py-3 text-right font-bold">Số phần khả dụng</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200/70 dark:divide-stone-800/80">
                      {toppings.map((top) => {
                        const linked = top.ingredientId
                          ? stockById.get(top.ingredientId)
                          : undefined;
                        const unit = linked ? UNIT_LABEL[linked.unit] : "";
                        const isLinkedPaused = linked ? !linked.isActive : false;
                        const servings = linked
                          ? calculateToppingServings(
                              linked.availableQuantity,
                              top.quantityPerServing,
                              linked.isActive,
                            )
                          : null;

                        return (
                          <tr
                            key={top.id}
                            className="hover:bg-amber-50/40 dark:hover:bg-stone-800/40 transition-colors"
                          >
                            <td className="px-3.5 py-3">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-stone-900 dark:text-stone-100">{top.name}</span>
                                {isLinkedPaused && (
                                  <span className="rounded bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 px-1.5 py-0.5 text-[10px] font-bold">
                                    NL tạm dừng
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-stone-500 dark:text-stone-400">
                                {top.price.toLocaleString("vi-VN")}₫/phần
                                {linked ? ` · Kho: ${linked.name}` : " · Chưa gắn nguyên liệu kho"}
                              </div>
                            </td>
                            {linked ? (
                              <>
                                <td className="px-3.5 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                                  <span className="font-semibold">
                                    {displayQuantity(linked.stockQuantity)}
                                  </span>{" "}
                                  <span className="text-xs text-stone-500 dark:text-stone-400">
                                    {unit}
                                  </span>
                                </td>
                                <td className="px-3.5 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                                  <span
                                    className={
                                      Number(linked.reservedQuantity) > 0
                                        ? "font-bold text-amber-700 dark:text-amber-400"
                                        : "text-stone-500 dark:text-stone-400"
                                    }
                                  >
                                    {displayQuantity(linked.reservedQuantity)}
                                  </span>{" "}
                                  <span className="text-xs text-stone-500 dark:text-stone-400">
                                    {unit}
                                  </span>
                                </td>
                                <td className="px-3.5 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                                  <span className="font-semibold text-stone-900 dark:text-stone-100">
                                    {displayQuantity(linked.availableQuantity)}
                                  </span>{" "}
                                  <span className="text-xs text-stone-500 dark:text-stone-400">
                                    {unit}
                                  </span>
                                </td>
                                <td className="px-3.5 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                                  {top.quantityPerServing ? (
                                    <span>
                                      {displayQuantity(top.quantityPerServing)} {unit}/phần
                                    </span>
                                  ) : (
                                    <span className="text-amber-600 dark:text-amber-400 text-xs">
                                      Chưa cấu hình
                                    </span>
                                  )}
                                </td>
                                <td className="px-3.5 py-3 text-right font-mono tabular-nums whitespace-nowrap">
                                  {servings !== null ? (
                                    <span
                                      className={`inline-flex items-center rounded-lg px-2.5 py-1 font-bold ${
                                        isLinkedPaused
                                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
                                          : servings <= 0
                                            ? "bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300"
                                            : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                                      }`}
                                    >
                                      {isLinkedPaused ? "Tạm dừng NL" : `${displayQuantity(servings)} phần`}
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setActiveModal({
                                          type: "add-topping",
                                          editTopping: top,
                                        })
                                      }
                                      className="text-xs font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                                    >
                                      Gắn định lượng
                                    </button>
                                  )}
                                </td>
                              </>
                            ) : (
                              <td
                                colSpan={5}
                                className="px-3.5 py-3 text-right text-xs text-amber-700 dark:text-amber-400"
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActiveModal({
                                      type: "add-topping",
                                      editTopping: top,
                                    })
                                  }
                                  className="font-bold underline cursor-pointer"
                                >
                                  Chưa liên kết nguyên liệu kho — bấm để cấu hình định lượng
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {/* RIGHT (~40% = 5/12 columns): Product Cards with Image & Per-Size Available Cups */}
          <aside className="lg:col-span-5 min-w-0">
            <section className={cardClass} aria-labelledby="heading-products">
              <div className="space-y-3 pb-4 mb-4 border-b border-stone-200/80 dark:border-stone-800 light:border-cafe-line">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2
                      id="heading-products"
                      className="text-base sm:text-lg font-extrabold text-stone-900 dark:text-stone-100 light:text-cafe-ink"
                    >
                      Danh sách sản phẩm &amp; Công thức
                    </h2>
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                      Số ly khả dụng tính trực tiếp từ nguyên liệu khả dụng và công thức từng size. Bấm vào món để cấu hình S / M / L.
                    </p>
                  </div>
                </div>
                <input
                  type="search"
                  aria-label="Tìm sản phẩm"
                  placeholder="Tìm kiếm món theo tên hoặc danh mục…"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className={inputClass}
                />
              </div>

              {loading ? (
                <div className="py-12 text-center text-sm text-stone-500 dark:text-stone-400">
                  Đang tải danh sách sản phẩm…
                </div>
              ) : productsError ? (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-300 dark:border-rose-800/80 bg-rose-50/70 dark:bg-rose-950/40 p-6 text-center space-y-3"
                >
                  <p className="text-sm font-semibold text-rose-700 dark:text-rose-200">
                    Không thể tải danh sách sản phẩm: {productsError}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setLoading(true);
                      void loadAll();
                    }}
                    className={secondaryBtnClass}
                  >
                    Thử tải lại
                  </button>
                </div>
              ) : products.length === 0 ? (
                <div className="py-12 text-center text-sm text-stone-500 dark:text-stone-400">
                  Chưa có sản phẩm nào trong thực đơn.
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="py-12 text-center text-sm text-stone-500 dark:text-stone-400">
                  Không tìm thấy sản phẩm phù hợp với từ khóa.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3.5">
                  {filteredProducts.map((product) => (
                    <ProductRecipeCard
                      key={product.id}
                      product={product}
                      toggling={Boolean(togglingProductIds[product.id])}
                      onToggleStatus={() =>
                        void handleToggleProductStatus(product)
                      }
                      onOpenRecipe={() =>
                        setActiveModal({ type: "recipe", product })
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          </aside>
        </div>
      </main>

      {/* MODAL 1: NHẬP KHO */}
      {activeModal?.type === "receipt" && (
        <StockOperationModal
          mode="receipt"
          options={stockTargetOptions}
          stockById={stockById}
          toppings={toppings}
          onClose={() => setActiveModal(null)}
          onSuccess={async (msg) => {
            setNotice(msg);
            setActiveModal(null);
            await loadAll();
          }}
        />
      )}

      {/* MODAL 2: GHI NHẬN HAO HỤT */}
      {activeModal?.type === "wastage" && (
        <StockOperationModal
          mode="wastage"
          options={stockTargetOptions}
          stockById={stockById}
          toppings={toppings}
          onClose={() => setActiveModal(null)}
          onSuccess={async (msg) => {
            setNotice(msg);
            setActiveModal(null);
            await loadAll();
          }}
        />
      )}

      {/* MODAL 3: LỊCH SỬ BIẾN ĐỘNG */}
      {activeModal?.type === "history" && (
        <MovementHistoryModal
          options={stockTargetOptions}
          onClose={() => setActiveModal(null)}
        />
      )}

      {/* MODAL 4: THÊM NGUYÊN LIỆU */}
      {activeModal?.type === "add-ingredient" && (
        <AddIngredientModal
          onClose={() => setActiveModal(null)}
          onSuccess={async (created) => {
            setNotice(
              `Đã thêm nguyên liệu "${created.name}" (tồn ban đầu = 0 ${UNIT_LABEL[created.unit]}). Hãy dùng Nhập kho để bổ sung số lượng.`,
            );
            setActiveModal(null);
            await loadAll();
          }}
        />
      )}

      {/* MODAL 5: THÊM / CẤU HÌNH TOPPING */}
      {activeModal?.type === "add-topping" && (
        <AddToppingModal
          stockRows={stockRows}
          editTopping={activeModal.editTopping}
          onClose={() => setActiveModal(null)}
          onSuccess={async (msg) => {
            setNotice(msg);
            setActiveModal(null);
            await loadAll();
          }}
        />
      )}

      {/* MODAL 6: CÔNG THỨC SẢN PHẨM */}
      {activeModal?.type === "recipe" && (
        <ProductRecipeModal
          product={activeModal.product}
          stockRows={stockRows}
          stockById={stockById}
          onClose={() => setActiveModal(null)}
          onSaved={async (msg) => {
            setNotice(msg);
            await loadAll();
          }}
        />
      )}
    </div>
  );
}

/**
 * Thẻ sản phẩm bên phải: hiển thị ảnh, tên, danh mục, trạng thái Đang bán / Tạm dừng (độc lập với tồn kho),
 * nút Tạm dừng / Mở bán lại, và số ly khả dụng thực tế theo từng size S / M / L.
 */
function ProductRecipeCard({
  product,
  toggling,
  onToggleStatus,
  onOpenRecipe,
}: {
  product: Product;
  toggling: boolean;
  onToggleStatus: () => void;
  onOpenRecipe: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const isSelling = product.isActive !== false;
  const imageSrc = getProductImageUrl(
    product.name,
    product.category,
    product.imageUrl,
  );

  return (
    <div
      className={`group w-full text-left rounded-2xl border p-3.5 transition-all flex flex-col justify-between gap-3 light:bg-cafe-surface light:border-cafe-line ${
        isSelling
          ? "border-stone-200/90 dark:border-stone-800 bg-stone-50/70 dark:bg-[#1f1916] hover:border-amber-500/70 dark:hover:border-amber-500/60 hover:shadow-md"
          : "border-stone-300/90 dark:border-stone-800 bg-stone-100/80 dark:bg-[#171311] opacity-90"
      }`}
    >
      <div className="flex items-start gap-3.5">
        <button
          type="button"
          onClick={onOpenRecipe}
          className="relative h-20 w-20 shrink-0 rounded-xl overflow-hidden bg-stone-200 dark:bg-stone-800 border border-stone-200/60 dark:border-stone-700 flex items-center justify-center cursor-pointer"
          aria-label={`Xem công thức ${product.name}`}
        >
          {!imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              loading="lazy"
              src={imageSrc}
              alt={product.name}
              onError={() => setImgError(true)}
              className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-200"
            />
          ) : (
            <span className="text-2xl">☕</span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <span className="inline-block rounded-md bg-amber-100/90 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
              {product.category}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                isSelling
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300/60 dark:border-emerald-800/60"
                  : "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300 border-stone-300 dark:border-stone-700"
              }`}
            >
              <span>{isSelling ? "●" : "⏸"}</span>
              <span>{isSelling ? "Đang bán" : "Tạm dừng"}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenRecipe}
            className="mt-1 block w-full text-left cursor-pointer"
          >
            <h3 className="font-extrabold text-sm sm:text-base text-stone-900 dark:text-stone-100 group-hover:text-amber-700 dark:group-hover:text-amber-400 truncate">
              {product.name}
            </h3>
            <p className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold mt-0.5">
              Bấm để xem / sửa công thức →
            </p>
          </button>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={toggling}
              onClick={onToggleStatus}
              className={`inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-[11px] font-bold border transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                isSelling
                  ? "border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 dark:hover:bg-rose-950/50 dark:hover:text-rose-300 dark:hover:border-rose-800 text-stone-700 dark:text-stone-300"
                  : "border-emerald-500/70 bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs"
              }`}
            >
              {toggling
                ? "Đang xử lý…"
                : isSelling
                  ? "Tạm dừng"
                  : "Mở bán lại"}
            </button>
          </div>
        </div>
      </div>

      {/* Số ly khả dụng theo từng size S / M / L (độc lập với trạng thái bán) */}
      <button
        type="button"
        onClick={onOpenRecipe}
        className="grid grid-cols-3 gap-1.5 pt-2 border-t border-stone-200/70 dark:border-stone-800 w-full cursor-pointer"
      >
        {SIZES.map((size) => {
          const entry = product.availability?.find((a) => a.size === size);
          const unconfigured = entry?.reason === "RECIPE_UNAVAILABLE";
          const isPausedIngredient = entry?.reason === "INGREDIENT_PAUSED";
          const shortage = entry?.reason === "INSUFFICIENT_INGREDIENTS";
          const cups = entry?.maxQuantity ?? 0;

          return (
            <div
              key={size}
              className={`rounded-xl px-2 py-1.5 text-center border ${
                unconfigured
                  ? "bg-stone-100/80 dark:bg-stone-900/60 border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-400"
                  : isPausedIngredient
                    ? "bg-amber-100/80 dark:bg-amber-950/50 border-amber-400/80 dark:border-amber-700 text-amber-900 dark:text-amber-200"
                    : shortage || cups <= 0
                      ? "bg-rose-50/80 dark:bg-rose-950/40 border-rose-300/70 dark:border-rose-800/60 text-rose-700 dark:text-rose-300"
                      : "bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-300/60 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300"
              }`}
            >
              <div className="text-[10px] font-bold uppercase opacity-80">
                Size {size}
              </div>
              <div className="font-mono font-extrabold text-xs truncate">
                {unconfigured
                  ? "Chưa có CT"
                  : isPausedIngredient
                    ? "Tạm dừng NL"
                    : shortage || cups <= 0
                      ? "0 ly (Thiếu)"
                      : `${displayQuantity(cups)} ly`}
              </div>
            </div>
          );
        })}
      </button>
    </div>
  );
}

/**
 * Cửa sổ Nhập kho / Ghi nhận hao hụt (dùng chung cho cả nguyên liệu và topping).
 * Không cho phép nhập dấu âm; kiểm tra không vượt phần khả dụng khi ghi nhận hao hụt.
 */
function StockOperationModal({
  mode,
  options,
  stockById,
  toppings,
  onClose,
  onSuccess,
}: {
  mode: "receipt" | "wastage";
  options: SelectOption<string>[];
  stockById: Map<number, StockRow>;
  toppings: PreparedTopping[];
  onClose: () => void;
  onSuccess: (msg: string) => Promise<void>;
}) {
  const isWastage = mode === "wastage";
  const [target, setTarget] = useState<string>(options[0]?.value ?? "");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Resolve target ("ing:12" or "top:3:12") to ingredient row & optional topping
  const resolved = useMemo(() => {
    if (!target) return null;
    const parts = target.split(":");
    if (parts[0] === "ing") {
      const ing = stockById.get(Number(parts[1]));
      return ing ? { ingredient: ing, topping: undefined } : null;
    }
    if (parts[0] === "top") {
      const top = toppings.find((t) => t.id === Number(parts[1]));
      const ing = stockById.get(Number(parts[2]));
      return ing ? { ingredient: ing, topping: top } : null;
    }
    return null;
  }, [target, stockById, toppings]);

  const unitLabel = resolved ? UNIT_LABEL[resolved.ingredient.unit] : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setModalError(null);
    if (!resolved) {
      setModalError("Vui lòng chọn nguyên liệu hoặc topping.");
      return;
    }
    const cleanQty = sanitizePositiveInput(quantity).trim();
    if (!validQuantity(cleanQty, resolved.ingredient.unit, false)) {
      setModalError(
        resolved.ingredient.unit === "PIECE"
          ? "Số lượng phải là số nguyên dương lớn hơn 0."
          : "Số lượng phải là số dương lớn hơn 0 (tối đa 3 chữ số thập phân).",
      );
      return;
    }
    if (isWastage) {
      const avail = Number(resolved.ingredient.availableQuantity);
      if (Number(cleanQty) > avail) {
        setModalError(
          `Lượng hao hụt (${displayQuantity(cleanQty)} ${unitLabel}) không được vượt quá lượng khả dụng hiện tại (${displayQuantity(avail)} ${unitLabel}).`,
        );
        return;
      }
      if (!reason.trim()) {
        setModalError("Vui lòng nhập lý do hao hụt.");
        return;
      }
    }

    setBusy(true);
    try {
      await postStock(
        isWastage ? "adjustments" : "receipts",
        {
          ingredientId: resolved.ingredient.id,
          quantity: cleanQty,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
        idempotencyKey,
      );
      const itemLabel = resolved.topping
        ? `topping "${resolved.topping.name}" (kho ${resolved.ingredient.name})`
        : `nguyên liệu "${resolved.ingredient.name}"`;
      await onSuccess(
        isWastage
          ? `Đã ghi nhận hao hụt ${displayQuantity(cleanQty)} ${unitLabel} cho ${itemLabel}.`
          : `Đã nhập kho +${displayQuantity(cleanQty)} ${unitLabel} cho ${itemLabel}.`,
      );
    } catch (err) {
      setModalError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="stock-modal-title">
      <div className="w-full max-w-lg rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#181310] p-6 shadow-2xl space-y-4 text-stone-900 dark:text-stone-100">
        <div className="flex items-start justify-between gap-3 border-b border-stone-200 dark:border-stone-800 pb-3">
          <div>
            <h2 id="stock-modal-title" className="text-lg font-black">
              {isWastage ? "Ghi nhận hao hụt kho" : "Nhập thêm hàng vào kho"}
            </h2>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              {isWastage
                ? "Chọn nguyên liệu hoặc topping, nhập lượng hao hụt bằng số dương và ghi rõ lý do."
                : "Chọn nguyên liệu hoặc topping cần nhập thêm và nhập số lượng dương."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 text-lg font-bold cursor-pointer"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        {modalError && (
          <div
            role="alert"
            className="rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 px-3.5 py-2.5 text-xs sm:text-sm text-rose-700 dark:text-rose-200"
          >
            {modalError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="stock-target-select"
              className="block text-xs font-bold text-stone-700 dark:text-stone-300"
            >
              Mặt hàng (Nguyên liệu hoặc Topping)
            </label>
            <CustomSelect
              id="stock-target-select"
              label="Chọn mặt hàng"
              value={target}
              options={options}
              onChange={(next) => {
                setTarget(next);
                setIdempotencyKey(crypto.randomUUID());
              }}
            />
          </div>

          {resolved && (
            <div className="rounded-xl bg-stone-100/80 dark:bg-stone-900/80 border border-stone-200/80 dark:border-stone-800 px-3.5 py-2.5 text-xs grid grid-cols-3 gap-2">
              <div>
                <div className="text-stone-500 dark:text-stone-400">Tồn hiện tại</div>
                <div className="font-mono font-bold">
                  {displayQuantity(resolved.ingredient.stockQuantity)} {unitLabel}
                </div>
              </div>
              <div>
                <div className="text-stone-500 dark:text-stone-400">Đang giữ</div>
                <div className="font-mono font-bold text-amber-700 dark:text-amber-400">
                  {displayQuantity(resolved.ingredient.reservedQuantity)} {unitLabel}
                </div>
              </div>
              <div>
                <div className="text-stone-500 dark:text-stone-400">Khả dụng</div>
                <div className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                  {displayQuantity(resolved.ingredient.availableQuantity)} {unitLabel}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="stock-quantity-input"
              className="block text-xs font-bold text-stone-700 dark:text-stone-300"
            >
              {isWastage
                ? `Lượng hao hụt (${unitLabel || "đơn vị"}) — nhập số dương`
                : `Số lượng nhập thêm (${unitLabel || "đơn vị"}) — nhập số dương`}
            </label>
            <input
              id="stock-quantity-input"
              aria-label="Số lượng"
              inputMode="decimal"
              placeholder={
                resolved?.ingredient.unit === "PIECE"
                  ? "Ví dụ: 50"
                  : "Ví dụ: 500"
              }
              value={quantity}
              onChange={(e) => {
                setQuantity(sanitizePositiveInput(e.target.value));
                setIdempotencyKey(crypto.randomUUID());
              }}
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="stock-reason-input"
              className="block text-xs font-bold text-stone-700 dark:text-stone-300"
            >
              {isWastage
                ? "Lý do hao hụt (bắt buộc)"
                : "Lý do / Ghi chú lô nhập (không bắt buộc)"}
            </label>
            <input
              id="stock-reason-input"
              aria-label="Lý do"
              maxLength={500}
              placeholder={
                isWastage
                  ? "Ví dụ: Hết hạn cuối ca, đổ hỏng khi pha chế…"
                  : "Ví dụ: Nhập hàng nhà cung cấp ca sáng (có thể để trống)"
              }
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setIdempotencyKey(crypto.randomUUID());
              }}
              className={inputClass}
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className={secondaryBtnClass}
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={busy}
              className={
                isWastage
                  ? "inline-flex items-center justify-center rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold text-xs sm:text-sm py-2.5 px-5 cursor-pointer"
                  : primaryBtnClass
              }
            >
              {busy
                ? "Đang xử lý…"
                : isWastage
                  ? "Xác nhận ghi nhận hao hụt"
                  : "Xác nhận nhập kho"}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

/**
 * Cửa sổ Lịch sử biến động kho: lọc theo nguyên liệu/topping, loại biến động, khoảng thời gian, có phân trang.
 */
function MovementHistoryModal({
  options,
  onClose,
}: {
  options: SelectOption<string>[];
  onClose: () => void;
}) {
  const filterOptions = useMemo<SelectOption<string>[]>(
    () => [
      { value: "ALL", label: "Tất cả nguyên liệu & topping" },
      ...options,
    ],
    [options],
  );

  const kindOptions: SelectOption<string>[] = [
    { value: "ALL", label: "Tất cả loại biến động" },
    { value: "RECEIPT", label: "Nhập kho" },
    { value: "ADJUSTMENT_NEGATIVE", label: "Ghi nhận hao hụt" },
    { value: "ADJUSTMENT_POSITIVE", label: "Điều chỉnh tăng" },
    { value: "HOLD", label: "Giữ cho đơn" },
    { value: "CONSUME", label: "Tiêu hao pha chế" },
    { value: "RELEASE", label: "Hoàn trả từ đơn" },
  ];

  const [itemFilter, setItemFilter] = useState<string>("ALL");
  const [kindFilter, setKindFilter] = useState<string>("ALL");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const selectedIngredientId = useMemo(() => {
    if (itemFilter === "ALL") return undefined;
    const parts = itemFilter.split(":");
    return parts[0] === "ing" ? Number(parts[1]) : Number(parts[2]);
  }, [itemFilter]);

  useEffect(() => {
    const controller = new AbortController();
    getMovements(
      {
        ingredientId: selectedIngredientId,
        kind:
          kindFilter === "ALL"
            ? undefined
            : (kindFilter as MovementKindFilter),
        from: fromDate || undefined,
        to: toDate || undefined,
        page,
        limit: 12,
      },
      controller.signal,
    )
      .then((res) => {
        if (controller.signal.aborted) return;
        setMovements(res.data);
        setTotalPages(res.meta.totalPages);
        setTotal(res.meta.total);
        setError(null);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorText(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selectedIngredientId, kindFilter, fromDate, toDate, page, reloadTick]);

  function formatDelta(m: InventoryMovement) {
    const u = UNIT_LABEL[m.unit];
    const stockD = Number(m.stockDelta);
    const resD = Number(m.reservedDelta);
    if (m.kind === "HOLD") {
      return `Giữ +${displayQuantity(Math.abs(resD))} ${u}`;
    }
    if (m.kind === "RELEASE") {
      return `Nhả -${displayQuantity(Math.abs(resD))} ${u}`;
    }
    const sign = stockD > 0 ? "+" : "";
    return `${sign}${displayQuantity(stockD)} ${u}`;
  }

  function defaultReason(m: InventoryMovement) {
    if (m.reason) return m.reason;
    if (m.kind === "HOLD") return "Tạm giữ nguyên liệu cho đơn đã thanh toán";
    if (m.kind === "CONSUME") return "Trừ kho khi bắt đầu pha chế";
    if (m.kind === "RELEASE") return "Hoàn trả nguyên liệu khi hủy đơn";
    if (m.kind === "RECEIPT") return "Nhập bổ sung kho";
    if (m.kind === "ADJUSTMENT") {
      return Number(m.stockDelta) > 0
        ? "Điều chỉnh tăng tồn kho"
        : "Ghi nhận hao hụt kho";
    }
    return "—";
  }

  return (
    <Modal onClose={onClose} labelledBy="history-modal-title">
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#181310] p-5 md:p-6 shadow-2xl text-stone-900 dark:text-stone-100">
        <div className="flex items-start justify-between gap-3 border-b border-stone-200 dark:border-stone-800 pb-4">
          <div>
            <h2 id="history-modal-title" className="text-lg md:text-xl font-black">
              Lịch sử biến động kho ({total})
            </h2>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Theo dõi toàn bộ lịch sử nhập kho, ghi nhận hao hụt, giữ/tiêu hao/hoàn trả nguyên liệu và topping
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 text-lg font-bold cursor-pointer"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        {/* Bộ lọc */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 py-4 border-b border-stone-200/80 dark:border-stone-800">
          <div>
            <label className="block text-[11px] font-bold text-stone-600 dark:text-stone-400 mb-1">
              Mặt hàng (Nguyên liệu / Topping)
            </label>
            <CustomSelect
              label="Lọc mặt hàng"
              value={itemFilter}
              options={filterOptions}
              onChange={(next) => {
                setLoading(true);
                setItemFilter(next);
                setPage(1);
              }}
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-stone-600 dark:text-stone-400 mb-1">
              Loại biến động
            </label>
            <CustomSelect
              label="Lọc loại biến động"
              value={kindFilter}
              options={kindOptions}
              onChange={(next) => {
                setLoading(true);
                setKindFilter(next);
                setPage(1);
              }}
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-stone-600 dark:text-stone-400 mb-1">
              Từ ngày
            </label>
            <input
              type="date"
              aria-label="Từ ngày"
              value={fromDate}
              onChange={(e) => {
                setLoading(true);
                setFromDate(e.target.value);
                setPage(1);
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-stone-600 dark:text-stone-400 mb-1">
              Đến ngày
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                aria-label="Đến ngày"
                value={toDate}
                onChange={(e) => {
                  setLoading(true);
                  setToDate(e.target.value);
                  setPage(1);
                }}
                className={inputClass}
              />
              {(itemFilter !== "ALL" ||
                kindFilter !== "ALL" ||
                fromDate ||
                toDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    setItemFilter("ALL");
                    setKindFilter("ALL");
                    setFromDate("");
                    setToDate("");
                    setPage(1);
                  }}
                  className="shrink-0 rounded-xl border border-stone-300 dark:border-stone-700 px-2.5 text-xs font-bold hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                  title="Xóa bộ lọc"
                >
                  Đặt lại
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Bảng lịch sử */}
        <div className="flex-1 overflow-y-auto mt-3 rounded-xl border border-stone-200 dark:border-stone-800">
          {loading ? (
            <div className="py-12 text-center text-sm text-stone-500">
              Đang tải lịch sử biến động…
            </div>
          ) : error ? (
            <div
              role="alert"
              className="py-10 px-4 text-center space-y-3 bg-rose-50/50 dark:bg-rose-950/30"
            >
              <p className="text-sm font-semibold text-rose-700 dark:text-rose-200">
                Không thể tải lịch sử biến động: {error}
              </p>
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  setError(null);
                  setReloadTick((t) => t + 1);
                }}
                className={secondaryBtnClass}
              >
                Thử tải lại
              </button>
            </div>
          ) : movements.length === 0 ? (
            <div className="py-12 text-center text-sm text-stone-500">
              Không có biến động kho nào khớp với bộ lọc hiện tại.
            </div>
          ) : (
            <table className="w-full border-collapse text-xs sm:text-sm">
              <thead className="sticky top-0 bg-stone-100 dark:bg-stone-900 text-stone-600 dark:text-stone-300 border-b border-stone-200 dark:border-stone-800">
                <tr>
                  <th className="px-3.5 py-2.5 text-left font-bold">Thời gian</th>
                  <th className="px-3.5 py-2.5 text-left font-bold">Mặt hàng</th>
                  <th className="px-3.5 py-2.5 text-left font-bold">Loại</th>
                  <th className="px-3.5 py-2.5 text-right font-bold">Lượng thay đổi</th>
                  <th className="px-3.5 py-2.5 text-left font-bold">Lý do</th>
                  <th className="px-3.5 py-2.5 text-left font-bold">Người thực hiện</th>
                  <th className="px-3.5 py-2.5 text-center font-bold">Mã đơn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200/70 dark:divide-stone-800">
                {movements.map((m) => {
                  const toppingNames = m.ingredient?.toppings
                    ?.map((t) => t.name)
                    .join(", ");
                  return (
                    <tr key={m.id} className="hover:bg-stone-50/70 dark:hover:bg-stone-800/40">
                      <td className="px-3.5 py-2.5 whitespace-nowrap text-xs text-stone-600 dark:text-stone-400">
                        {new Date(m.createdAt).toLocaleString("vi-VN")}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="font-semibold">
                          {m.ingredient?.name ?? `#${m.ingredientId}`}
                        </div>
                        {toppingNames && (
                          <div className="text-[11px] text-amber-700 dark:text-amber-400">
                            Topping: {toppingNames}
                          </div>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${getMovementBadgeClass(m)}`}
                        >
                          {getMovementTypeLabel(m)}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 text-right font-mono font-bold tabular-nums whitespace-nowrap">
                        {formatDelta(m)}
                      </td>
                      <td className="px-3.5 py-2.5 text-stone-700 dark:text-stone-300">
                        {defaultReason(m)}
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap text-xs">
                        {m.actor?.fullName ?? (m.orderId ? "Hệ thống (Đơn hàng)" : "Barista")}
                      </td>
                      <td className="px-3.5 py-2.5 text-center font-mono text-xs whitespace-nowrap">
                        {m.orderId ? (
                          <span className="rounded-md bg-stone-200/80 dark:bg-stone-800 px-2 py-0.5 font-bold">
                            #{m.orderId}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <Pagination
          page={page}
          totalPages={totalPages}
          disabled={loading}
          onChange={(nextPage) => {
            setLoading(true);
            setPage(nextPage);
          }}
        />
      </div>
    </Modal>
  );
}

/**
 * Cửa sổ Thêm nguyên liệu mới: chỉ nhập tên và đơn vị tính; hệ thống tự sinh mã duy nhất, tồn ban đầu = 0.
 */
function AddIngredientModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (created: { id: number; name: string; unit: IngredientUnit }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<IngredientUnit>("GRAM");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitOptions: SelectOption<IngredientUnit>[] = [
    { value: "GRAM", label: UNIT_NAME.GRAM, sublabel: "Bột, hạt, đường, đá, trân châu…" },
    { value: "MILLILITRE", label: UNIT_NAME.MILLILITRE, sublabel: "Sữa, nước, siro…" },
    { value: "PIECE", label: UNIT_NAME.PIECE, sublabel: "Miếng đào, quả vải, bánh…" },
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Vui lòng nhập tên nguyên liệu.");
      return;
    }
    setBusy(true);
    try {
      const created = await createIngredient({ name: name.trim(), unit });
      await onSuccess(created);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="add-ingredient-title">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#181310] p-6 shadow-2xl space-y-4 text-stone-900 dark:text-stone-100">
        <div className="flex items-start justify-between gap-3 border-b border-stone-200 dark:border-stone-800 pb-3">
          <div>
            <h2 id="add-ingredient-title" className="text-lg font-black">
              + Thêm nguyên liệu pha chế
            </h2>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Hệ thống tự động sinh mã duy nhất. Tồn khởi tạo bằng 0, bổ sung qua Nhập kho.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 text-lg font-bold cursor-pointer"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 px-3.5 py-2 text-xs text-rose-700 dark:text-rose-200"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="new-ing-name"
              className="block text-xs font-bold text-stone-700 dark:text-stone-300"
            >
              Tên nguyên liệu
            </label>
            <input
              id="new-ing-name"
              aria-label="Tên"
              maxLength={200}
              placeholder="Ví dụ: Siro đào, Kem béo thực vật…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="new-ing-unit"
              className="block text-xs font-bold text-stone-700 dark:text-stone-300"
            >
              Đơn vị tính gốc
            </label>
            <CustomSelect
              id="new-ing-unit"
              label="Đơn vị"
              value={unit}
              options={unitOptions}
              onChange={setUnit}
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button type="button" onClick={onClose} className={secondaryBtnClass}>
              Hủy
            </button>
            <button type="submit" disabled={busy} className={primaryBtnClass}>
              {busy ? "Đang tạo…" : "Tạo nguyên liệu"}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

/**
 * Cửa sổ Thêm / Cấu hình Topping:
 * Cho nhập tên, giá bán mỗi phần, chọn nguyên liệu kho có sẵn hoặc tạo mới, và nhập định lượng mỗi phần.
 */
function AddToppingModal({
  stockRows,
  editTopping,
  onClose,
  onSuccess,
}: {
  stockRows: StockRow[];
  editTopping?: PreparedTopping;
  onClose: () => void;
  onSuccess: (msg: string) => Promise<void>;
}) {
  const activeStock = useMemo(
    () => stockRows.filter((r) => r.isActive),
    [stockRows],
  );
  const [name, setName] = useState(editTopping?.name ?? "");
  const [price, setPrice] = useState(
    editTopping ? String(editTopping.price) : "10000",
  );
  const [sourceMode, setSourceMode] = useState<"existing" | "new">(
    activeStock.length > 0 ? "existing" : "new",
  );
  const [selectedIngId, setSelectedIngId] = useState<string>(
    editTopping?.ingredientId
      ? String(editTopping.ingredientId)
      : String(activeStock[0]?.id ?? ""),
  );
  const [newIngName, setNewIngName] = useState("");
  const [newIngUnit, setNewIngUnit] = useState<IngredientUnit>("GRAM");
  const [quantityPerServing, setQuantityPerServing] = useState(
    editTopping?.quantityPerServing
      ? String(Number(editTopping.quantityPerServing))
      : "50",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ingredientOptions = useMemo<SelectOption<string>[]>(
    () =>
      activeStock.map((r) => ({
        value: String(r.id),
        label: r.name,
        sublabel: `Đơn vị: ${UNIT_LABEL[r.unit]}`,
        badge: `Khả dụng: ${displayQuantity(r.availableQuantity)} ${UNIT_LABEL[r.unit]}`,
      })),
    [activeStock],
  );

  const selectedIng = useMemo(
    () => activeStock.find((r) => String(r.id) === selectedIngId),
    [activeStock, selectedIngId],
  );

  const activeUnit: IngredientUnit =
    sourceMode === "existing" ? (selectedIng?.unit ?? "GRAM") : newIngUnit;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!editTopping && !name.trim()) {
      setError("Vui lòng nhập tên topping.");
      return;
    }
    const parsedPrice = Number(price);
    if (!editTopping && (!Number.isInteger(parsedPrice) || parsedPrice < 0)) {
      setError("Giá bán mỗi phần phải là số nguyên không âm (VNĐ).");
      return;
    }
    const cleanServing = sanitizePositiveInput(quantityPerServing).trim();
    if (!validQuantity(cleanServing, activeUnit, false)) {
      setError(
        activeUnit === "PIECE"
          ? "Định lượng mỗi phần phải là số nguyên dương."
          : "Định lượng mỗi phần phải là số dương hợp lệ (tối đa 3 chữ số thập phân).",
      );
      return;
    }

    setBusy(true);
    try {
      let ingredientId = Number(selectedIngId);
      if (sourceMode === "new") {
        const ingName = (newIngName.trim() || `${name.trim()} đã chuẩn bị`).trim();
        const createdIng = await createIngredient({
          name: ingName,
          unit: newIngUnit,
        });
        ingredientId = createdIng.id;
      } else if (!ingredientId) {
        setError("Vui lòng chọn nguyên liệu kho liên kết.");
        setBusy(false);
        return;
      }

      const toppingId = editTopping
        ? editTopping.id
        : (await createTopping({ name: name.trim(), price: parsedPrice })).id;

      await saveToppingRecipe(toppingId, {
        ingredientId,
        quantityPerServing: cleanServing,
      });

      await onSuccess(
        editTopping
          ? `Đã cập nhật định lượng cho topping "${editTopping.name}".`
          : `Đã thêm topping "${name.trim()}" (${displayQuantity(cleanServing)} ${UNIT_LABEL[activeUnit]}/phần).`,
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="add-topping-title">
      <div className="w-full max-w-lg rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#181310] p-6 shadow-2xl space-y-4 text-stone-900 dark:text-stone-100">
        <div className="flex items-start justify-between gap-3 border-b border-stone-200 dark:border-stone-800 pb-3">
          <div>
            <h2 id="add-topping-title" className="text-lg font-black">
              {editTopping
                ? `Cấu hình định lượng: ${editTopping.name}`
                : "+ Thêm topping đã chuẩn bị"}
            </h2>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Topping dùng trực tiếp lượng tồn của nguyên liệu kho liên kết, không tạo tồn độc lập.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 text-lg font-bold cursor-pointer"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 px-3.5 py-2 text-xs text-rose-700 dark:text-rose-200"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!editTopping && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-stone-700 dark:text-stone-300">
                  Tên topping
                </label>
                <input
                  aria-label="Tên topping"
                  placeholder="Ví dụ: Pudding trứng"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-stone-700 dark:text-stone-300">
                  Giá bán mỗi phần (VNĐ)
                </label>
                <input
                  aria-label="Giá bán mỗi phần"
                  inputMode="numeric"
                  placeholder="10000"
                  value={price}
                  onChange={(e) => setPrice(sanitizePositiveInput(e.target.value))}
                  className={inputClass}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-bold text-stone-700 dark:text-stone-300">
              Nguyên liệu kho tương ứng
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSourceMode("existing")}
                className={`rounded-xl py-2 px-3 text-xs font-bold border transition-all cursor-pointer ${
                  sourceMode === "existing"
                    ? "bg-amber-600 text-white border-amber-600"
                    : "border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-300"
                }`}
              >
                Chọn nguyên liệu có sẵn
              </button>
              <button
                type="button"
                onClick={() => setSourceMode("new")}
                className={`rounded-xl py-2 px-3 text-xs font-bold border transition-all cursor-pointer ${
                  sourceMode === "new"
                    ? "bg-amber-600 text-white border-amber-600"
                    : "border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-300"
                }`}
              >
                + Tạo nguyên liệu kho mới
              </button>
            </div>

            {sourceMode === "existing" ? (
              <CustomSelect
                label="Nguyên liệu kho"
                value={selectedIngId}
                options={ingredientOptions}
                onChange={setSelectedIngId}
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-[11px] font-semibold text-stone-500 mb-1">
                    Tên nguyên liệu kho mới
                  </label>
                  <input
                    aria-label="Tên nguyên liệu kho mới"
                    placeholder={
                      name.trim()
                        ? `${name.trim()} đã chuẩn bị`
                        : "Ví dụ: Pudding đã chuẩn bị"
                    }
                    value={newIngName}
                    onChange={(e) => setNewIngName(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-500 mb-1">
                    Đơn vị tính
                  </label>
                  <CustomSelect
                    label="Đơn vị nguyên liệu mới"
                    value={newIngUnit}
                    options={[
                      { value: "GRAM", label: UNIT_NAME.GRAM },
                      { value: "MILLILITRE", label: UNIT_NAME.MILLILITRE },
                      { value: "PIECE", label: UNIT_NAME.PIECE },
                    ]}
                    onChange={setNewIngUnit}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-stone-700 dark:text-stone-300">
              Định lượng mỗi phần ({UNIT_LABEL[activeUnit]}/phần)
            </label>
            <input
              aria-label="Định lượng mỗi phần"
              inputMode="decimal"
              placeholder={`Ví dụ: 50 (${UNIT_LABEL[activeUnit]}/phần)`}
              value={quantityPerServing}
              onChange={(e) =>
                setQuantityPerServing(sanitizePositiveInput(e.target.value))
              }
              className={inputClass}
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button type="button" onClick={onClose} className={secondaryBtnClass}>
              Hủy
            </button>
            <button type="submit" disabled={busy} className={primaryBtnClass}>
              {busy ? "Đang lưu…" : "Lưu topping"}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

/**
 * Cửa sổ Công thức sản phẩm theo từng size S / M / L:
 * Xem từng nguyên liệu, định lượng và đơn vị cho 1 ly; thêm, sửa, bỏ nguyên liệu và lưu công thức.
 * Thể hiện rõ công thức chưa cấu hình hoặc nguyên liệu đang thiếu; tính số ly thực tế từ lượng khả dụng.
 */
function ProductRecipeModal({
  product,
  stockRows,
  stockById,
  onClose,
  onSaved,
}: {
  product: Product;
  stockRows: StockRow[];
  stockById: Map<number, StockRow>;
  onClose: () => void;
  onSaved: (msg: string) => Promise<void>;
}) {
  const [selectedSize, setSelectedSize] = useState<Size>("S");
  const [lines, setLines] = useState<
    Array<{ ingredientId: number; quantity: string }>
  >([]);
  const [loadingRecipe, setLoadingRecipe] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);

  const activeIngredients = useMemo(
    () => stockRows.filter((r) => r.isActive),
    [stockRows],
  );

  useEffect(() => {
    const controller = new AbortController();
    getProductRecipe(product.id, selectedSize, controller.signal)
      .then((recipe) => {
        if (controller.signal.aborted) return;
        setLines(
          recipe.ingredients.map((item) => ({
            ingredientId: item.ingredientId,
            quantity: String(Number(item.quantity)),
          })),
        );
        setLoadError(null);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setLoadError(errorText(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingRecipe(false);
      });
    return () => controller.abort();
  }, [product.id, selectedSize, reloadTick]);

  const calculation = useMemo(
    () => calculateRecipeCups(lines, stockById, lines.length > 0),
    [lines, stockById],
  );

  function addIngredientRow() {
    const used = new Set(lines.map((l) => l.ingredientId));
    const candidate = activeIngredients.find((r) => !used.has(r.id));
    if (!candidate) {
      setError("Tất cả nguyên liệu đang hoạt động đã có trong công thức này.");
      return;
    }
    setError(null);
    setLines((prev) => [
      ...prev,
      {
        ingredientId: candidate.id,
        quantity: candidate.unit === "PIECE" ? "1" : "20",
      },
    ]);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSavedBanner(null);

    const seen = new Set<number>();
    for (const line of lines) {
      if (seen.has(line.ingredientId)) {
        setError("Một nguyên liệu không được lặp lại hai lần trong cùng một size.");
        return;
      }
      seen.add(line.ingredientId);
      const st = stockById.get(line.ingredientId);
      if (!st) {
        setError("Nguyên liệu không tồn tại.");
        return;
      }
      const cleanQty = sanitizePositiveInput(line.quantity).trim();
      if (!validQuantity(cleanQty, st.unit, false)) {
        setError(
          `Định lượng của "${st.name}" không hợp lệ (${
            st.unit === "PIECE"
              ? "phải là số nguyên dương"
              : "phải là số dương, tối đa 3 chữ số thập phân"
          }).`,
        );
        return;
      }
    }

    setSaving(true);
    try {
      await saveProductRecipe(product.id, selectedSize, {
        ingredients: lines.map((l) => ({
          ingredientId: l.ingredientId,
          quantity: sanitizePositiveInput(l.quantity).trim(),
        })),
        isActive: lines.length > 0,
      });
      const msg =
        lines.length > 0
          ? `Đã lưu công thức ${product.name} (Size ${selectedSize}).`
          : `Đã xóa công thức ${product.name} (Size ${selectedSize}).`;
      setSavedBanner(msg);
      await onSaved(msg);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="recipe-modal-title">
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#181310] p-5 md:p-6 shadow-2xl text-stone-900 dark:text-stone-100">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-stone-200 dark:border-stone-800 pb-4">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              Công thức định lượng 1 ly · {product.category}
            </span>
            <h2 id="recipe-modal-title" className="text-xl font-black mt-0.5">
              {product.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 text-lg font-bold cursor-pointer"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        {/* Chọn Size S / M / L */}
        <div className="grid grid-cols-3 gap-2.5 py-4 border-b border-stone-200/80 dark:border-stone-800">
          {SIZES.map((sz) => {
            const active = sz === selectedSize;
            const entry = product.availability?.find((a) => a.size === sz);
            const cups =
              active && !loadingRecipe
                ? calculation.maxCups
                : (entry?.maxQuantity ?? 0);
            const unconfigured =
              active && !loadingRecipe
                ? !calculation.configured
                : entry?.reason === "RECIPE_UNAVAILABLE";
            const isPausedIngredient =
              active && !loadingRecipe
                ? calculation.hasPausedIngredient
                : entry?.reason === "INGREDIENT_PAUSED";

            return (
              <button
                key={sz}
                type="button"
                onClick={() => {
                  if (sz !== selectedSize) {
                    setLoadingRecipe(true);
                    setLoadError(null);
                    setError(null);
                    setSavedBanner(null);
                    setSelectedSize(sz);
                  }
                }}
                className={`rounded-xl p-2.5 text-center border transition-all cursor-pointer ${
                  active
                    ? "bg-amber-700 text-white border-amber-700 shadow-sm"
                    : "bg-stone-100/70 dark:bg-stone-900 border-stone-200 dark:border-stone-800 hover:border-amber-500/60"
                }`}
              >
                <div className="text-xs font-extrabold">Size {sz}</div>
                <div
                  className={`text-[11px] font-mono mt-0.5 ${
                    active
                      ? "text-amber-100"
                      : "text-stone-500 dark:text-stone-400"
                  }`}
                >
                  {unconfigured
                    ? "Chưa cấu hình"
                    : isPausedIngredient
                      ? "Tạm dừng NL"
                      : `${displayQuantity(cups)} ly khả dụng`}
                </div>
              </button>
            );
          })}
        </div>

        {/* Trạng thái công thức & cảnh báo thiếu nguyên liệu */}
        {!loadingRecipe && !loadError && (
          <div className="mt-3">
            {!calculation.configured ? (
              <div className="rounded-xl border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 px-4 py-2.5 text-xs sm:text-sm text-amber-800 dark:text-amber-200">
                <strong>Chưa cấu hình công thức cho Size {selectedSize}:</strong>{" "}
                Size này chưa có nguyên liệu nên chưa thể bán. Hãy bấm &ldquo;+ Thêm nguyên liệu vào công thức&rdquo; và lưu lại.
              </div>
            ) : calculation.hasPausedIngredient ? (
              <div className="rounded-xl border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/50 px-4 py-2.5 text-xs sm:text-sm text-amber-800 dark:text-amber-200 space-y-1">
                <div>
                  <strong>
                    Size {selectedSize} có nguyên liệu đang tạm dừng phục vụ:
                  </strong>
                </div>
                <ul className="list-disc list-inside text-xs">
                  {calculation.missing
                    .filter((m) => m.isPaused)
                    .map((m) => (
                      <li key={m.ingredientId}>
                        Nguyên liệu &ldquo;{m.name}&rdquo; đang ở trạng thái Tạm dừng. Hãy kích hoạt lại nguyên liệu này ở Bảng nguyên liệu để mở bán lại Size {selectedSize}.
                      </li>
                    ))}
                </ul>
              </div>
            ) : calculation.missing.length > 0 ? (
              <div className="rounded-xl border border-rose-300 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/50 px-4 py-2.5 text-xs sm:text-sm text-rose-800 dark:text-rose-200 space-y-1">
                <div>
                  <strong>
                    Đang thiếu nguyên liệu cho Size {selectedSize} (0 ly khả dụng):
                  </strong>
                </div>
                <ul className="list-disc list-inside text-xs">
                  {calculation.missing.map((m) => (
                    <li key={m.ingredientId}>
                      {m.name}: cần {displayQuantity(m.required)}{" "}
                      {UNIT_LABEL[m.unit]}/ly nhưng kho chỉ còn khả dụng{" "}
                      {displayQuantity(m.available)} {UNIT_LABEL[m.unit]}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-300 dark:border-emerald-800/80 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-2.5 text-xs sm:text-sm text-emerald-800 dark:text-emerald-200">
                <strong>Size {selectedSize} sẵn sàng phục vụ:</strong> Lượng nguyên liệu khả dụng hiện tại pha được tối đa{" "}
                <strong className="font-mono">
                  {displayQuantity(calculation.maxCups)} ly
                </strong>
                .
              </div>
            )}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 px-3.5 py-2 text-xs text-rose-700 dark:text-rose-200"
          >
            {error}
          </div>
        )}
        {savedBanner && (
          <div
            role="status"
            className="mt-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 px-3.5 py-2 text-xs text-emerald-700 dark:text-emerald-200"
          >
            {savedBanner}
          </div>
        )}

        {/* Danh sách nguyên liệu trong công thức 1 ly */}
        <form onSubmit={handleSave} className="flex-1 flex flex-col min-h-0 mt-3">
          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
            {loadingRecipe ? (
              <div className="py-10 text-center text-sm text-stone-500">
                Đang tải công thức Size {selectedSize}…
              </div>
            ) : loadError ? (
              <div
                role="alert"
                className="rounded-xl border border-rose-300 dark:border-rose-800/80 bg-rose-50/70 dark:bg-rose-950/40 p-6 text-center space-y-3"
              >
                <p className="text-sm font-semibold text-rose-700 dark:text-rose-200">
                  Không thể tải công thức Size {selectedSize}: {loadError}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setLoadingRecipe(true);
                    setLoadError(null);
                    setReloadTick((t) => t + 1);
                  }}
                  className={secondaryBtnClass}
                >
                  Thử tải lại
                </button>
              </div>
            ) : lines.length === 0 ? (
              <div className="py-8 text-center text-xs sm:text-sm text-stone-500 border border-dashed border-stone-300 dark:border-stone-700 rounded-xl">
                Chưa có nguyên liệu nào cho Size {selectedSize}.
              </div>
            ) : (
              lines.map((line, idx) => {
                const st = stockById.get(line.ingredientId);
                const unit = st ? UNIT_LABEL[st.unit] : "";
                const avail = st ? Number(st.availableQuantity) : 0;
                const req = Number(line.quantity);
                const cupsForThis =
                  req > 0 && Number.isFinite(req)
                    ? Math.max(0, Math.floor((avail + 1e-9) / req))
                    : 0;
                const isShort = !st || !st.isActive || cupsForThis < 1;

                const rowOptions: SelectOption<string>[] = stockRows
                  .filter((r) => r.isActive || r.id === line.ingredientId)
                  .map((r) => ({
                    value: String(r.id),
                    label: r.name,
                    sublabel: `Đơn vị: ${UNIT_LABEL[r.unit]}`,
                    badge: `Khả dụng: ${displayQuantity(r.availableQuantity)} ${UNIT_LABEL[r.unit]}`,
                  }));

                return (
                  <div
                    key={`${line.ingredientId}-${idx}`}
                    className={`rounded-xl border p-3 space-y-2 ${
                      isShort
                        ? "border-rose-300 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-950/20"
                        : "border-stone-200 dark:border-stone-800 bg-stone-50/60 dark:bg-stone-900/50"
                    }`}
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
                      <div className="sm:col-span-6">
                        <CustomSelect
                          label={`Nguyên liệu dòng ${idx + 1}`}
                          value={String(line.ingredientId)}
                          options={rowOptions}
                          onChange={(nextId) => {
                            const nextNum = Number(nextId);
                            const nextStock = stockById.get(nextNum);
                            setLines((prev) =>
                              prev.map((item, i) =>
                                i === idx
                                  ? {
                                      ingredientId: nextNum,
                                      quantity:
                                        nextStock?.unit === "PIECE"
                                          ? String(
                                              Math.max(
                                                1,
                                                Math.round(Number(item.quantity) || 1),
                                              ),
                                            )
                                          : item.quantity,
                                    }
                                  : item,
                              ),
                            );
                          }}
                        />
                      </div>

                      <div className="sm:col-span-4 flex items-center gap-1.5">
                        <input
                          aria-label={`Định lượng ${st?.name ?? ""}`}
                          inputMode="decimal"
                          value={line.quantity}
                          onChange={(e) => {
                            const v = sanitizePositiveInput(e.target.value);
                            setLines((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, quantity: v } : item,
                              ),
                            );
                          }}
                          className={`${inputClass} font-mono text-right`}
                        />
                        <span className="text-xs font-bold text-stone-500 dark:text-stone-400 shrink-0">
                          {unit}/ly
                        </span>
                      </div>

                      <div className="sm:col-span-2 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setLines((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-100 dark:hover:bg-rose-950/50 cursor-pointer"
                        >
                          Bỏ
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] px-1">
                      <span className="text-stone-500 dark:text-stone-400">
                        Kho khả dụng:{" "}
                        <strong className="font-mono">
                          {st ? displayQuantity(st.availableQuantity) : 0} {unit}
                        </strong>
                      </span>
                      <span
                        className={
                          isShort
                            ? "font-bold text-rose-600 dark:text-rose-400"
                            : "font-semibold text-emerald-700 dark:text-emerald-400"
                        }
                      >
                        {isShort
                          ? "Không đủ cho 1 ly"
                          : `Đủ pha ~${displayQuantity(cupsForThis)} ly`}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-4 mt-4 border-t border-stone-200 dark:border-stone-800">
            <button
              type="button"
              onClick={addIngredientRow}
              className={secondaryBtnClass}
            >
              + Thêm nguyên liệu vào công thức
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className={secondaryBtnClass}
              >
                Đóng
              </button>
              <button type="submit" disabled={saving} className={primaryBtnClass}>
                {saving
                  ? "Đang lưu…"
                  : `Lưu công thức Size ${selectedSize}`}
              </button>
            </div>
          </div>
        </form>
      </div>
    </Modal>
  );
}
