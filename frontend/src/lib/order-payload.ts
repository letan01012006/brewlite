import type { CartItem } from "@/types";

export function orderItems(items: CartItem[]) {
  return items.map((item) => ({
    productId: item.product.id,
    size: item.size,
    quantity: item.quantity,
    toppingIds: item.selectedToppings.map((topping) => topping.id),
    note: item.note,
  }));
}

export function cartKey(items: CartItem[], promoCode: string | null) {
  return JSON.stringify({ items: orderItems(items), promoCode });
}
