import type { Metadata } from "next";
import { ReceiptDetail } from "@/components/receipt-detail";

export const metadata: Metadata = { title: "Struk" };

export default async function StrukDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReceiptDetail saleId={id} />;
}
