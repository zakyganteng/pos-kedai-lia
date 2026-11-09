import type { ReactNode } from "react";
import { SessionProvider } from "@/components/session-provider";

export default function PosLayout({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
