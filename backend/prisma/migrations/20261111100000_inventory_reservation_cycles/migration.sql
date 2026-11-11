-- Keep one reservation per order while preserving each retry's stock movements.
-- Existing movements remain cycle zero; their rows and event keys are preserved.
ALTER TABLE "InventoryMovement" ADD COLUMN "reservationVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_reservation_version_check"
  CHECK ("reservationVersion" >= 0);
DROP INDEX "InventoryMovement_reservationId_ingredientId_kind_key";
CREATE UNIQUE INDEX "InventoryMovement_reservation_cycle_key"
  ON "InventoryMovement" ("reservationId", "ingredientId", "kind", "reservationVersion");
