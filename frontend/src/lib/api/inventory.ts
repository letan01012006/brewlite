import type {
  CartItem,
  Ingredient,
  IngredientUnit,
  InventoryAvailability,
  InventoryMovement,
  MovementKindFilter,
  PaginatedResponse,
  PreparedTopping,
  Product,
  ProductRecipe,
  Size,
  StockRow,
  Topping,
  ToppingRecipe,
} from '@/types';
import { ApiError, apiFetch } from '@/lib/api/client';
import { orderItems } from '@/lib/order-payload';

export function checkInventory(items: CartItem[], signal?: AbortSignal) {
  return apiFetch<InventoryAvailability>('/inventory/availability', {
    auth: false,
    method: 'POST',
    body: JSON.stringify({ items: orderItems(items) }),
    signal,
  });
}
export function shortageMessage(result: InventoryAvailability) {
  return result.available
    ? null
    : 'Không đủ nguyên liệu cho toàn bộ giỏ hàng. Vui lòng giảm số lượng hoặc đổi size/topping.';
}

// ===== Barista: nguyên liệu & kho =====
export const UNIT_LABEL: Record<IngredientUnit, string> = {
  GRAM: 'g',
  MILLILITRE: 'ml',
  PIECE: 'cái',
};
export const UNIT_NAME: Record<IngredientUnit, string> = {
  GRAM: 'Gram (g)',
  MILLILITRE: 'Mililit (ml)',
  PIECE: 'Cái (cái)',
};

/** Số lượng hợp lệ theo API: tối đa 15 chữ số nguyên, 3 chữ số thập phân; PIECE phải nguyên. */
export function validQuantity(
  value: string,
  unit: IngredientUnit,
  signed = false,
) {
  const v = value.trim();
  const re = unit === 'PIECE' ? /^-?\d{1,15}$/ : /^-?\d{1,15}(\.\d{1,3})?$/;
  if (!re.test(v) || (!signed && v.startsWith('-'))) return false;
  return Number(v) !== 0;
}

export function calculateToppingServings(
  availableQuantity: string | number,
  quantityPerServing: string | number | null | undefined,
  isIngredientActive = true,
): number | null {
  if (!isIngredientActive) return 0;
  if (quantityPerServing === null || quantityPerServing === undefined)
    return null;
  const avail = Number(availableQuantity);
  const perServing = Number(quantityPerServing);
  if (!Number.isFinite(avail) || !Number.isFinite(perServing) || perServing <= 0)
    return null;
  return Math.max(0, Math.floor((avail + 1e-9) / perServing));
}

export function calculateRecipeCups(
  ingredients: Array<{ ingredientId: number; quantity: string }>,
  stockById: Map<number, StockRow>,
  isActive = true,
) {
  if (!isActive || ingredients.length === 0) {
    return {
      configured: false,
      hasPausedIngredient: false,
      maxCups: 0,
      missing: [] as Array<{
        ingredientId: number;
        name: string;
        unit: IngredientUnit;
        required: string;
        available: string;
        isPaused?: boolean;
      }>,
    };
  }
  let maxCups = Number.MAX_SAFE_INTEGER;
  let hasPaused = false;
  const missing: Array<{
    ingredientId: number;
    name: string;
    unit: IngredientUnit;
    required: string;
    available: string;
    isPaused?: boolean;
  }> = [];
  for (const item of ingredients) {
    const stock = stockById.get(item.ingredientId);
    const req = Number(item.quantity);
    if (!stock || !stock.isActive) {
      hasPaused = true;
      maxCups = 0;
      missing.push({
        ingredientId: item.ingredientId,
        name: stock?.name ?? `#${item.ingredientId}`,
        unit: stock?.unit ?? 'GRAM',
        required: item.quantity,
        available: stock?.availableQuantity ?? '0',
        isPaused: true,
      });
      continue;
    }
    if (!Number.isFinite(req) || req <= 0) {
      maxCups = 0;
      continue;
    }
    const avail = Number(stock.availableQuantity);
    const cups = Math.max(0, Math.floor((avail + 1e-9) / req));
    maxCups = Math.min(maxCups, cups);
    if (cups < 1) {
      missing.push({
        ingredientId: item.ingredientId,
        name: stock.name,
        unit: stock.unit,
        required: item.quantity,
        available: stock.availableQuantity,
        isPaused: false,
      });
    }
  }
  return {
    configured: true,
    hasPausedIngredient: hasPaused,
    maxCups: hasPaused ? 0 : maxCups === Number.MAX_SAFE_INTEGER ? 0 : maxCups,
    missing,
  };
}

