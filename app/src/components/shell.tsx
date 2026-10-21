"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { calcBill } from "@/lib/billing";
import { fmtDate, fmtDuration, fmtTime, initials, minutesSince, useNow, useOnline } from "@/lib/hooks";
import { formatINRShort } from "@/lib/money";
import { usePos } from "@/lib/pos-store";
import { ORDER_TYPE_LABEL } from "@/lib/types";
import { Badge, Button, Drawer, EmptyState, Icon, cx } from "./ui";

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-container to-primary text-white shadow-level2"
      style={{ width: size, height: size }}
    >
      <Icon name="receipt_long" className="icon-fill" />
    </span>
  );
}

type NavItem = { href: string; label: string; icon: string; adminOnly?: boolean };
const NAV: NavItem[] = [
  { href: "/billing/", label: "Billing", icon: "point_of_sale" },
  { href: "/tables/", label: "Tables", icon: "table_restaurant" },
  { href: "/history/", label: "History", icon: "receipt_long" },
  { href: "/dashboard/", label: "Dashboard", icon: "insights", adminOnly: true },
  { href: "/reports/", label: "Reports", icon: "analytics", adminOnly: true },
  { href: "/menu/", label: "Menu", icon: "restaurant_menu", adminOnly: true },
  { href: "/settings/", label: "Settings", icon: "tune", adminOnly: true },
];

