import type { Metadata } from "next";
import { KatalogScreen } from "@/components/katalog-screen";

export const metadata: Metadata = { title: "Katalog" };

export default function KatalogPage() {
  return <KatalogScreen />;
}
