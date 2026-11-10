"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/modal";
import { createProduct } from "@/lib/api/inventory";
import type { Product, Topping } from "@/types";

const inputClass =
  "w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3.5 py-2.5 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500/80 light:bg-cafe-surface light:border-cafe-line light:text-cafe-ink";
const labelClass =
  "block text-xs font-bold text-stone-600 dark:text-stone-300 mb-1.5";

export function AddProductModal({
  toppings,
  categories,
  onClose,
  onCreated,
}: {
  toppings: Topping[];
  categories: string[];
  onClose: () => void;
  onCreated: (product: Product) => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [category, setCategory] = useState("");
  const [toppingIds, setToppingIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const close = () => {
    if (!inFlight.current) onClose();
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    setError(null);
    if (!name.trim() || !category.trim()) {
      setError("Vui lòng nhập tên món và danh mục.");
      return;
    }
    const amount = Number(price);
    if (
      !price.trim() ||
      !Number.isInteger(amount) ||
      amount < 0 ||
      amount > 2147483647
    ) {
      setError("Giá phải là số nguyên từ 0 đến 2.147.483.647 đồng.");
      return;
    }
    if (!/^(https?:\/\/\S+|\/(?!\/)\S+)$/.test(imageUrl.trim())) {
      setError("Nhập URL ảnh http(s) hoặc đường dẫn bắt đầu bằng /.");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    try {
      const product = await createProduct({
        name,
        price: amount,
        imageUrl,
        category,
        toppingIds,
      });
      onCreated(product);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Không thể tạo món. Vui lòng thử lại.",
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <Modal onClose={close} labelledBy={`${id}-title`}>
      <section className="w-full max-w-2xl max-h-[90dvh] overflow-y-auto rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#181310] p-5 md:p-6 shadow-2xl text-stone-900 dark:text-stone-100">
        <header className="flex items-start justify-between gap-3 border-b border-stone-200 dark:border-stone-800 pb-4">
          <div>
            <p className="text-xs font-bold text-amber-700 dark:text-amber-400">
              Bước 1 / 2 · Tạo món → Gán công thức
            </p>
            <h2 id={`${id}-title`} className="mt-1 text-xl font-black">
              Thêm món mới
            </h2>
            <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
              Tạo thông tin món trước, sau đó chọn nguyên liệu cho các size muốn
              bán.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            aria-label="Đóng thêm món"
            className="text-lg p-1 disabled:opacity-50"
          >
            ✕
          </button>
        </header>
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800"
          >
            {error}
          </p>
        )}
        <form onSubmit={submit} className="mt-4 space-y-4">
          <fieldset disabled={saving} className="space-y-4">
            <div>
              <label htmlFor={`${id}-name`} className={labelClass}>
                Tên món *
              </label>
              <input
                id={`${id}-name`}
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Ví dụ: Cà phê dừa"
                className={inputClass}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={`${id}-price`} className={labelClass}>
                  Giá gốc size S (đồng) *
                </label>
                <input
                  id={`${id}-price`}
                  name="price"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={2147483647}
                  step={1}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  required
                  placeholder="35000"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor={`${id}-category`} className={labelClass}>
                  Danh mục *
                </label>
                <input
                  id={`${id}-category`}
                  name="category"
                  list={`${id}-categories`}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  required
                  placeholder="Chọn hoặc nhập danh mục"
                  className={inputClass}
                />
                <datalist id={`${id}-categories`}>
                  {[...new Set(categories)].map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </div>
            </div>
            <div>
              <label htmlFor={`${id}-image`} className={labelClass}>
                URL ảnh *
              </label>
              <input
                id={`${id}-image`}
                name="imageUrl"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                required
                placeholder="https://… hoặc /img/mon-moi.jpg"
                className={inputClass}
              />
            </div>
            <fieldset>
              <legend className={labelClass}>
                Topping được phép (không bắt buộc)
              </legend>
              <div className="max-h-44 overflow-y-auto rounded-xl border border-stone-200 dark:border-stone-700 p-3 space-y-2">
                {toppings
                  .filter((topping) => topping.isActive !== false)
                  .map((topping) => (
                    <label
                      key={topping.id}
                      className="flex cursor-pointer items-center justify-between gap-3 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="toppingIds"
                          value={topping.id}
                          checked={toppingIds.includes(topping.id)}
                          onChange={(e) =>
                            setToppingIds((previous) =>
                              e.target.checked
                                ? [...previous, topping.id]
                                : previous.filter(
                                    (value) => value !== topping.id,
                                  ),
                            )
                          }
                          className="accent-amber-700"
                        />
                        {topping.name}
                      </span>
                      <span className="text-xs text-stone-500 dark:text-stone-400">
                        {topping.price.toLocaleString("vi-VN")}đ
                      </span>
                    </label>
                  ))}
                {!toppings.some((topping) => topping.isActive !== false) && (
                  <p className="text-xs text-stone-500">
                    Chưa có topping. Bạn vẫn có thể tạo món không topping.
                  </p>
                )}
              </div>
            </fieldset>
          </fieldset>
          <p className="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-800 dark:text-amber-200">
            Số ly khả dụng sẽ được tính từ nguyên liệu và công thức, không nhập
            tồn theo món. Món đã tạo có thể mở lại để cấu hình tiếp.
          </p>
          <footer className="flex flex-wrap justify-end gap-2 border-t border-stone-200 dark:border-stone-800 pt-4">
            <button
              type="button"
              onClick={close}
              disabled={saving}
              className="rounded-xl border border-stone-300 dark:border-stone-700 px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-amber-700 hover:bg-amber-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {saving ? "Đang tạo món…" : "Tạo món và gán công thức →"}
            </button>
          </footer>
        </form>
      </section>
    </Modal>
  );
}
