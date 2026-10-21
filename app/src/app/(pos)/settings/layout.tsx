"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AdminOnly, Card, Icon, cx } from "@/components/ui";
import { usePos } from "@/lib/pos-store";

const SECTIONS = [
  { href: "/settings/", label: "Restaurant profile", icon: "storefront" },
  { href: "/settings/tax/", label: "GST & tax", icon: "account_balance" },
  { href: "/settings/tables/", label: "Tables", icon: "table_restaurant" },
  { href: "/settings/receipt/", label: "Receipt", icon: "receipt" },
  { href: "/settings/printing/", label: "Printing", icon: "print" },
  { href: "/settings/staff/", label: "Staff & roles", icon: "badge" },
  { href: "/settings/backup/", label: "Backup & restore", icon: "settings_backup_restore" },
  { href: "/settings/license/", label: "License & sync", icon: "verified_user" },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const { isAdmin, state } = usePos();
  const pathname = usePathname();
  if (!isAdmin) return <AdminOnly />;

  return (
    <div className="grid h-full grid-cols-[280px_1fr] gap-4 p-4">
      <div className="space-y-3">
        <Card className="p-3">
          <div className="px-3 pb-2 pt-1 text-label-sm uppercase text-muted">Settings</div>
          <nav className="space-y-1">
            {SECTIONS.map((s) => {
              const active = s.href === "/settings/" ? pathname === "/settings/" || pathname === "/settings" : pathname.startsWith(s.href.slice(0, -1));
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex h-12 items-center gap-3 rounded-xl px-3 text-label-lg transition-colors",
                    active ? "bg-primary-fixed text-on-primary-fixed" : "text-ink-variant hover:bg-surface-low hover:text-ink",
                  )}
                >
                  <Icon name={s.icon} fill={active} className={cx("text-[22px]", active && "text-primary")} />
                  <span className="flex-1">{s.label}</span>
                  {active && <Icon name="chevron_right" className="text-[18px] text-primary" />}
                </Link>
              );
            })}
          </nav>
        </Card>
        <Card className="p-4 text-body-sm text-muted">
          <div className="flex items-center gap-2 text-label-md text-ink">
            <Icon name="database" className="text-[18px] text-primary" /> Local data
          </div>
          <p className="mt-1">
            All bills for {state.profile.name} are stored on this PC. Only daily sales summaries are sent to SS Bills.
          </p>
        </Card>
      </div>
      <div className="scroll-thin min-h-0 overflow-y-auto pr-1">{children}</div>
    </div>
  );
}
