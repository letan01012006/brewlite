import type { CartItem, Ingredient, IngredientUnit, InventoryAvailability, InventoryMovement, StockRow } from '@/types';
import { apiFetch } from '@/lib/api/client';
import { orderItems } from '@/lib/order-payload';

export function checkInventory(items: CartItem[], signal?: AbortSignal) {
  return apiFetch<InventoryAvailability>('/inventory/availability', {
    auth: false, method: 'POST', body: JSON.stringify({ items: orderItems(items) }), signal,
  });
}
export function shortageMessage(result: InventoryAvailability) {
  return result.available ? null : 'Không đủ nguyên liệu cho toàn bộ giỏ hàng. Vui lòng giảm số lượng hoặc đổi size/topping.';
}

// ===== Barista: nguyên liệu & kho =====
export const UNIT_LABEL: Record<IngredientUnit, string> = { GRAM: 'g', MILLILITRE: 'ml', PIECE: 'cái' };
/** Số lượng hợp lệ theo API: tối đa 15 chữ số nguyên, 3 chữ số thập phân; PIECE phải nguyên. */
export function validQuantity(value: string, unit: IngredientUnit, signed = false) {
  const v = value.trim();
  const re = unit === 'PIECE' ? /^-?\d{1,15}$/ : /^-?\d{1,15}(\.\d{1,3})?$/;
  if (!re.test(v) || (!signed && v.startsWith('-'))) return false;
  return Number(v) !== 0;
}
export function getStock(signal?: AbortSignal) {
  return apiFetch<StockRow[]>('/inventory/stock', { signal });
}
export function createIngredient(body: { code: string; name: string; unit: IngredientUnit }) {
  return apiFetch<Ingredient>('/inventory/ingredients', { method: 'POST', body: JSON.stringify(body) });
}
export function updateIngredient(id: number, body: Partial<{ code: string; name: string; unit: IngredientUnit; isActive: boolean }>) {
  return apiFetch<Ingredient>(`/inventory/ingredients/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
export function postStock(
  kind: 'receipts' | 'adjustments',
  body: { ingredientId: number; quantity: string; reason: string },
  idempotencyKey: string,
) {
  return apiFetch<InventoryMovement>(`/inventory/${kind}`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': idempotencyKey },
  });
}
export function getMovements(params: { ingredientId?: number; page?: number; limit?: number }, signal?: AbortSignal) {
  const q = [
    ...(params.ingredientId ? [`ingredientId=${Math.trunc(params.ingredientId)}`] : []),
    `page=${Math.trunc(params.page ?? 1)}`,
    `limit=${Math.trunc(params.limit ?? 20)}`,
  ].join('&');
  return apiFetch<{ data: InventoryMovement[]; meta: { total: number; page: number; limit: number; totalPages: number } }>(
    `/inventory/movements?${q}`, { signal },
  );
}
