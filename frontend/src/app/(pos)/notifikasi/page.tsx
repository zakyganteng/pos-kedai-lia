import type { Metadata } from "next";
import { NotificationScreen } from "@/components/notification-screen";

export const metadata: Metadata = { title: "Notifikasi" };

export default function NotifikasiPage() {
  return <NotificationScreen />;
}
