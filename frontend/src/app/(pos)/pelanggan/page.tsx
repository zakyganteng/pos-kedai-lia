import type { Metadata } from "next";
import { CustomerScreen } from "@/components/customer-screen";

export const metadata: Metadata = { title: "Pelanggan" };

export default function PelangganPage() {
  return <CustomerScreen />;
}
