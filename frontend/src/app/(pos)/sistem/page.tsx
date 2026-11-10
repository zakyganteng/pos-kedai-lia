import type { Metadata } from "next";
import { SystemScreen } from "@/components/system-screen";

export const metadata: Metadata = { title: "Sistem" };

export default function SistemPage() {
  return <SystemScreen />;
}