function NavRail() {
  const pathname = usePathname();
  const router = useRouter();
  const { state, user, isAdmin, dispatch, openBills } = usePos();
  const online = useOnline();
  const occupied = new Set(openBills.map((b) => b.tableId).filter(Boolean)).size;

  return (
    <aside className="fixed left-0 top-0 z-50 flex h-full w-[84px] flex-col justify-between bg-surface-low py-3 shadow-[1px_0_8px_rgba(0,0,0,0.04)]">
      <div className="flex flex-col items-center gap-3">
        <Logo size={44} />
        <nav className="flex w-full flex-col gap-1 px-2">
          {NAV.filter((n) => !n.adminOnly || isAdmin).map((n) => {
            const active = pathname.startsWith(n.href.replace(/\/$/, ""));
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-xl transition-all",
                  active
                    ? "bg-primary-container text-on-primary-container shadow-level2"
                    : "text-ink-variant hover:bg-surface-high hover:text-ink",
                )}
              >
                <Icon name={n.icon} fill={active} className="text-[24px]" />
                <span className="text-label-sm normal-case tracking-normal">{n.label}</span>
                {n.href === "/tables/" && occupied > 0 && (
                  <span className="tnum absolute right-2 top-1.5 rounded-full bg-charcoal px-1.5 text-[10px] font-bold leading-4 text-white">
                    {occupied}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex flex-col items-center gap-2 px-2">
        <div className="w-full rounded-xl bg-surface-container px-1 py-2 text-center">
          <div className="flex items-center justify-center gap-1">
            <span className={cx("h-2 w-2 rounded-full", online ? "bg-online" : "bg-hold")} />
            <span className={cx("text-[10px] font-bold", online ? "text-tertiary" : "text-hold-ink")}>
              {online ? "ONLINE" : "OFFLINE"}
            </span>
          </div>
          <div className="mt-1 truncate text-[11px] font-semibold text-ink" title={user?.name}>
            {user?.name.split(" ")[0]}
          </div>
          <div className="mt-0.5 text-[9px] font-bold uppercase text-ink-variant">{user?.role}</div>
        </div>
        <button
          type="button"
          title="Lock / switch user"
          aria-label="Lock and switch user"
          onClick={() => {
            dispatch({ type: "logout" });
            router.push("/");
          }}
          className="flex h-11 w-full items-center justify-center rounded-xl bg-surface-high text-ink-variant transition-colors hover:bg-error-container hover:text-on-error-container"
        >
          <Icon name="lock" className="text-[20px]" />
        </button>
        <span className="sr-only">{state.profile.name}</span>
      </div>
    </aside>
  );
}

function TopBar({ onOpenHeld }: { onOpenHeld: () => void }) {
  const { state, openBills } = usePos();
  const now = useNow(15_000);
  const online = useOnline();
  const heldCount = state.held.length;

  return (
    <header className="fixed left-[84px] right-0 top-0 z-40 flex h-16 items-center justify-between bg-surface/90 px-5 shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-headline-sm">SS Bills</span>
            <span className="rounded bg-surface-highest px-1.5 py-0.5 text-label-sm">COUNTER 1</span>
          </div>
          <span className="text-body-sm text-ink-variant">{state.profile.name} · {state.profile.address.split(",").slice(-2).join(",").trim()}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="tnum flex items-center gap-2 rounded-lg bg-surface-low px-3 py-2 text-label-md">
          <Icon name="schedule" className="text-[20px] text-primary" />
          {fmtDate(now)} · {fmtTime(now)}
        </div>
        <button
          type="button"
          onClick={onOpenHeld}
          className="flex h-11 items-center gap-2 rounded-lg bg-primary-fixed px-4 text-label-lg text-on-primary-fixed shadow-level1 transition-colors hover:bg-primary-fixed-dim"
        >
          <Icon name="pause_circle" className="text-[20px]" />
          Held bills
          <span className="tnum rounded-full bg-primary px-2 py-0.5 text-label-sm text-white">{heldCount}</span>
        </button>
        <div
          className={cx(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-label-md",
            online ? "bg-surface-container text-ink-variant" : "bg-hold-surface text-hold-ink",
          )}
          title={online ? "Connected. License and summary sync will run." : "Offline. Billing works normally; sync resumes when back online."}
        >
          <span className={cx("h-2.5 w-2.5 rounded-full", online ? "bg-tertiary" : "bg-hold")} />
          {online ? "Online" : "Offline · billing works normally"}
        </div>
        <span className="sr-only">{openBills.length} open bills</span>
      </div>
    </header>
  );
}

export function HeldBillsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = usePos();
  const router = useRouter();
  const now = useNow(30_000);
  const tableLabel = (id: string | null) => state.tables.find((t) => t.id === id)?.label;

  return (
    <Drawer open={open} onClose={onClose}>
      <div className="flex items-center justify-between border-b border-line px-6 py-5">
        <div>
          <h2 className="text-headline-md">Held bills</h2>
          <p className="text-body-md text-muted">{state.held.length} open bills waiting to be settled</p>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-surface-high">
          <Icon name="close" />
        </button>
      </div>
      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto p-5">
        {state.held.length === 0 && <EmptyState icon="pause_circle" title="No held bills">Bills you hold from the billing screen appear here.</EmptyState>}
        {state.held.map((b) => {
          const t = calcBill(b.lines, state.tax);
          const mins = minutesSince(b.createdAt, now);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                dispatch({ type: "openBill", id: b.id });
                onClose();
                router.push("/billing/");
              }}
              className="flex w-full items-center gap-4 rounded-2xl border border-line bg-surface-lowest p-4 text-left shadow-level1 transition-all hover:border-primary-container hover:shadow-level2"
            >
              <span className="flex h-12 w-14 flex-col items-center justify-center rounded-xl bg-surface-container">
                {b.tableId ? (
                  <>
                    <span className="text-[9px] font-bold uppercase text-muted">Table</span>
                    <span className="text-headline-sm">{tableLabel(b.tableId)}</span>
                  </>
                ) : (
                  <Icon name={b.orderType === "delivery" ? "two_wheeler" : "takeout_dining"} className="text-[24px] text-primary" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-label-lg">{ORDER_TYPE_LABEL[b.orderType]}</span>
                <span className="block truncate text-body-sm text-muted">
                  {b.lines.map((l) => `${l.name} ×${l.qty}`).join(", ")}
                </span>
                <span className={cx("mt-1 flex items-center gap-1 text-body-sm", mins > 45 ? "text-error" : "text-muted")}>
                  <Icon name="timer" className="text-[16px]" /> {fmtDuration(mins)}
                </span>
              </span>
              <span className="tnum text-price-lg">{formatINRShort(t.total)}</span>
            </button>
          );
        })}
      </div>
      <div className="border-t border-line p-5">
        <Button
          variant="charcoal"
          className="w-full"
          icon="add"
          onClick={() => {
            dispatch({ type: "newBill" });
            onClose();
            router.push("/billing/");
          }}
        >
          New bill
        </Button>
      </div>
    </Drawer>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, saveError, dismissSaveError } = usePos();
  const router = useRouter();
  const [heldOpen, setHeldOpen] = useState(false);

  useEffect(() => {
    if (!user) router.replace("/");
  }, [user, router]);
  if (!user) return null;

  return (
    <div className="min-h-screen bg-surface">
      <NavRail />
      <TopBar onOpenHeld={() => setHeldOpen(true)} />
      {saveError && (
        <div
          role="alert"
          className="fixed left-[84px] right-0 top-16 z-[60] flex items-center justify-between gap-4 bg-error px-6 py-3 text-label-lg text-white shadow-level2"
        >
          <span className="flex items-center gap-2">
            <Icon name="error" className="icon-fill" />
            A change could not be saved to this PC: {saveError}. Check the disk has free space, then retry the action.
          </span>
          <button type="button" onClick={dismissSaveError} className="rounded-lg bg-white/20 px-3 py-1 hover:bg-white/30">
            Dismiss
          </button>
        </div>
      )}
      <main className="pl-[84px] pt-16">
        <div className="h-[calc(100vh-4rem)] overflow-hidden">{children}</div>
      </main>
      <HeldBillsDrawer open={heldOpen} onClose={() => setHeldOpen(false)} />
    </div>
  );
}

/** Scrollable page body for non-billing screens. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("scroll-thin h-full overflow-y-auto px-6 py-5", className)}>{children}</div>;
}

export function StaffAvatar({ name, size = 44, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      className={cx("flex shrink-0 items-center justify-center rounded-xl bg-primary-fixed font-bold text-primary", className)}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(name)}
    </span>
  );
}

export function RoleBadge({ role }: { role: "admin" | "cashier" }) {
  return <Badge tone={role === "admin" ? "charcoal" : "primary"}>{role}</Badge>;
}
