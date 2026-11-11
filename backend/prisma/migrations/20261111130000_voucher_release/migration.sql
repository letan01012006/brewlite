ALTER TABLE "Order" ADD COLUMN "promoReleasedAt" TIMESTAMP(3);

-- Earlier cancellation code already returned the voucher, even when a gateway
-- outcome was unknown. Mark those historical releases without changing counts.
UPDATE "Order" SET "promoReleasedAt" = "updatedAt"
WHERE "status" = 'CANCELLED' AND "promoCode" IS NOT NULL;

CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
