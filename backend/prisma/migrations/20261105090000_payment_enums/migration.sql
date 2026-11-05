-- Forward-only compatibility for both the five-migration baseline and the
-- inspected database with two historical, locally missing payment migrations.
-- Separate commit: PostgreSQL cannot use a new enum label in its adding transaction.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'VNPAY';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'POINTS';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'NEEDS_REFUND';

DO $$ BEGIN
  IF to_regtype('"LoyaltyTransactionType"') IS NULL THEN
    CREATE TYPE "LoyaltyTransactionType" AS ENUM ('EARN','REDEEM','REFUND','ADJUSTMENT','REVOKE');
  END IF;
  IF to_regtype('"RefundStatus"') IS NULL THEN
    CREATE TYPE "RefundStatus" AS ENUM ('PENDING','PROCESSING','SUCCESS','FAILED');
  END IF;
END $$;
ALTER TYPE "LoyaltyTransactionType" ADD VALUE IF NOT EXISTS 'REVOKE';

CREATE TYPE "PaymentEventSource" AS ENUM ('CREATE','IPN','RETURN','QUERY','REFUND');
CREATE TYPE "PaymentEventResult" AS ENUM ('RECEIVED','ACCEPTED','REJECTED','ERROR','DUPLICATE');
