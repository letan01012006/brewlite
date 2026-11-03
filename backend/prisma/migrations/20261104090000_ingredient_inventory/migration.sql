-- CreateEnum
CREATE TYPE "IngredientUnit" AS ENUM ('GRAM', 'MILLILITRE', 'PIECE');

-- CreateEnum
CREATE TYPE "InventoryReservationStatus" AS ENUM ('HELD', 'CONSUMED', 'RELEASED');

-- CreateEnum
CREATE TYPE "InventoryMovementKind" AS ENUM ('RECEIPT', 'ADJUSTMENT', 'HOLD', 'RELEASE', 'CONSUME');

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "recipeSnapshot" JSONB;

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "IngredientUnit" NOT NULL,
    "stockQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "reservedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductRecipe" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "size" "Size" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductRecipeIngredient" (
    "id" SERIAL NOT NULL,
    "recipeId" INTEGER NOT NULL,
    "ingredientId" INTEGER NOT NULL,
    "unit" "IngredientUnit" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "ProductRecipeIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryReservation" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "eventKey" TEXT NOT NULL,
    "status" "InventoryReservationStatus" NOT NULL DEFAULT 'HELD',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,

    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryReservationItem" (
    "id" SERIAL NOT NULL,
    "reservationId" INTEGER NOT NULL,
    "ingredientId" INTEGER NOT NULL,
    "unit" "IngredientUnit" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "InventoryReservationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" SERIAL NOT NULL,
    "eventKey" TEXT NOT NULL,
    "kind" "InventoryMovementKind" NOT NULL,
    "ingredientId" INTEGER NOT NULL,
    "unit" "IngredientUnit" NOT NULL,
    "stockDelta" DECIMAL(18,3) NOT NULL,
    "reservedDelta" DECIMAL(18,3) NOT NULL,
    "reservationId" INTEGER,
    "orderId" INTEGER,
    "actorId" INTEGER,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_code_key" ON "Ingredient"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_name_key" ON "Ingredient"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_id_unit_key" ON "Ingredient"("id", "unit");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRecipe_productId_size_key" ON "ProductRecipe"("productId", "size");

-- CreateIndex
CREATE INDEX "ProductRecipeIngredient_ingredientId_unit_idx" ON "ProductRecipeIngredient"("ingredientId", "unit");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRecipeIngredient_recipeId_ingredientId_key" ON "ProductRecipeIngredient"("recipeId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryReservation_orderId_key" ON "InventoryReservation"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryReservation_eventKey_key" ON "InventoryReservation"("eventKey");

-- CreateIndex
CREATE INDEX "InventoryReservation_status_expiresAt_idx" ON "InventoryReservation"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryReservation_id_orderId_key" ON "InventoryReservation"("id", "orderId");

-- CreateIndex
CREATE INDEX "InventoryReservationItem_ingredientId_unit_idx" ON "InventoryReservationItem"("ingredientId", "unit");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryReservationItem_reservationId_ingredientId_key" ON "InventoryReservationItem"("reservationId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryReservationItem_reservationId_ingredientId_unit_key" ON "InventoryReservationItem"("reservationId", "ingredientId", "unit");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_eventKey_key" ON "InventoryMovement"("eventKey");

-- CreateIndex
CREATE INDEX "InventoryMovement_ingredientId_createdAt_idx" ON "InventoryMovement"("ingredientId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_orderId_createdAt_idx" ON "InventoryMovement"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_actorId_idx" ON "InventoryMovement"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_reservationId_ingredientId_kind_key" ON "InventoryMovement"("reservationId", "ingredientId", "kind");

-- AddForeignKey
ALTER TABLE "ProductRecipe" ADD CONSTRAINT "ProductRecipe_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRecipeIngredient" ADD CONSTRAINT "ProductRecipeIngredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "ProductRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRecipeIngredient" ADD CONSTRAINT "ProductRecipeIngredient_ingredientId_unit_fkey" FOREIGN KEY ("ingredientId", "unit") REFERENCES "Ingredient"("id", "unit") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InventoryReservationItem" ADD CONSTRAINT "InventoryReservationItem_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "InventoryReservation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InventoryReservationItem" ADD CONSTRAINT "InventoryReservationItem_ingredientId_unit_fkey" FOREIGN KEY ("ingredientId", "unit") REFERENCES "Ingredient"("id", "unit") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_ingredientId_unit_fkey" FOREIGN KEY ("ingredientId", "unit") REFERENCES "Ingredient"("id", "unit") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_reservationId_orderId_fkey" FOREIGN KEY ("reservationId", "orderId") REFERENCES "InventoryReservation"("id", "orderId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_reservationId_ingredientId_unit_fkey" FOREIGN KEY ("reservationId", "ingredientId", "unit") REFERENCES "InventoryReservationItem"("reservationId", "ingredientId", "unit") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Prisma does not express these CHECKs. They validate stored values only.
-- no trigger, reservation, movement or order transition is executed automatically.
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_valid_stock" CHECK (
  btrim("code") <> '' AND btrim("name") <> '' AND "version" >= 0
  AND "stockQuantity" <> 'NaN'::numeric AND "reservedQuantity" <> 'NaN'::numeric
  AND "stockQuantity" >= 0 AND "reservedQuantity" >= 0
  AND "reservedQuantity" <= "stockQuantity"
  AND ("unit" <> 'PIECE' OR (
    "stockQuantity" = trunc("stockQuantity")
    AND "reservedQuantity" = trunc("reservedQuantity")
  ))
);

ALTER TABLE "ProductRecipe" ADD CONSTRAINT "ProductRecipe_valid_version" CHECK ("version" >= 0);

ALTER TABLE "ProductRecipeIngredient" ADD CONSTRAINT "ProductRecipeIngredient_valid_quantity" CHECK (
  "quantity" <> 'NaN'::numeric AND "quantity" > 0
  AND ("unit" <> 'PIECE' OR "quantity" = trunc("quantity"))
);
ALTER TABLE "InventoryReservationItem" ADD CONSTRAINT "InventoryReservationItem_valid_quantity" CHECK (
  "quantity" <> 'NaN'::numeric AND "quantity" > 0
  AND ("unit" <> 'PIECE' OR "quantity" = trunc("quantity"))
);

ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_valid_lifecycle" CHECK (
  btrim("eventKey") <> '' AND "version" >= 0
  AND ("expiresAt" IS NULL OR "expiresAt" > "createdAt")
  AND (
    ("status" = 'HELD' AND "consumedAt" IS NULL AND "releasedAt" IS NULL)
    OR ("status" = 'CONSUMED' AND "consumedAt" IS NOT NULL
      AND "consumedAt" >= "createdAt" AND "releasedAt" IS NULL)
    OR ("status" = 'RELEASED' AND "releasedAt" IS NOT NULL
      AND "releasedAt" >= "createdAt" AND "consumedAt" IS NULL)
  )
);

ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_valid_deltas" CHECK (
  btrim("eventKey") <> ''
  AND "stockDelta" <> 'NaN'::numeric AND "reservedDelta" <> 'NaN'::numeric
  AND ("unit" <> 'PIECE' OR (
    "stockDelta" = trunc("stockDelta") AND "reservedDelta" = trunc("reservedDelta")
  ))
  AND (
    ("kind" = 'RECEIPT' AND "stockDelta" > 0 AND "reservedDelta" = 0 AND "reservationId" IS NULL)
    OR ("kind" = 'ADJUSTMENT' AND "stockDelta" <> 0 AND "reservedDelta" = 0 AND "reservationId" IS NULL)
    OR ("kind" = 'HOLD' AND "stockDelta" = 0 AND "reservedDelta" > 0 AND "reservationId" IS NOT NULL AND "orderId" IS NOT NULL)
    OR ("kind" = 'RELEASE' AND "stockDelta" = 0 AND "reservedDelta" < 0 AND "reservationId" IS NOT NULL AND "orderId" IS NOT NULL)
    OR ("kind" = 'CONSUME' AND "stockDelta" < 0 AND "reservedDelta" = "stockDelta" AND "reservationId" IS NOT NULL AND "orderId" IS NOT NULL)
  )
);

