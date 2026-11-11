export type Role = "CUSTOMER" | "BARISTA" | "MANAGER";

export interface User {
  id: number;
  email: string | null;
  phone?: string | null;
  isPhoneVerified?: boolean;
  fullName: string;
  role: Role;
  loyaltyPoints: number;
  createdAt?: string;
}

export type Size = "S" | "M" | "L";

export type RecipeUnavailableReason =
  | 'RECIPE_UNAVAILABLE'
  | 'INSUFFICIENT_INGREDIENTS'
  | 'INGREDIENT_PAUSED';

export interface Topping {
  id: number;
  name: string;
  price: number;
  isActive?: boolean;
  ingredientId?: number | null;
  quantityPerServing?: string | null;
  ingredient?: {
    id: number;
    name: string;
    isActive: boolean;
  } | null;
}

export interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
  stock: number;
  isActive?: boolean;
  inventoryMode?: 'INGREDIENT';
  availability?: Array<{
    size: Size;
    maxQuantity: number;
    reason: RecipeUnavailableReason | null;
  }>;
  inStock?: boolean;
  imageUrl?: string | null;
  description?: string | null;
  // Optional for catalog rows / carts persisted before the detail API existed.
  sizes?: Array<{ size: Size; surcharge: number }>;
  toppings?: Topping[];
}

export interface ProductDetail extends Product {
  sizes: Array<{ size: Size; surcharge: number }>;
  toppings: Topping[];
}

export interface InventoryAvailability {
  available: boolean;
  shortages: Array<{ ingredientId: number; unit: string; quantity: string; availableQuantity: string }>;
  lines: Array<{ index: number; productId: number; size: Size; maxQuantity: number }>;
}

export interface CartItem {
  id: string; // unique item id trong giỏ (kết hợp productId + size + toppings)
  product: Product;
  size: Size;
  quantity: number;
  selectedToppings: Topping[];
  note?: string;
  unitPrice: number;
  lineTotal: number;
}

export type OrderStatus =
  | "PENDING"
  | "PAID"
  | "PREPARING"
  | "READY"
  | "COMPLETED"
  | "CANCELLED"
  | "PAYMENT_FAILED";

export interface OrderItem {
  id: number;
  productId: number;
  productName: string;
  size: Size;
  toppings: Array<{ id: number; name: string; price: number }>;
  unitPrice: number;
  qty: number;
  lineTotal: number;
  note?: string | null;
}

export type PaymentMethod = "WALLET" | "CARD" | "VNPAY" | "POINTS";
export type PaymentStatus =
  | "PROCESSING"
  | "SUCCESS"
  | "FAILED"
  | "EXPIRED"
  | "CANCELLED"
  | "NEEDS_REFUND";

export interface Payment {
  id: number;
  orderId: number;
  amount: number;
  pointsUsed?: number;
  pointsAmount?: number;
  method: PaymentMethod;
  status: PaymentStatus;
  providerRef?: string | null;
  gatewayTxnRef?: string | null;
  paymentUrl?: string | null;
  expiresAt?: string | null;
  bankCode?: string | null;
  cardType?: string | null;
  payDate?: string | null;
  failureReason?: string | null;
  refundedAmount?: number | null;
  refundRef?: string | null;
  refundReason?: string | null;
  refundedAt?: string | null;
  refunds?: {
    status: "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED";
    confirmedAt?: string | null;
  }[];
  createdAt: string;
}

export interface Order {
  id: number;
  code: string;
  status: OrderStatus;
  subtotal: number;
  discountAmount: number;
  total: number;
  promoCode?: string | null;
  pointsEarned: number;
  items: OrderItem[];
  payments?: Payment[];
  createdAt: string;
  updatedAt?: string;
}

export interface ValidatePromotionResult {
  code: string;
  type: "PERCENT" | "FIXED";
  value: number;
  subtotal: number;
  discountAmount: number;
  totalAfterDiscount: number;
}

export interface ApiPaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: ApiPaginationMeta;
}

// ===== Nguyên liệu & Kho (barista) =====
export type IngredientUnit = 'GRAM' | 'MILLILITRE' | 'PIECE';
export interface Ingredient {
  id: number;
  code: string;
  name: string;
  unit: IngredientUnit;
  stockQuantity: string;
  reservedQuantity: string;
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface StockRow extends Ingredient {
  availableQuantity: string;
}
export type MovementKindFilter =
  | InventoryMovement['kind']
  | 'ADJUSTMENT_POSITIVE'
  | 'ADJUSTMENT_NEGATIVE';
export interface InventoryMovement {
  id: number;
  kind: 'RECEIPT' | 'ADJUSTMENT' | 'HOLD' | 'RELEASE' | 'CONSUME';
  ingredientId: number;
  unit: IngredientUnit;
  stockDelta: string;
  reservedDelta: string;
  orderId?: number | null;
  actorId?: number | null;
  reason: string | null;
  createdAt: string;
  ingredient?: {
    code: string;
    name: string;
    toppings?: Array<{ id: number; name: string }>;
  };
  actor?: {
    id: number;
    fullName: string;
    email: string | null;
  } | null;
}
export interface ProductRecipeIngredient {
  id?: number;
  recipeId?: number;
  ingredientId: number;
  unit: IngredientUnit;
  quantity: string;
}
export interface ProductRecipe {
  id: number;
  productId: number;
  size: Size;
  version: number;
  isActive: boolean;
  ingredients: ProductRecipeIngredient[];
}
export interface ToppingRecipe {
  id: number;
  ingredientId: number | null;
  quantityPerServing: string | null;
}
export interface PreparedTopping extends Topping {
  ingredientId: number | null;
  quantityPerServing: string | null;
}
