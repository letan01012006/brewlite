-- Add only the implicit many-to-many relation. Existing products, stocks,
-- versions, users, orders and JSON order snapshots are untouched.
CREATE TABLE "_ProductToTopping" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,
    CONSTRAINT "_ProductToTopping_AB_pkey" PRIMARY KEY ("A", "B")
);

CREATE INDEX "_ProductToTopping_B_index" ON "_ProductToTopping"("B");
ALTER TABLE "_ProductToTopping" ADD CONSTRAINT "_ProductToTopping_A_fkey"
  FOREIGN KEY ("A") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ProductToTopping" ADD CONSTRAINT "_ProductToTopping_B_fkey"
  FOREIGN KEY ("B") REFERENCES "Topping"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One-time demo backfill, tracked by Prisma migration history, not by every seed.
-- Resolve IDs by unique names, preserving all existing topping attributes.
INSERT INTO "Topping" ("name", "price") VALUES
  ('Trân châu', 5000), ('Kem cheese', 7000), ('Thạch', 4000)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "_ProductToTopping" ("A", "B")
SELECT p."id", t."id"
FROM (VALUES
  ('Cà phê sữa', 'Kem cheese'), ('Cà phê sữa', 'Thạch'),
  ('Bạc xỉu', 'Kem cheese'), ('Bạc xỉu', 'Thạch'),
  ('Cà phê muối', 'Kem cheese'), ('Cà phê muối', 'Thạch'),
  ('Trà đào', 'Thạch'), ('Trà vải', 'Thạch'),
  ('Trà sữa trân châu', 'Trân châu'), ('Trà sữa trân châu', 'Kem cheese'),
  ('Trà sữa trân châu', 'Thạch'),
  ('Matcha đá xay', 'Trân châu'), ('Matcha đá xay', 'Kem cheese')
) AS demo(product_name, topping_name)
JOIN "Product" p ON p."name" = demo.product_name
JOIN "Topping" t ON t."name" = demo.topping_name
ON CONFLICT ("A", "B") DO NOTHING;

-- Americano, Cappuccino and Latte intentionally have no demo relations.
