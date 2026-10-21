import type { Metadata } from "next";
// Fonts and icons are bundled locally so the app works fully offline.
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";
import { PosProvider } from "@/lib/pos-store";

export const metadata: Metadata = {
  title: "SS Bills",
  description: "Offline-first restaurant billing",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full select-none antialiased">
        <PosProvider>{children}</PosProvider>
      </body>
    </html>
  );
}
