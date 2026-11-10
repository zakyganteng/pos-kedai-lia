import type { Metadata } from "next";
import { QueueScreen } from "@/components/queue-screen";

export const metadata: Metadata = { title: "Antrean" };

export default function AntreanPage() {
  return <QueueScreen />;
}
