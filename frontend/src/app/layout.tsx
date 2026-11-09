import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const lato = localFont({
  src: [
    { path: "../../node_modules/@fontsource/lato/files/lato-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../node_modules/@fontsource/lato/files/lato-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-lato", display: "swap", fallback: ["system-ui", "sans-serif"],
});
const lora = localFont({
  src: "../../node_modules/@fontsource/lora/files/lora-latin-600-normal.woff2",
  weight: "600", style: "normal", variable: "--font-lora", display: "swap", fallback: ["Georgia", "serif"],
});

export const metadata: Metadata = {
  title: { default: "Lia POS", template: "%s | Lia POS" },
  description: "Kasir Kedai Lia 287 dan Lia Salon.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id" className={`${lato.variable} ${lora.variable}`}><body>{children}</body></html>;
}
