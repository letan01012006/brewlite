-- Do not edit historical migrations or migration-history rows. All DDL below
-- converges the inspected legacy payment layout and the repository baseline.
-- Fail atomically on incompatible data; never repair balances automatically.
BEGIN;

ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "pointsUsed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pointsAmount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "gatewayTxnRef" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayTransactionNo" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayBankCode" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayResponseCode" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayPayDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ipnProcessedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
  ADD COLUMN "paymentUrl" TEXT,
  ADD COLUMN "gatewayCreatedAt" TIMESTAMP(3),
  ADD COLUMN "vnpCreateDate" VARCHAR(14),
  ADD COLUMN "bankTransactionNo" TEXT,
  ADD COLUMN "cardType" TEXT,
  ADD COLUMN "gatewayTransactionStatus" TEXT,
  ADD COLUMN "vnpPayDate" VARCHAR(14);

-- A nullable PostgreSQL UNIQUE index permits multiple NULLs. No second plain
-- index is needed. Reject a conflicting object instead of silently skipping it.
DO $$ BEGIN
  IF to_regclass('"Payment_gatewayTxnRef_key"') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
    WHERE i.indexrelid=to_regclass('"Payment_gatewayTxnRef_key"')
      AND i.indrelid='"Payment"'::regclass AND i.indisunique AND i.indisvalid
      AND i.indnatts=1 AND a.attname='gatewayTxnRef' AND i.indpred IS NULL
  ) THEN
    RAISE EXCEPTION 'Unexpected Payment_gatewayTxnRef_key definition; inspect before upgrading';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_gatewayTxnRef_key" ON "Payment"("gatewayTxnRef");
DROP INDEX IF EXISTS "Payment_gatewayTxnRef_idx";
CREATE INDEX IF NOT EXISTS "Payment_status_expiresAt_idx" ON "Payment"("status","expiresAt");
CREATE UNIQUE INDEX "Payment_id_orderId_key" ON "Payment"("id","orderId");
CREATE UNIQUE INDEX "Payment_method_providerRef_key" ON "Payment"("method","providerRef");
CREATE UNIQUE INDEX "Order_id_userId_key" ON "Order"("id","userId");
CREATE UNIQUE INDEX "Order_id_total_key" ON "Order"("id","total");
CREATE UNIQUE INDEX "Payment_id_amount_key" ON "Payment"("id","amount");
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_orderId_fkey";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_amount_fkey"
  FOREIGN KEY ("orderId","amount") REFERENCES "Order"("id","total") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_points_valid_amounts";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_points_valid_amounts" CHECK (
  "pointsUsed" >= 0 AND "pointsAmount" >= 0
  AND (("method" = 'POINTS' AND "pointsUsed" > 0 AND "amount" > 0)
    OR ("method" <> 'POINTS' AND "pointsUsed" = 0 AND "pointsAmount" = 0))
  AND ("pointsAmount" = 0 OR ("method" = 'POINTS' AND "pointsAmount" = "amount"))
);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_gateway_valid" CHECK (
  ("gatewayTxnRef" IS NULL OR ("method" = 'VNPAY' AND btrim("gatewayTxnRef") <> ''))
  AND ("method" <> 'POINTS' OR ("gatewayTxnRef" IS NULL AND "paymentUrl" IS NULL))
  AND ("vnpCreateDate" IS NULL OR "vnpCreateDate" ~ '^[0-9]{14}$')
  AND ("vnpPayDate" IS NULL OR "vnpPayDate" ~ '^[0-9]{14}$')
  AND ("gatewayCreatedAt" IS NULL OR ("expiresAt" IS NOT NULL AND "expiresAt" > "gatewayCreatedAt"))
);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_refund_settlement_valid" CHECK (
  ("refundedAt" IS NULL AND "refundedAmount" = 0)
  OR ("refundedAt" IS NOT NULL AND "status" IN ('SUCCESS','NEEDS_REFUND')
    AND "refundedAmount" = "amount")
);
-- NEEDS_REFUND deliberately does NOT occupy the successful order slot:
-- a late-paid failed attempt may coexist with another SUCCESS/PROCESSING.
-- Keep the existing Payment_one_active_per_order index unchanged.

