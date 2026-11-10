import type { Metadata } from "next";
import { ReportScreen } from "@/components/report-screen";

export const metadata: Metadata = { title: "Laporan" };

export default function LaporanPage() {
  return <ReportScreen />;
}
