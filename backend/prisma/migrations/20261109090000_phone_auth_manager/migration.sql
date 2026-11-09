-- Additive migration: preserve all existing identities, hashes, balances and relations.
ALTER TYPE "Role" ADD VALUE 'MANAGER';
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "isPhoneVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "welcomePointsGrantedAt" TIMESTAMP(3),
  ADD COLUMN "otpHash" TEXT,
  ADD COLUMN "otpExpiresAt" TIMESTAMP(3),
  ADD COLUMN "otpSentAt" TIMESTAMP(3),
  ADD COLUMN "otpAttempts" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
ALTER TABLE "User" ADD CONSTRAINT "User_phone_format" CHECK ("phone" IS NULL OR "phone" ~ '^0[0-9]{9}$');
ALTER TABLE "User" ADD CONSTRAINT "User_otp_attempts" CHECK ("otpAttempts" BETWEEN 0 AND 5);
