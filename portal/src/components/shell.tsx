"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { initials } from "@/lib/format";
import { isDemo, usePortal } from "@/lib/portal";
import { Icon, cx } from "./ui";

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl bg-charcoal text-white shadow-level2"
      style={{ width: size, height: size }}
    >
      <Icon name="receipt_long" className="icon-fill text-primary-fixed-dim" />
    </span>
  );
}

const NAV = [
  { href: "/", label: "Overview", icon: "grid_view" },
  { href: "/clients/", label: "Clients", icon: "storefront" },
  { href: "/licenses/", label: "Licenses", icon: "key" },
  { href: "/insights/", label: "Sales Insights", icon: "monitoring" },
  { href: "/activity/", label: "Activity Log", icon: "history" },
  { href: "/settings/", label: "Settings", icon: "settings" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { me, checked, signOut } = usePortal();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (checked && !me) router.replace("/login/");
  }, [checked, me, router]);

  if (!checked || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <span className="material-symbols-outlined animate-spin text-[32px] text-primary">progress_activity</span>
      </div>
    );
  }

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href.replace(/\/$/, "")));

  return (
    <div className="min-h-screen bg-surface">
      <aside className="fixed left-0 top-0 z-40 flex h-full w-[248px] flex-col bg-surface-low px-4 py-5">
        <div className="flex items-center gap-3 px-2">
          <Logo size={42} />
          <div>
            <div className="text-headline-sm leading-5">SS Bills</div>
            <div className="text-label-sm uppercase tracking-wider text-muted">Vendor Console</div>
          </div>
        </div>
        <div className="mt-8 px-3 text-label-sm uppercase tracking-wider text-muted">Platform menu</div>
        <nav className="mt-2 space-y-1">
          {NAV.map((n) => {
            const active = isActive(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex h-12 items-center gap-3 rounded-xl px-4 text-label-lg transition-colors",
                  active ? "bg-primary text-white shadow-level2" : "text-ink-variant hover:bg-surface-high hover:text-ink",
                )}
              >
                <Icon name={n.icon} fill={active} className="text-[22px]" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto rounded-xl bg-surface-container p-4 text-body-sm text-muted">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-ink">SS Bills Console</span>
            <span className={cx("rounded px-1.5 py-0.5 text-label-sm", isDemo() ? "bg-hold-surface text-hold-ink" : "bg-[#dcfce7] text-tertiary")}>
              {isDemo() ? "DEMO" : "LIVE"}
            </span>
          </div>
          <p className="mt-1">{isDemo() ? "Sample data stored in this browser only." : "Connected to your Supabase project."}</p>
        </div>
      </aside>

      <header className="fixed left-[248px] right-0 top-0 z-30 flex h-16 items-center gap-4 bg-surface/90 px-6 backdrop-blur-xl">
        <form
          className="relative max-w-xl flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/clients/?search=${encodeURIComponent(search.trim())}`);
          }}
        >
          <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[22px] text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search restaurant, city, license key…"
            aria-label="Search clients"
            className="h-11 w-full rounded-xl bg-surface-container pl-12 pr-4 text-body-md outline-none placeholder:text-muted focus:bg-surface-lowest focus:ring-2 focus:ring-primary"
          />
        </form>
        <div className="ml-auto flex items-center gap-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu((m) => !m)}
              aria-haspopup="menu"
              aria-expanded={menu}
              className="flex items-center gap-3 rounded-xl py-1 pl-3 pr-1 hover:bg-surface-container"
            >
              <span className="text-right">
                <span className="block text-label-lg leading-4">{me.name}</span>
                <span className="block text-body-sm text-muted">{me.role === "super_admin" ? "Super Admin" : "Support"}</span>
              </span>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-label-lg text-white">{initials(me.name)}</span>
            </button>
            {menu && (
              <div role="menu" className="absolute right-0 top-14 w-48 rounded-xl border border-line bg-surface-lowest p-1 shadow-level3">
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    setMenu(false);
                    await signOut();
                    router.replace("/login/");
                  }}
                  className="flex h-11 w-full items-center gap-2 rounded-lg px-3 text-label-lg hover:bg-surface-container"
                >
                  <Icon name="logout" className="text-[20px]" /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="pl-[248px] pt-16">
        <div className="scroll-thin min-h-[calc(100vh-4rem)] px-6 pb-10 pt-4">{children}</div>
      </main>
    </div>
  );
}
