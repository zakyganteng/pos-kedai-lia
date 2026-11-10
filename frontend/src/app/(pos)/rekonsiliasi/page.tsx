import type { Metadata } from "next";
import { ReconciliationScreen } from "@/components/reconciliation-screen";

export const metadata: Metadata = { title: "Rekonsiliasi" };

export default function RekonsiliasiPage() {
  return <ReconciliationScreen />;
}
