import type { ReactNode } from "react";
import { AppShell } from "@/components/shell";

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
