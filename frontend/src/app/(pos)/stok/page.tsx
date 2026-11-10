import type { Metadata } from "next";
import { StockScreen } from "@/components/stock-screen";

export const metadata: Metadata = { title: "Stok" };

export default function StokPage() {
  return <StockScreen />;
}
