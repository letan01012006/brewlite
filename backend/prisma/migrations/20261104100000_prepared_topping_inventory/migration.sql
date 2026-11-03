-- Legacy toppings remain unconfigured. No stock or business data is rewritten.
ALTER TABLE "Topping"
    ADD COLUMN "ingredientId" INTEGER,
    ADD COLUMN "quantityPerServing" DECIMAL(18,3);

CREATE INDEX "Topping_ingredientId_idx" ON "Topping"("ingredientId");

ALTER TABLE "Topping" ADD CONSTRAINT "Topping_ingredientId_fkey"
    FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Pair NULLs explicitly: SQL CHECK otherwise accepts UNKNOWN for a missing value.
ALTER TABLE "Topping" ADD CONSTRAINT "Topping_valid_serving"
    CHECK (
        ("ingredientId" IS NULL AND "quantityPerServing" IS NULL)
        OR
        ("ingredientId" IS NOT NULL AND "quantityPerServing" IS NOT NULL
         AND "quantityPerServing" > 0
         AND "quantityPerServing" <> 'NaN'::numeric)
    );
