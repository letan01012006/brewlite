import type { Order, Payment, Prisma } from '../generated/prisma/client.js';
import { pointsEarnedFor } from '../promotions/voucher-rules.js';

// Call inside the status/payment transaction, with lockOrder already held.
// The ledger (including legacy event keys) is authoritative, not pointsEarned.
export async function awardOrderPoints(
  tx: Prisma.TransactionClient,
  order: Pick<Order, 'id' | 'userId' | 'total'>,
  payment?: Pick<Payment, 'id' | 'amount'> | null,
): Promise<number> {
  const existing = await tx.loyaltyTransaction.findFirst({
    where: { orderId: order.id, type: 'EARN' },
  });
  if (existing) {
    const revoked =
      existing.reversedAt ||
      (await tx.loyaltyTransaction.findFirst({
        where: { relatedTransactionId: existing.id, type: 'REVOKE' },
      }));
    return revoked ? 0 : existing.points;
  }
  const points = pointsEarnedFor(payment?.amount ?? order.total);
  await tx.loyaltyTransaction.create({
    data: {
      userId: order.userId,
      orderId: order.id,
      paymentId: payment?.id,
      type: 'EARN',
      points,
      pointsAmount: 0,
      eventKey: `order:${order.id}:earn`,
    },
  });
  if (points > 0)
    await tx.user.update({
      where: { id: order.userId },
      data: { loyaltyPoints: { increment: points } },
    });
  return points;
}

export async function revokeOrderPoints(
  tx: Prisma.TransactionClient,
  order: Pick<Order, 'id' | 'userId'>,
) {
  const earn = await tx.loyaltyTransaction.findFirst({
    where: { orderId: order.id, type: 'EARN' },
  });
  if (!earn || earn.reversedAt) {
    await tx.order.update({
      where: { id: order.id },
      data: { pointsEarned: 0 },
    });
    return;
  }
  const revoked = await tx.loyaltyTransaction.findFirst({
    where: { relatedTransactionId: earn.id, type: 'REVOKE' },
  });
  if (!revoked && earn.points > 0) {
    // Serialize balance reads with redemption/refunds for other orders too.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${order.userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({
      where: { id: order.userId },
    });
    // Retain the existing rule that a customer's available balance cannot be negative.
    const points = Math.min(user.loyaltyPoints, earn.points);
    if (points > 0)
      await tx.user.update({
        where: { id: order.userId },
        data: { loyaltyPoints: { decrement: points } },
      });
    await tx.loyaltyTransaction.create({
      data: {
        userId: order.userId,
        orderId: order.id,
        type: 'REVOKE',
        points: -earn.points,
        pointsAmount: 0,
        relatedTransactionId: earn.id,
        eventKey: `loyalty:${earn.id}:revoke`,
      },
    });
  }
  await tx.loyaltyTransaction.update({
    where: { id: earn.id },
    data: { reversedAt: new Date() },
  });
  await tx.order.update({ where: { id: order.id }, data: { pointsEarned: 0 } });
}
