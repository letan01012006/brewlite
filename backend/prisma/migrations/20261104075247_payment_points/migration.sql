-- 1. CẬP NHẬT VÀ TẠO ENUM MỚI
ALTER TYPE "PaymentMethod" ADD VALUE 'VNPAY';
ALTER TYPE "PaymentMethod" ADD VALUE 'POINTS';
ALTER TYPE "PaymentStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "PaymentStatus" ADD VALUE 'CANCELLED';

CREATE TYPE "LoyaltyTransactionType" AS ENUM ('EARN', 'REDEEM', 'REFUND', 'ADJUSTMENT');
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

-- 2. CẬP NHẬT BẢNG Payment
ALTER TABLE "Payment"
    ADD COLUMN "pointsUsed" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "pointsAmount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "gatewayTxnRef" TEXT,
    ADD COLUMN "gatewayTransactionNo" TEXT,
    ADD COLUMN "gatewayBankCode" TEXT,
    ADD COLUMN "gatewayResponseCode" TEXT,
    ADD COLUMN "gatewayPayDate" TIMESTAMP(3),
    ADD COLUMN "expiresAt" TIMESTAMP(3),
    ADD COLUMN "ipnProcessedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Payment_gatewayTxnRef_key" 
    ON "Payment"("gatewayTxnRef") 
    WHERE "gatewayTxnRef" IS NOT NULL;

CREATE INDEX "Payment_status_expiresAt_idx" 
    ON "Payment"("status", "expiresAt");

ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_points_valid_amounts";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_points_valid_amounts"
    CHECK ("pointsUsed" >= 0 AND "pointsAmount" >= 0);

ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_valid_amounts";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_valid_amounts"
    CHECK ("amount" >= 0 AND "refundedAmount" >= 0 AND "refundedAmount" <= "amount");

-- 3. CẬP NHẬT BẢNG LoyaltyTransaction THÀNH SỔ CÁI
ALTER TABLE "LoyaltyTransaction" DROP CONSTRAINT IF EXISTS "LoyaltyTransaction_orderId_key";
DROP INDEX IF EXISTS "LoyaltyTransaction_orderId_key";

ALTER TABLE "LoyaltyTransaction"
    ADD COLUMN "paymentId" INTEGER,
    ADD COLUMN "relatedTransactionId" INTEGER,
    ADD COLUMN "type" "LoyaltyTransactionType" NOT NULL DEFAULT 'EARN',
    ADD COLUMN "pointsAmount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "LoyaltyTransaction" DROP CONSTRAINT IF EXISTS "LoyaltyTransaction_points_nonnegative";

ALTER TABLE "LoyaltyTransaction" DROP CONSTRAINT IF EXISTS "LoyaltyTransaction_points_sign_check";
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_points_sign_check"
    CHECK (
        ("type" = 'EARN' AND "points" > 0 AND "pointsAmount" >= 0) OR
        ("type" = 'REDEEM' AND "points" < 0 AND "pointsAmount" > 0) OR
        ("type" = 'REFUND' AND "points" > 0 AND "pointsAmount" >= 0) OR
        ("type" = 'ADJUSTMENT' AND "points" <> 0)
    );

ALTER TABLE "LoyaltyTransaction"
    ADD CONSTRAINT "LoyaltyTransaction_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LoyaltyTransaction"
    ADD CONSTRAINT "LoyaltyTransaction_relatedTransactionId_fkey"
    FOREIGN KEY ("relatedTransactionId") REFERENCES "LoyaltyTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "LoyaltyTransaction_userId_createdAt_idx" 
    ON "LoyaltyTransaction"("userId", "createdAt" DESC);
CREATE INDEX "LoyaltyTransaction_orderId_idx" 
    ON "LoyaltyTransaction"("orderId");
CREATE INDEX "LoyaltyTransaction_paymentId_idx" 
    ON "LoyaltyTransaction"("paymentId");

CREATE UNIQUE INDEX "LoyaltyTransaction_one_earn_per_order"
    ON "LoyaltyTransaction"("orderId")
    WHERE "type" = 'EARN';

CREATE UNIQUE INDEX "LoyaltyTransaction_one_refund_per_payment"
    ON "LoyaltyTransaction"("paymentId")
    WHERE "type" = 'REFUND' AND "paymentId" IS NOT NULL;

-- 4. TẠO BẢNG PaymentRefund
CREATE TABLE "PaymentRefund" (
    "id" SERIAL NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "gatewayRefundNo" TEXT,
    "gatewayResponseCode" TEXT,
    "failureReason" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentRefund_amount_check" CHECK ("amount" > 0)
);

ALTER TABLE "PaymentRefund"
    ADD CONSTRAINT "PaymentRefund_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "PaymentRefund_paymentId_status_idx" 
    ON "PaymentRefund"("paymentId", "status");
CREATE INDEX "PaymentRefund_status_createdAt_idx" 
    ON "PaymentRefund"("status", "createdAt");

-- 5. TẠO BẢNG PaymentWebhookLog
CREATE TABLE "PaymentWebhookLog" (
    "id" SERIAL NOT NULL,
    "paymentId" INTEGER,
    "gatewayTxnRef" TEXT NOT NULL,
    "gatewayTransactionNo" TEXT,
    "amount" INTEGER NOT NULL,
    "responseCode" TEXT,
    "signatureValid" BOOLEAN NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookLog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PaymentWebhookLog"
    ADD CONSTRAINT "PaymentWebhookLog_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PaymentWebhookLog_gatewayTxnRef_createdAt_idx" 
    ON "PaymentWebhookLog"("gatewayTxnRef", "createdAt" DESC);
CREATE INDEX "PaymentWebhookLog_status_idx" 
    ON "PaymentWebhookLog"("signatureValid", "processed");

-- 6. BẢO TOÀN PARTIAL INDEX PAYMENT
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_one_active_per_order" 
    ON "Payment"("orderId") 
    WHERE "status" IN ('PROCESSING', 'SUCCESS');