ALTER TABLE "LoyaltyTransaction"
  ADD COLUMN IF NOT EXISTS "paymentId" INTEGER,
  ADD COLUMN IF NOT EXISTS "relatedTransactionId" INTEGER,
  ADD COLUMN IF NOT EXISTS "type" "LoyaltyTransactionType" NOT NULL DEFAULT 'EARN',
  ADD COLUMN IF NOT EXISTS "pointsAmount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "eventKey" TEXT;
UPDATE "LoyaltyTransaction" SET "eventKey" = 'legacy:loyalty:' || "id"::text;
ALTER TABLE "LoyaltyTransaction" ALTER COLUMN "eventKey" SET NOT NULL;
DROP INDEX IF EXISTS "LoyaltyTransaction_orderId_key";
ALTER TABLE "LoyaltyTransaction" DROP CONSTRAINT IF EXISTS "LoyaltyTransaction_points_nonnegative";
ALTER TABLE "LoyaltyTransaction" DROP CONSTRAINT IF EXISTS "LoyaltyTransaction_points_sign_check";
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_points_sign_check" CHECK (
  btrim("eventKey") <> '' AND "pointsAmount" >= 0
  AND (("type" = 'EARN' AND "points" >= 0)
    OR ("type" = 'REDEEM' AND "points" < 0 AND "paymentId" IS NOT NULL)
    OR ("type" = 'REFUND' AND "points" > 0 AND "paymentId" IS NOT NULL AND "relatedTransactionId" IS NOT NULL)
    OR ("type" = 'REVOKE' AND "points" < 0 AND "relatedTransactionId" IS NOT NULL)
    OR ("type" = 'ADJUSTMENT' AND "points" <> 0))
  AND ("reversedAt" IS NULL OR "type" = 'EARN')
  AND ("relatedTransactionId" IS NULL OR "relatedTransactionId" <> "id")
);
CREATE UNIQUE INDEX "LoyaltyTransaction_eventKey_key" ON "LoyaltyTransaction"("eventKey");
CREATE UNIQUE INDEX "LoyaltyTransaction_paymentId_type_key" ON "LoyaltyTransaction"("paymentId","type");
CREATE UNIQUE INDEX "LoyaltyTransaction_id_orderId_userId_key" ON "LoyaltyTransaction"("id","orderId","userId");
CREATE INDEX IF NOT EXISTS "LoyaltyTransaction_userId_idx" ON "LoyaltyTransaction"("userId");
CREATE INDEX IF NOT EXISTS "LoyaltyTransaction_userId_createdAt_idx" ON "LoyaltyTransaction"("userId","createdAt");
CREATE INDEX IF NOT EXISTS "LoyaltyTransaction_orderId_idx" ON "LoyaltyTransaction"("orderId");
CREATE INDEX "LoyaltyTransaction_orderId_createdAt_idx" ON "LoyaltyTransaction"("orderId","createdAt");
CREATE INDEX IF NOT EXISTS "LoyaltyTransaction_paymentId_idx" ON "LoyaltyTransaction"("paymentId");
CREATE INDEX "LoyaltyTransaction_relatedTransactionId_orderId_userId_idx" ON "LoyaltyTransaction"("relatedTransactionId","orderId","userId");
CREATE UNIQUE INDEX IF NOT EXISTS "LoyaltyTransaction_one_earn_per_order" ON "LoyaltyTransaction"("orderId") WHERE "type"='EARN';
DROP INDEX IF EXISTS "LoyaltyTransaction_one_refund_per_payment";
CREATE UNIQUE INDEX "LoyaltyTransaction_one_revoke_per_earn" ON "LoyaltyTransaction"("relatedTransactionId") WHERE "type"='REVOKE';
ALTER TABLE "LoyaltyTransaction" DROP CONSTRAINT "LoyaltyTransaction_orderId_fkey";
ALTER TABLE "LoyaltyTransaction" DROP CONSTRAINT IF EXISTS "LoyaltyTransaction_paymentId_fkey";
ALTER TABLE "LoyaltyTransaction" DROP CONSTRAINT IF EXISTS "LoyaltyTransaction_relatedTransactionId_fkey";
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_orderId_userId_fkey"
  FOREIGN KEY ("orderId","userId") REFERENCES "Order"("id","userId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_paymentId_orderId_fkey"
  FOREIGN KEY ("paymentId","orderId") REFERENCES "Payment"("id","orderId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_relatedTransactionId_orderId_userId_fkey"
  FOREIGN KEY ("relatedTransactionId","orderId","userId") REFERENCES "LoyaltyTransaction"("id","orderId","userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE IF NOT EXISTS "PaymentRefund" (
  "id" SERIAL PRIMARY KEY, "paymentId" INTEGER NOT NULL, "amount" INTEGER NOT NULL,
  "status" "RefundStatus" NOT NULL DEFAULT 'PENDING', "gatewayRefundNo" TEXT,
  "gatewayResponseCode" TEXT, "failureReason" TEXT, "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentRefund_amount_check" CHECK ("amount" > 0)
);
ALTER TABLE "PaymentRefund" ADD COLUMN "idempotencyKey" TEXT;
UPDATE "PaymentRefund" SET "idempotencyKey"='legacy:refund:' || "id"::text;
ALTER TABLE "PaymentRefund" ALTER COLUMN "idempotencyKey" SET NOT NULL;
CREATE UNIQUE INDEX "PaymentRefund_paymentId_key" ON "PaymentRefund"("paymentId");
CREATE UNIQUE INDEX "PaymentRefund_idempotencyKey_key" ON "PaymentRefund"("idempotencyKey");
ALTER TABLE "PaymentRefund" DROP CONSTRAINT "PaymentRefund_paymentId_fkey";
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_paymentId_amount_fkey"
  FOREIGN KEY ("paymentId","amount") REFERENCES "Payment"("id","amount") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX IF NOT EXISTS "PaymentRefund_paymentId_status_idx" ON "PaymentRefund"("paymentId","status");
CREATE INDEX IF NOT EXISTS "PaymentRefund_status_createdAt_idx" ON "PaymentRefund"("status","createdAt");
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_valid_state" CHECK (
  btrim("idempotencyKey") <> '' AND (("status"='SUCCESS' AND "confirmedAt" IS NOT NULL)
    OR ("status"<>'SUCCESS' AND "confirmedAt" IS NULL))
);

CREATE TABLE IF NOT EXISTS "PaymentWebhookLog" (
  "id" SERIAL PRIMARY KEY, "paymentId" INTEGER, "gatewayTxnRef" TEXT,
  "gatewayTransactionNo" TEXT, "amount" INTEGER, "responseCode" TEXT,
  "signatureValid" BOOLEAN, "processed" BOOLEAN NOT NULL DEFAULT false,
  "message" TEXT, "rawPayload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "PaymentWebhookLog"
  ALTER COLUMN "gatewayTxnRef" DROP NOT NULL,
  ALTER COLUMN "amount" DROP NOT NULL,
  ALTER COLUMN "signatureValid" DROP NOT NULL,
  ADD COLUMN "source" "PaymentEventSource" NOT NULL DEFAULT 'IPN',
  ADD COLUMN "result" "PaymentEventResult" NOT NULL DEFAULT 'RECEIVED',
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "PaymentWebhookLog" DROP CONSTRAINT IF EXISTS "PaymentWebhookLog_paymentId_fkey";
ALTER TABLE "PaymentWebhookLog" ADD CONSTRAINT "PaymentWebhookLog_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "PaymentWebhookLog_paymentId_createdAt_idx" ON "PaymentWebhookLog"("paymentId","createdAt");
CREATE INDEX "PaymentWebhookLog_source_createdAt_idx" ON "PaymentWebhookLog"("source","createdAt");
CREATE INDEX "PaymentWebhookLog_requestId_idx" ON "PaymentWebhookLog"("requestId");
CREATE INDEX IF NOT EXISTS "PaymentWebhookLog_gatewayTxnRef_createdAt_idx" ON "PaymentWebhookLog"("gatewayTxnRef","createdAt");
CREATE INDEX IF NOT EXISTS "PaymentWebhookLog_signatureValid_processed_idx" ON "PaymentWebhookLog"("signatureValid","processed");
ALTER TABLE "PaymentWebhookLog" ADD CONSTRAINT "PaymentWebhookLog_amount_valid" CHECK ("amount" IS NULL OR "amount" >= 0);

COMMIT;
