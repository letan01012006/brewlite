import { create } from "zustand";
import type { CartItem, Product, ProductDetail, Size, Topping } from "@/types";
import type { ValidatePromotionResult } from "@/types";
import { apiFetch, ApiError } from "@/lib/api/client";
import { orderItems } from "@/lib/order-payload";
import { makeItem, basketError, restoreItems, cartReviewKey } from "@/lib/cart-rules";
import { checkInventory, shortageMessage } from '@/lib/api/inventory';

interface AddItemInput {
  product: Product;
  size: Size;
  selectedToppings: Topping[];
  quantity: number;
  note?: string;
}

interface CartState {
  items: CartItem[];
  ownerId: number | null;
  isHydrated: boolean;
  isRefreshing: boolean;
  cartError: string | null;
  notice: string | null;
  requiresReview: boolean;
  acknowledgeChanges: () => void;
  hydrate: (ownerId: number | null) => void;
  deactivate: () => void;
  refreshCart: () => Promise<boolean>;
  promoCode: string | null;
  discountAmount: number;
  isValidatingPromo: boolean;
  promoError: string | null;
  promoRevision: number;
  validatePromo: (code: string) => Promise<void>;

  addItem: (input: AddItemInput) => boolean;
  addItemChecked: (input: AddItemInput) => Promise<boolean>;
  updateQuantityChecked: (itemId: string, quantity: number) => Promise<boolean>;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => boolean;
  setPromo: (code: string | null, discount: number) => void;
  clearCart: () => void;

