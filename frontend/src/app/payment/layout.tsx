import type { ReactNode } from "react";
import { CustomerGate } from "@/components/auth/customer-gate";

export default function PaymentLayout({ children }: { children: ReactNode }) {
  return <CustomerGate>{children}</CustomerGate>;
}
