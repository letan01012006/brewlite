import type { CartItem, Product, Size, Topping } from "@/types";

export const MAX_LINES = 30;
export const MAX_QUANTITY = 20;
const surcharges: Record<Size, number> = { S: 0, M: 5000, L: 10000 };

export function unitPrice(product: Product, size: Size, toppings: Topping[]) {
  return (
    product.price +
    (product.sizes?.find((entry) => entry.size === size)?.surcharge ??
      surcharges[size]) +
    toppings.reduce((sum, topping) => sum + topping.price, 0)
  );
}

export function makeItem(
  product: Product,
  size: Size,
  toppings: Topping[],
  quantity: number,
  note?: string,
): CartItem {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY)
    throw new Error("Mỗi dòng chỉ được từ 1 đến 20 ly.");
  if (
    !product ||
    !Number.isInteger(product.id) ||
    !Number.isFinite(product.price) ||
    product.price < 0 ||
    !Number.isInteger(product.stock) ||
    product.stock < 0
  )
    throw new Error("Thông tin món không hợp lệ. Vui lòng tải lại menu.");
  if (!["S", "M", "L"].includes(size))
    throw new Error("Kích cỡ món không hợp lệ.");
  if (
    toppings.length > 3 ||
    new Set(toppings.map((t) => t.id)).size !== toppings.length ||
    toppings.some(
      (t) =>
        !Number.isInteger(t.id) || !Number.isFinite(t.price) || t.price < 0,
    )
  )
    throw new Error("Mỗi ly chỉ được tối đa 3 topping khác nhau.");
  const cleanNote = (note || "").trim();
  if (cleanNote.length > 200)
    throw new Error("Ghi chú không được vượt quá 200 ký tự.");
  const price = unitPrice(product, size, toppings);
  return {
    id: `${product.id}_${size}_${toppings
      .map((t) => t.id)
      .sort((a, b) => a - b)
      .join("-")}_${cleanNote.toLowerCase()}`,
    product,
    size,
    selectedToppings: toppings,
    quantity,
    note: cleanNote || undefined,
    unitPrice: price,
    lineTotal: price * quantity,
  };
}

export function basketError(items: CartItem[]): string | null {
  if (items.length > MAX_LINES) return "Một đơn chỉ được tối đa 30 dòng món.";
  const totals = new Map<number, number>();
  for (const item of items) {
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > MAX_QUANTITY
    )
      return "Mỗi dòng chỉ được từ 1 đến 20 ly.";
    const quantity = (totals.get(item.product.id) ?? 0) + item.quantity;
    totals.set(item.product.id, quantity);
  }
  for (const item of items) {
    if (totals.get(item.product.id)! > item.product.stock)
      return `${item.product.name || "Món này"} chỉ còn ${item.product.stock} ly, tính chung mọi size và topping.`;
  }
  return null;
}

export function restoreItems(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];
  const restored: CartItem[] = [];
  for (const raw of value.slice(0, MAX_LINES)) {
    try {
      const item = makeItem(
        raw.product,
        raw.size,
        raw.selectedToppings,
        raw.quantity,
        raw.note,
      );
      if (
        !restored.some((existing) => existing.id === item.id) &&
        !basketError([...restored, item])
      )
        restored.push(item);
    } catch {
      /* Malformed saved entries cannot enter a checkout payload. */
    }
  }
  return restored;
}