  getSubtotal: () => number;
  getTotal: () => number;
  getTotalItemCount: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  ownerId: null,
  isHydrated: false,
  isRefreshing: false,
  cartError: null,
  notice: null,
  requiresReview: false,
  acknowledgeChanges: () => set({ requiresReview: false }),
  hydrate: (ownerId) => {
    if (get().isHydrated && get().ownerId === ownerId) return;
    const memoryGuest =
      ownerId !== null && get().isHydrated && get().ownerId === null
        ? get()
        : null;
    let items: CartItem[] = memoryGuest?.items ?? [];
    let promoCode: string | null = memoryGuest?.promoCode ?? null;
    let notice: string | null = null;
    let requiresReview = memoryGuest?.requiresReview ?? false;
    try {
      if (typeof window !== "undefined") {
        const saved = localStorage.getItem(storageKey(ownerId));
        if (saved) {
          const parsed = JSON.parse(saved);
          items = restoreItems(parsed.items);
          requiresReview = parsed.requiresReview === true;
          promoCode =
            items.length && typeof parsed.promoCode === "string"
              ? parsed.promoCode
              : null;
          if (items.length !== parsed.items?.length)
            notice =
              "Một số món đã lưu không hợp lệ hoặc vượt giới hạn nên đã được bỏ khỏi giỏ.";
          if (notice) requiresReview = true;
        } else items = [];
        if (ownerId !== null) {
          const guestSaved = localStorage.getItem(storageKey(null));
          const guest =
            memoryGuest ?? (guestSaved ? JSON.parse(guestSaved) : null);
          const guestItems = restoreItems(guest?.items);
          requiresReview ||= guest?.requiresReview === true;
          const remainingGuest: CartItem[] = [];
          for (const item of guestItems) {
            try {
              const existing = items.find((entry) => entry.id === item.id);
              const merged = makeItem(
                item.product,
                item.size,
                item.selectedToppings,
                item.quantity + (existing?.quantity ?? 0),
                item.note,
              );
              const candidate = [
                ...items.filter((entry) => entry.id !== item.id),
                merged,
              ];
              if (basketError(candidate)) throw new Error("Cart limit");
              items = candidate;
            } catch {
              remainingGuest.push(item);
            }
          }
          if (
            !promoCode &&
            items.length &&
            typeof guest?.promoCode === "string"
          )
            promoCode = guest.promoCode;
          if (guestItems.length)
            localStorage.setItem(
              storageKey(null),
              JSON.stringify({
                items: remainingGuest,
                promoCode: remainingGuest.length ? guest.promoCode : null,
                requiresReview: guest.requiresReview === true,
              }),
            );
          if (remainingGuest.length)
            notice =
              "Một số món của giỏ khách vượt giới hạn khi gộp; các món đó vẫn được giữ trong giỏ khách.";
        }
      }
    } catch {
      notice = "Không đọc được giỏ đã lưu. Vui lòng kiểm tra lại các món.";
    }
    set({
      items,
      promoCode,
      ownerId,
      discountAmount: 0,
      isHydrated: true,
      isRefreshing: false,
      isValidatingPromo: false,
      promoError: null,
      cartError: null,
      notice,
      requiresReview,
      promoRevision: get().promoRevision + 1,
    });
  },
  deactivate: () =>
    set({
      items: [],
      promoCode: null,
      discountAmount: 0,
      isHydrated: false,
      isRefreshing: false,
      isValidatingPromo: false,
      promoError: null,
      cartError: null,
      notice: null,
      requiresReview: false,
      promoRevision: get().promoRevision + 1,
    }),
  refreshCart: async () => {
    const { items, ownerId } = get();
    if (!get().isHydrated || get().isRefreshing) return false;
    if (!items.length) return true;
    set({ isRefreshing: true, cartError: null });
    try {
      const products = await Promise.all(
        [...new Set(items.map((item) => item.product.id))].map(async (id) => {
          try {
            return await apiFetch<ProductDetail>(`/products/${id}`, { auth: false });
          } catch (error) {
            if (error instanceof ApiError && error.statusCode === 404)
              return null;
            throw error;
          }
        }),
      );
      if (get().items !== items || get().ownerId !== ownerId) return false;
      const remaining = new Map(
        products
          .filter((p): p is ProductDetail => p !== null)
          .map((p) => [p.id, p.stock]),
      );
      const refreshed: CartItem[] = [];
      const changes: string[] = [];
      for (const item of items) {
        const product = products.find((p) => p?.id === item.product.id);
        if (!product || product.isActive === false) {
          changes.push(`${item.product.name}: đã ngừng bán hoặc không còn tồn tại`);
          continue;
        }
        const quantity = Math.min(
          item.quantity,
          product.inventoryMode === 'INGREDIENT' ? 20 : remaining.get(product.id) ?? 0,
        );
        if (!quantity) {
          changes.push(`${product.name}: đã hết hàng`);
          continue;
        }
        if (quantity !== item.quantity) changes.push(`${product.name}: số lượng còn ${quantity} ly`);
        const toppings = item.selectedToppings.flatMap(
          (old) => product.toppings?.find((t) => t.id === old.id && t.isActive !== false) ?? [],
        );
        const removed = item.selectedToppings.filter((old) => !toppings.some((t) => t.id === old.id));
        if (removed.length) changes.push(`${product.name}: bỏ topping ${removed.map((t) => t.name || `#${t.id}`).join(', ')} vì không còn được phép hoặc đã ngừng bán`);
        if (product.sizes && !product.sizes.some((entry) => entry.size === item.size)) {
          changes.push(`${product.name}: size ${item.size} không còn được bán, vui lòng chọn lại món`);
          continue;
        }
        remaining.set(product.id, (remaining.get(product.id) ?? 0) - quantity);
        if (product.name !== item.product.name) changes.push(`${item.product.name}: tên mới ${product.name}`);
        for (const topping of toppings) {
          const old = item.selectedToppings.find((entry) => entry.id === topping.id)!;
          if (old.name !== topping.name || old.price !== topping.price)
            changes.push(`${product.name}: topping ${old.name || `#${old.id}`} đổi thành ${topping.name} (${topping.price.toLocaleString('vi-VN')}₫)`);
        }
        const updated = makeItem(
          product,
          item.size,
          toppings,
          quantity,
          item.note,
        );
        if (updated.unitPrice !== item.unitPrice) changes.push(`${product.name}: đơn giá mới ${updated.unitPrice.toLocaleString('vi-VN')}₫`);
        const duplicate = refreshed.find((entry) => entry.id === updated.id);
        if (duplicate) {
          duplicate.quantity = Math.min(20, duplicate.quantity + quantity);
          duplicate.lineTotal = duplicate.quantity * duplicate.unitPrice;
        } else refreshed.push(updated);
      }
      let inventoryError: string | null = null;
      if (refreshed.some(item => item.product.inventoryMode === 'INGREDIENT')) {
        inventoryError = shortageMessage(await checkInventory(refreshed));
        if (get().items !== items || get().ownerId !== ownerId) return false;
      }
      const changed = cartReviewKey(items) !== cartReviewKey(refreshed);
      set({
        items: refreshed,
        cartError: inventoryError,
        requiresReview: get().requiresReview || changed,
        notice: changed
          ? `${changes.join('; ') || 'Thông tin món/topping trong giỏ đã được cập nhật'}. Vui lòng kiểm tra lại trước khi tạo đơn.`
          : get().notice,
      });
      if (get().promoCode) await get().validatePromo(get().promoCode!);
      return !inventoryError && get().items === refreshed && get().ownerId === ownerId;
    } catch (error) {
      if (get().items === items && get().ownerId === ownerId)
        set({
          cartError:
            error instanceof Error ? error.message : "Chưa kiểm tra được giá và tồn kho. Vui lòng thử lại trước khi thanh toán.",
        });
      return false;
    } finally {
      if (get().ownerId === ownerId) set({ isRefreshing: false });
    }
  },
  promoCode: null,
  discountAmount: 0,
  isValidatingPromo: false,
  promoError: null,
  promoRevision: 0,

  validatePromo: async (code) => {
    const cleanCode = code.trim().toUpperCase();
    const items = get().items;
    const revision = get().promoRevision + 1;
    set({
      promoRevision: revision,
      promoCode: cleanCode || null,
      discountAmount: 0,
      isValidatingPromo: !!cleanCode && items.length > 0,
      promoError: null,
    });
    if (!cleanCode || !items.length) {
      set({ promoCode: null });
      return;
    }
    try {
      const result = await apiFetch<ValidatePromotionResult>(
        "/promotions/validate",
        {
          method: "POST",
          body: JSON.stringify({ code: cleanCode, items: orderItems(items) }),
        },
      );
      if (get().promoRevision !== revision || get().items !== items) return;
      set({
        promoCode: result.code,
        discountAmount: result.discountAmount,
        isValidatingPromo: false,
      });
    } catch (error) {
      if (get().promoRevision !== revision || get().items !== items) return;
      set({
        promoCode: null,
        discountAmount: 0,
        isValidatingPromo: false,
        promoError:
          error instanceof ApiError
            ? error.message
            : "Không thể kiểm tra mã khuyến mãi. Vui lòng thử lại.",
      });
    }
  },

  addItemChecked: async (input) => {
    const { items, ownerId } = get();
    if (input.product.inventoryMode !== 'INGREDIENT' && !items.some(i => i.product.inventoryMode === 'INGREDIENT')) return get().addItem(input);
    try {
      const item = makeItem(input.product, input.size, input.selectedToppings, input.quantity, input.note);
      const existing = items.find(i => i.id === item.id);
      item.quantity += existing?.quantity ?? 0;
      item.lineTotal = item.quantity * item.unitPrice;
      const candidate = [...items.filter(i => i.id !== item.id), item];
      const invalid = basketError(candidate);
      if (invalid) throw new Error(invalid);
      const message = shortageMessage(await checkInventory(candidate));
      if (get().items !== items || get().ownerId !== ownerId || !get().isHydrated) return false;
      if (message) throw new Error(message);
      return get().addItem(input);
    } catch (error) {
      if (get().items === items && get().ownerId === ownerId) set({ cartError: error instanceof Error ? error.message : 'Không kiểm tra được nguyên liệu.' });
      return false;
    }
  },
  updateQuantityChecked: async (itemId, quantity) => {
    const { items, ownerId } = get();
    if (quantity === 0 || !items.some(i => i.product.inventoryMode === 'INGREDIENT')) return get().updateQuantity(itemId, quantity);
    try {
      const candidate = items.map(i => i.id === itemId ? { ...i, quantity, lineTotal: i.unitPrice * quantity } : i);
      const invalid = basketError(candidate);
      if (invalid) throw new Error(invalid);
      const message = shortageMessage(await checkInventory(candidate));
      if (get().items !== items || get().ownerId !== ownerId || !get().isHydrated) return false;
      if (message) throw new Error(message);
      return get().updateQuantity(itemId, quantity);
    } catch (error) {
      if (get().items === items && get().ownerId === ownerId) set({ cartError: error instanceof Error ? error.message : 'Không kiểm tra được nguyên liệu.' });
      return false;
    }
  },
  addItem: ({ product, size, selectedToppings, quantity, note }) => {
    try {
      if (!get().isHydrated)
        throw new Error("Đang khôi phục giỏ hàng, vui lòng thử lại.");
      const item = makeItem(product, size, selectedToppings, quantity, note);
      const existing = get().items.find((entry) => entry.id === item.id);
      if (existing) {
        item.quantity += existing.quantity;
        item.lineTotal = item.unitPrice * item.quantity;
      }
      const items = get()
        .items.filter((entry) => entry.id !== item.id)
        .map((entry) =>
          entry.product.id === product.id
            ? makeItem(
                product,
                entry.size,
                entry.selectedToppings,
                entry.quantity,
                entry.note,
              )
            : entry,
        );
      items.push(item);
      const error = basketError(items);
      if (error) throw new Error(error);
      set({ items, cartError: null });
      if (get().promoCode) void get().validatePromo(get().promoCode!);
      return true;
    } catch (error) {
      set({
        cartError:
          error instanceof Error
            ? error.message
            : "Không thể thêm món vào giỏ.",
      });
      return false;
    }
  },

  removeItem: (itemId) => {
    set((state) => ({
      items: state.items.filter((i) => i.id !== itemId),
      cartError: null,
    }));
    if (get().promoCode) void get().validatePromo(get().promoCode!);
  },

  updateQuantity: (itemId, quantity) => {
    if (quantity === 0) {
      get().removeItem(itemId);
      return true;
    }
    const items = get().items.map((item) =>
      item.id === itemId
        ? { ...item, quantity, lineTotal: item.unitPrice * quantity }
        : item,
    );
    const error = basketError(items);
    if (error) {
      set({ cartError: error });
      return false;
    }
    set({ items, cartError: null });
    if (get().promoCode) void get().validatePromo(get().promoCode!);
    return true;
  },

  setPromo: (promoCode, discountAmount) => {
    set({
      promoCode,
      discountAmount,
      promoRevision: get().promoRevision + 1,
      isValidatingPromo: false,
      promoError: null,
    });
  },

  clearCart: () => {
    set({
      items: [],
      cartError: null,
      notice: null,
      requiresReview: false,
      promoCode: null,
      discountAmount: 0,
      promoRevision: get().promoRevision + 1,
      isValidatingPromo: false,
      promoError: null,
    });
  },

  getSubtotal: () => {
    return get().items.reduce((sum, item) => sum + item.lineTotal, 0);
  },

  getTotal: () => {
    const subtotal = get().getSubtotal();
    return Math.max(0, subtotal - get().discountAmount);
  },

  getTotalItemCount: () => {
    return get().items.reduce((sum, item) => sum + item.quantity, 0);
  },
}));

function storageKey(ownerId: number | null) {
  return `brewlite_cart_v1_${ownerId ?? "guest"}`;
}
useCartStore.subscribe((state, previous) => {
  if (!state.isHydrated || typeof window === "undefined") return;
  if (
    state.items === previous.items &&
    state.promoCode === previous.promoCode &&
    state.ownerId === previous.ownerId &&
    state.requiresReview === previous.requiresReview &&
    previous.isHydrated
  )
    return;
  try {
    localStorage.setItem(
      storageKey(state.ownerId),
      JSON.stringify({ items: state.items, promoCode: state.promoCode, requiresReview: state.requiresReview }),
    );
  } catch {
    useCartStore.setState({
      notice:
        "Trình duyệt không lưu được giỏ hàng. Các món hiện tại sẽ mất khi tải lại trang.",
    });
  }
});
