/*
  Warnings:

  - A unique constraint covering the columns `[gatewayTxnRef]` on the table `Payment` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "LoyaltyTransaction_userId_createdAt_idx";

-- DropIndex
DROP INDEX "LoyaltyTransaction_userId_idx";

-- DropIndex
DROP INDEX "PaymentWebhookLog_gatewayTxnRef_createdAt_idx";

-- AlterTable
ALTER TABLE "PaymentRefund" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_userId_createdAt_idx" ON "LoyaltyTransaction"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_gatewayTxnRef_key" ON "Payment"("gatewayTxnRef");

-- CreateIndex
CREATE INDEX "Payment_gatewayTxnRef_idx" ON "Payment"("gatewayTxnRef");

-- CreateIndex
CREATE INDEX "PaymentWebhookLog_gatewayTxnRef_createdAt_idx" ON "PaymentWebhookLog"("gatewayTxnRef", "createdAt");

-- RenameIndex
ALTER INDEX "PaymentWebhookLog_status_idx" RENAME TO "PaymentWebhookLog_signatureValid_processed_idx";
