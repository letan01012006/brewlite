export type Role = "CUSTOMER" | "BARISTA";

export interface User {
  id: number;
  email: string;
  fullName: string;
  role: Role;
  loyaltyPoints: number;
  createdAt?: string;
}

export type Size = "S" | "M" | "L";

export interface Topping {
  id: number;
  name: string;
  price: number;
  isActive?: boolean;
}

export interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
  stock: number;
  inStock?: boolean;
  imageUrl?: string | null;
  description?: string | null;
  availableSizes?: Size[];
  activeToppings?: Topping[];
  sizes?: Array<{ size: Size; surcharge: number }>;
  toppings?: Topping[];
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

export type PaymentMethod = "WALLET" | "CARD";
export type PaymentStatus = "PROCESSING" | "SUCCESS" | "FAILED";

export interface Payment {
  id: number;
  orderId: number;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  providerRef?: string | null;
  failureReason?: string | null;
  refundedAt?: string | null;
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
