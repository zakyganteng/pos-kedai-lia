import type { Metadata } from "next";
import { UserScreen } from "@/components/user-screen";

export const metadata: Metadata = { title: "Pengguna" };

export default function PenggunaPage() {
  return <UserScreen />;
}
