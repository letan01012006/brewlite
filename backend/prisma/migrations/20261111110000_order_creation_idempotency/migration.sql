-- NULL keeps pre-existing orders and clients without the header compatible.
ALTER TABLE "Order"
  ADD COLUMN "creationKey" TEXT,
  ADD COLUMN "creationRequestHash" TEXT;
CREATE UNIQUE INDEX "Order_userId_creationKey_key" ON "Order" ("userId", "creationKey");
ALTER TABLE "Order" ADD CONSTRAINT "Order_creation_identity_valid" CHECK (
  ("creationKey" IS NULL AND "creationRequestHash" IS NULL)
  OR ("creationKey" IS NOT NULL AND "creationRequestHash" IS NOT NULL
    AND length(btrim("creationKey")) BETWEEN 1 AND 128
    AND "creationRequestHash" ~ '^[a-f0-9]{64}$')
);
