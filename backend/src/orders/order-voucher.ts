import type { Order, Prisma } from '../generated/prisma/client.js';

// The caller holds lockOrder. Marker and counter commit (or roll back) together.
export async function releaseOrderVoucher(
  tx: Prisma.TransactionClient,
  order: Pick<Order, 'id' | 'promoCode'>,
) {
  if (!order.promoCode) return;
  const released = await tx.order.updateMany({
    where: { id: order.id, promoReleasedAt: null },
    data: { promoReleasedAt: new Date() },
  });
  if (released.count)
    await tx.promoCode.update({
      where: { code: order.promoCode },
      data: { usedCount: { decrement: 1 } },
    });
}
