import type { Metadata } from "next";
import { CheckoutScreen } from "@/components/checkout-screen";

export const metadata: Metadata = { title: "Kasir" };

export default function KasirPage() {
  return <CheckoutScreen />;
}
