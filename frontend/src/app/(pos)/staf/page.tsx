import type { Metadata } from "next";
import { StaffScreen } from "@/components/staff-screen";

export const metadata: Metadata = { title: "Staf" };

export default function StafPage() {
  return <StaffScreen />;
}
