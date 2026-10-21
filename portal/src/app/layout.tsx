import type { Metadata } from "next";
// Fonts and icons are bundled locally (no external requests).
import "@fontsource-variable/plus-jakarta-sans";
import "material-symbols/outlined.css";
import "./globals.css";
import { PortalProvider } from "@/lib/portal";

export const metadata: Metadata = {
  title: "SS Bills Console",
  description: "Vendor console for SS Bills licenses and clients",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full antialiased">
        <PortalProvider>{children}</PortalProvider>
      </body>
    </html>
  );
}
