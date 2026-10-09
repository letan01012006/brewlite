-- BrewLite: ràng buộc ở tầng database (Prisma không mô tả được CHECK và partial index).
-- Dán toàn bộ nội dung này vào file migration.sql của migration "add_check_constraints".

-- Product
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_nonnegative"
  CHECK ("price" >= 0 AND "stock" >= 0 AND "version" >= 0);

-- Topping
ALTER TABLE "Topping"
  ADD CONSTRAINT "Topping_price_nonnegative"
  CHECK ("price" >= 0);

-- User
ALTER TABLE "User"
  ADD CONSTRAINT "User_points_nonnegative"
  CHECK ("loyaltyPoints" >= 0);

-- Order
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_valid_amounts"
  CHECK (
    "subtotal" >= 0
    AND "discountAmount" >= 0
    AND "discountAmount" <= "subtotal"
    AND "total" = "subtotal" - "discountAmount"
    AND "pointsEarned" >= 0
  );

-- OrderItem
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_valid_amounts"
  CHECK (
    "qty" BETWEEN 1 AND 20
    AND "unitPrice" >= 0
    AND "lineTotal" = "unitPrice" * "qty"
  );

-- Payment
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_valid_amounts"
  CHECK (
    "amount" >= 0
    AND "refundedAmount" >= 0
    AND "refundedAmount" <= "amount"
  );

-- PromoCode
ALTER TABLE "PromoCode"
  ADD CONSTRAINT "PromoCode_valid_rules"
  CHECK (
    "value" > 0
    AND ("type" <> 'PERCENT' OR "value" <= 100)
    AND "minOrderValue" >= 0
    AND ("maxDiscount" IS NULL OR "maxDiscount" >= 0)
    AND "expiresAt" > "startsAt"
    AND "usedCount" >= 0
    AND ("usageLimit" IS NULL OR ("usageLimit" >= 0 AND "usedCount" <= "usageLimit"))
  );

-- LoyaltyTransaction
ALTER TABLE "LoyaltyTransaction"
  ADD CONSTRAINT "LoyaltyTransaction_points_nonnegative"
  CHECK ("points" >= 0);

-- Mỗi đơn chỉ có tối đa 1 Payment đang xử lý hoặc đã thành công.
-- Cho phép nhiều lần FAILED để khách thử lại. Đây là lớp bảo vệ bổ sung,
-- không thay thế việc khóa dòng Order trong service.
CREATE UNIQUE INDEX "Payment_one_active_per_order"
  ON "Payment" ("orderId")
  WHERE "status" IN ('PROCESSING', 'SUCCESS');
