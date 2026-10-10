"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Product, Size, Topping } from "@/types";
import { useCartStore } from "@/store/cart-store";
import { useAuthStore } from "@/store/auth-store";
import { unitPrice as calculateUnitPrice } from "@/lib/cart-rules";
import { getProductImageUrl } from "@/lib/constants/product-images";

interface ProductModalProps {
  product: Product | null;
  toppings: Topping[];
  isOpen: boolean;
  onClose: () => void;
}

export function ProductModal(props: ProductModalProps) {
  if (!props.isOpen || !props.product) return null;
  return (
    <ProductSelection
      key={props.product.id}
      {...props}
      product={props.product}
    />
  );
}

function ProductSelection({
  product,
  toppings,
  onClose,
}: Omit<ProductModalProps, "product"> & { product: Product }) {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  const [selectedSize, setSelectedSize] = useState<Size>("M");
  const [selectedToppings, setSelectedToppings] = useState<Topping[]>([]);
  const [quantity, setQuantity] = useState<number>(1);
  const [note, setNote] = useState<string>("");
  const [isAdded, setIsAdded] = useState<boolean>(false);

  const { addItem, items, cartError, isHydrated } = useCartStore();
  const available = Math.max(
    0,
    product.stock -
      items
        .filter((item) => item.product.id === product.id)
        .reduce((sum, item) => sum + item.quantity, 0),
  );
  const adding = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const [modalImgError, setModalImgError] = useState<boolean>(false);

  const handleToggleTopping = (topping: Topping) => {
    const isSelected = selectedToppings.some((t) => t.id === topping.id);
    if (isSelected) {
      setSelectedToppings(selectedToppings.filter((t) => t.id !== topping.id));
    } else {
      if (selectedToppings.length >= 3) {
        alert("Tối đa 3 loại topping cho mỗi ly đồ uống");
        return;
      }
      setSelectedToppings([...selectedToppings, topping]);
    }
  };

  const unitPrice = calculateUnitPrice(product, selectedSize, selectedToppings);
  const totalPrice = unitPrice * quantity;

  const handleAddToCart = () => {
    if (!user) {
      router.push(
        `/login?redirect=${encodeURIComponent(`/menu?openProduct=${product.id}`)}`,
      );
      return;
    }
    if (adding.current) return;
    const added = addItem({
      product,
      size: selectedSize,
      selectedToppings,
      quantity,
      note: note.trim() || undefined,
    });

    if (!added) return;
    adding.current = true;
    setIsAdded(true);
    timer.current = setTimeout(() => {
      setIsAdded(false);
      onClose();
    }, 400);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
      {/* Click outside to close */}
      <div className="fixed inset-0" onClick={onClose} />

      <div className="relative z-10 w-full max-w-lg bg-[#fdfbf9] dark:bg-[#161210] rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border border-[#ede5dc] dark:border-[#2a221c] transition-colors">
        {/* Header với ảnh hoặc icon */}
        <div className="relative h-44 sm:h-52 bg-gradient-to-br from-amber-100 via-stone-100 to-amber-50 dark:from-[#221a15] dark:via-[#1a1411] dark:to-[#120f0d] flex items-center justify-center border-b border-[#ede5dc] dark:border-[#2a221c]">
          {!modalImgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={getProductImageUrl(
                product.name,
                product.category,
                product.imageUrl,
              )}
              alt={product.name}
              className="w-full h-full object-cover"
              onError={() => setModalImgError(true)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center text-amber-900/60 dark:text-amber-400/60">
              <span className="text-6xl drop-shadow">☕</span>
              <span className="text-xs font-semibold text-amber-900/60 dark:text-amber-400/60 mt-1 uppercase tracking-wider">
                BrewLite Coffee
              </span>
            </div>
          )}

          {/* Nút đóng */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors cursor-pointer shadow-sm"
          >
            ✕
          </button>

          <span className="absolute bottom-3 left-3 bg-[#1e1510]/85 dark:bg-[#0c0a09]/90 backdrop-blur-md text-amber-300 text-xs font-semibold px-2.5 py-1 rounded-lg border border-amber-500/20 shadow-sm">
            {product.category}
          </span>
        </div>

        {cartError && (
          <p role="alert" className="p-3 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 text-sm">
            {cartError}
          </p>
        )}
        {available < quantity && (
          <p className="p-3 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 text-sm">
            Không đủ tồn kho để thêm số lượng này. Trong giỏ đã có{" "}
            {product.stock - available} ly.
          </p>
        )}
        {/* Nội dung tùy chỉnh */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          <div>
            <h2 className="text-xl font-bold text-stone-900 dark:text-stone-100">{product.name}</h2>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
              {product.description ||
                "Thức uống tươi ngon được pha chế theo công thức chuẩn vị."}
            </p>
          </div>

          {/* 1. Chọn Size */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-[#a39589] block mb-2">
              1. Chọn kích cỡ (Size) <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {(
                [
                  { size: "S", label: "Size S (Nhỏ)", upcharge: 0 },
                  { size: "M", label: "Size M (Vừa)", upcharge: 5000 },
                  { size: "L", label: "Size L (Lớn)", upcharge: 10000 },
                ] as const
              ).map((item) => {
                const isCurrent = selectedSize === item.size;
                return (
                  <button
                    key={item.size}
                    type="button"
                    onClick={() => setSelectedSize(item.size)}
                    className={`py-2.5 px-3 rounded-2xl border text-center transition-all cursor-pointer ${
                      isCurrent
                        ? "border-amber-600 bg-amber-500/10 dark:bg-amber-500/15 text-amber-900 dark:text-amber-200 font-bold ring-2 ring-amber-500/30 shadow-sm"
                        : "border-[#ede5dc] dark:border-[#2a221c] hover:border-amber-400 dark:hover:border-amber-700/60 text-stone-700 dark:text-[#d5cbc3] bg-white dark:bg-[#1a1411]"
                    }`}
                  >
                    <div className="text-sm font-bold">{item.size}</div>
                    <div className="text-[11px] text-stone-500 dark:text-[#9e8f83] mt-0.5">
                      {item.upcharge > 0
                        ? `+${item.upcharge.toLocaleString("vi-VN")}₫`
                        : "Tiêu chuẩn"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Chọn Topping */}
          {toppings.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-[#a39589]">
                  2. Thêm Topping
                </label>
                <span className="text-[11px] text-stone-400 dark:text-[#847569]">
                  (Tối đa 3 loại • Đã chọn {selectedToppings.length}/3)
                </span>
              </div>
              <div className="space-y-1.5">
                {toppings.map((topping) => {
                  const isChecked = selectedToppings.some(
                    (t) => t.id === topping.id,
                  );
                  return (
                    <label
                      key={topping.id}
                      className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-colors ${
                        isChecked
                          ? "border-amber-500 bg-amber-50/70 dark:bg-amber-950/40 text-amber-950 dark:text-amber-200 font-medium"
                          : "border-[#ede5dc] dark:border-[#2a221c] hover:bg-stone-50 dark:hover:bg-[#201814] text-stone-700 dark:text-[#d5cbc3] bg-white/70 dark:bg-[#1a1411]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleTopping(topping)}
                          className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-stone-300 dark:border-stone-600 accent-amber-600 cursor-pointer"
                        />
                        <span className="text-sm">{topping.name}</span>
                      </div>
                      <span className="text-xs text-stone-500 dark:text-[#9e8f83] font-mono">
                        +{topping.price.toLocaleString("vi-VN")}₫
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. Ghi chú */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-[#a39589] block mb-1.5">
              3. Ghi chú cho Barista (Tùy chọn)
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ví dụ: Ít đá, ít ngọt, nhiều sữa..."
              maxLength={100}
              className="w-full text-sm px-3.5 py-2.5 rounded-xl border border-[#ede5dc] dark:border-[#2a221c] bg-white dark:bg-[#1a1411] text-stone-900 dark:text-[#f4ede6] focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 placeholder:text-stone-400 dark:placeholder:text-[#6e5f54]"
            />
          </div>
        </div>

        {/* Footer: Chọn số lượng & Nút Thêm vào giỏ */}
        <div className="p-4 border-t border-[#ede5dc] dark:border-[#261e19] bg-[#fbf8f5] dark:bg-[#120f0d] flex items-center justify-between gap-4">
          {/* Tăng giảm số lượng */}
          <div className="flex items-center border border-[#ede5dc] dark:border-[#2e241e] rounded-xl bg-white dark:bg-[#1a1411] shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              disabled={quantity <= 1}
              className="w-9 h-9 flex items-center justify-center text-stone-600 dark:text-[#c4b6ab] hover:bg-stone-100 dark:hover:bg-[#281f19] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              −
            </button>
            <span className="w-10 text-center font-bold text-sm text-stone-800 dark:text-[#f4ede6]">
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity(Math.min(20, available, quantity + 1))}
              disabled={quantity >= Math.min(20, available)}
              className="w-9 h-9 flex items-center justify-center text-stone-600 dark:text-[#c4b6ab] hover:bg-stone-100 dark:hover:bg-[#281f19] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              +
            </button>
          </div>

          {/* Nút xác nhận thêm vào giỏ */}
          <button
            type="button"
            onClick={handleAddToCart}
            disabled={isAdded || !isHydrated || available < quantity}
            className={`flex-1 py-3 px-4 rounded-xl font-bold text-sm text-white shadow-md transition-all flex items-center justify-between cursor-pointer ${
              isAdded
                ? "bg-emerald-600 shadow-emerald-600/20"
                : "bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 shadow-amber-600/25 active:scale-98"
            }`}
          >
            <span>{isAdded ? "✓ Đã thêm vào giỏ!" : "Thêm vào giỏ hàng"}</span>
            <span className="font-mono text-amber-100">
              {totalPrice.toLocaleString("vi-VN")}₫
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
