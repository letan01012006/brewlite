-- Some existing databases still enforce the retired 100-points conversion.
-- Keep historical points/amount snapshots unchanged. Current redemption steps
-- and conversion are validated by PaymentsService before the transaction writes.
-- Replace only this CHECK, atomically, without rewriting migration history.
ALTER TABLE "Payment"
  DROP CONSTRAINT IF EXISTS "Payment_points_valid_amounts",
  ADD CONSTRAINT "Payment_points_valid_amounts" CHECK (
    "pointsUsed" >= 0 AND "pointsAmount" >= 0
    AND (
      ("method" = 'POINTS' AND "pointsUsed" > 0 AND "pointsAmount" > 0)
      OR ("method" = 'VNPAY' AND "amount" >= 5000 AND (
        ("pointsUsed" = 0 AND "pointsAmount" = 0)
        OR ("pointsUsed" > 0 AND "pointsAmount" > 0)
      ))
      OR ("method" IN ('WALLET', 'CARD') AND "pointsUsed" = 0 AND "pointsAmount" = 0)
    )
  );
