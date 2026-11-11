import type { CartItem } from '@/types';

export interface CartBatch { id: string; quantity: number }
export type CartBatches = Record<string, CartBatch[]>;
export interface CartPurchase { batches: CartBatches }

// Track additions separately so a delayed payment cannot consume a newer addition.
export function reconcileBatches(items: CartItem[], previous: CartBatches): CartBatches {
  return Object.fromEntries(items.map(item => {
    const batches = (Array.isArray(previous[item.id]) ? previous[item.id] : [])
      .filter(batch => batch && typeof batch.id === 'string' && Number.isInteger(batch.quantity) && batch.quantity > 0)
      .map(batch => ({ ...batch }));
    let difference = item.quantity - batches.reduce((sum, batch) => sum + batch.quantity, 0);
    if (difference > 0) batches.push({ id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random()}`, quantity: difference });
    // Removing quantity consumes the oldest additions first.
    for (const batch of batches) {
      if (difference >= 0) break;
      const removed = Math.min(batch.quantity, -difference);
      batch.quantity -= removed;
      difference += removed;
    }
    return [item.id, batches.filter(batch => batch.quantity > 0)];
  }));
}

export function subtractPurchase(items: CartItem[], batches: CartBatches, purchase: CartPurchase) {
  const remaining: CartBatches = {};
  const remainingItems = items.flatMap(item => {
    const bought = new Map((purchase.batches[item.id] ?? []).map(batch => [batch.id, batch.quantity]));
    remaining[item.id] = (batches[item.id] ?? []).flatMap(batch => {
      const quantity = Math.max(0, batch.quantity - (bought.get(batch.id) ?? 0));
      return quantity ? [{ ...batch, quantity }] : [];
    });
    const quantity = remaining[item.id].reduce((sum, batch) => sum + batch.quantity, 0);
    return quantity ? [{ ...item, quantity, lineTotal: item.unitPrice * quantity }] : [];
  });
  return { items: remainingItems, batches: remaining };
}
