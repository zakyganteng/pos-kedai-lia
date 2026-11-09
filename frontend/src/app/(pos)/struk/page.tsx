import type { Metadata } from "next";
import { ReceiptList } from "@/components/receipt-list";

export const metadata: Metadata = { title: "Struk" };

export default function StrukPage() {
  return <ReceiptList />;
}
