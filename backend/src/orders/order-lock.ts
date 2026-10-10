import type { Prisma } from '../generated/prisma/client.js';

/**
 * Serialize payment, cancellation and status changes for the same order.
 * Call inside a transaction, before reading its status or related payments.
 * The row lock is held until that transaction commits or rolls back.
 */
export async function lockOrder(
  tx: Prisma.TransactionClient,
  orderId: number,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
}