export function getStock(signal?: AbortSignal) {
  return apiFetch<StockRow[]>('/inventory/stock', { signal });
}
export function createIngredient(body: {
  code?: string;
  name: string;
  unit: IngredientUnit;
}) {
  return apiFetch<Ingredient>('/inventory/ingredients', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
export function updateIngredient(
  id: number,
  body: Partial<{
    code: string;
    name: string;
    unit: IngredientUnit;
    isActive: boolean;
  }>,
) {
  return apiFetch<Ingredient>(`/inventory/ingredients/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}
export function postStock(
  kind: 'receipts' | 'adjustments',
  body: { ingredientId: number; quantity: string; reason?: string },
  idempotencyKey: string,
) {
  return apiFetch<InventoryMovement>(`/inventory/${kind}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}
export function getMovementTypeLabel(
  m: Pick<InventoryMovement, 'kind' | 'stockDelta'>,
): string {
  if (m.kind === 'ADJUSTMENT') {
    return Number(m.stockDelta) > 0 ? 'Điều chỉnh tăng' : 'Ghi nhận hao hụt';
  }
  switch (m.kind) {
    case 'RECEIPT':
      return 'Nhập kho';
    case 'HOLD':
      return 'Giữ cho đơn';
    case 'RELEASE':
      return 'Hoàn trả từ đơn';
    case 'CONSUME':
      return 'Tiêu hao pha chế';
  }
}

export function getMovements(
  params: {
    ingredientId?: number;
    kind?: MovementKindFilter;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  },
  signal?: AbortSignal,
) {
  const q = [
    ...(params.ingredientId
      ? [`ingredientId=${Math.trunc(params.ingredientId)}`]
      : []),
    ...(params.kind ? [`kind=${encodeURIComponent(params.kind)}`] : []),
    ...(params.from ? [`from=${encodeURIComponent(params.from)}`] : []),
    ...(params.to ? [`to=${encodeURIComponent(params.to)}`] : []),
    `page=${Math.trunc(params.page ?? 1)}`,
    `limit=${Math.trunc(params.limit ?? 20)}`,
  ].join('&');
  return apiFetch<{
    data: InventoryMovement[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }>(`/inventory/movements?${q}`, { signal });
}

/**
 * Lấy toàn bộ danh sách sản phẩm cho Barista (bao gồm cả đang bán và tạm dừng) theo giới hạn phân trang của Backend (limit <= 50).
 */
export async function getProductsCatalog(
  signal?: AbortSignal,
): Promise<Product[]> {
  const items = new Map<number, Product>();
  let page = 1;
  let totalPages = 1;
  do {
    const response = await apiFetch<PaginatedResponse<Product>>(
      `/products?limit=50&page=${page}&includeInactive=true`,
      { signal, auth: false },
    );
    response.data.forEach((item) => items.set(item.id, item));
    totalPages = response.meta.totalPages;
    page++;
  } while (page <= totalPages);
  return [...items.values()];
}

export function updateProductStatus(productId: number, isActive: boolean) {
  return apiFetch<Product>(`/products/${productId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive }),
  });
}

export async function getProductRecipe(
  productId: number,
  size: Size,
  signal?: AbortSignal,
): Promise<ProductRecipe> {
  try {
    return await apiFetch<ProductRecipe>(
      `/products/${productId}/recipes/${size}`,
      { signal },
    );
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) {
      return {
        id: 0,
        productId,
        size,
        version: 0,
        isActive: false,
        ingredients: [],
      };
    }
    throw err;
  }
}

export function saveProductRecipe(
  productId: number,
  size: Size,
  body: {
    ingredients: Array<{ ingredientId: number; quantity: string }>;
    isActive?: boolean;
  },
) {
  return apiFetch<ProductRecipe>(`/products/${productId}/recipes/${size}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function getPreparedToppings(
  signal?: AbortSignal,
): Promise<PreparedTopping[]> {
  const toppings = await apiFetch<Topping[]>('/products/toppings', {
    auth: false,
    signal,
  });
  const recipes = await Promise.all(
    toppings.map((t) =>
      apiFetch<ToppingRecipe>(`/products/toppings/${t.id}/recipe`, {
        signal,
      }).catch((err: unknown) => {
        if (err instanceof ApiError && err.statusCode === 404) {
          return {
            id: t.id,
            ingredientId: null,
            quantityPerServing: null,
          };
        }
        throw err;
      }),
    ),
  );
  return toppings.map((t, index) => ({
    ...t,
    ingredientId: recipes[index].ingredientId,
    quantityPerServing: recipes[index].quantityPerServing,
  }));
}

export function createTopping(body: { name: string; price: number }) {
  return apiFetch<Topping>('/products/toppings', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function saveToppingRecipe(
  toppingId: number,
  body: { ingredientId: number; quantityPerServing: string },
) {
  return apiFetch<ToppingRecipe>(`/products/toppings/${toppingId}/recipe`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
