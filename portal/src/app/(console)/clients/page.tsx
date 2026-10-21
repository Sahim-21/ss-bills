"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Async, Avatar, PlanBadge, StateBadge } from "@/components/console-ui";
import { Badge, Button, Card, Chip, EmptyState, Icon, PageHeader, SearchInput, cx } from "@/components/ui";
import { downloadCsv } from "@/lib/csv";
import { ago, daysLabel, fmtDate, STATE_LABEL } from "@/lib/format";
import { useAsync, useDebounced, useNowMs } from "@/lib/hooks";
import { formatINRShort } from "@/lib/money";
import { useApi, usePortal } from "@/lib/portal";
import type { ClientFilter } from "@/lib/types";

const PAGE = 10;
type Status = NonNullable<ClientFilter["status"]>;
const STATUSES: Status[] = ["all", "active", "expiring", "suspended", "offline"];
const STATUS_LABEL: Record<Status, string> = {
  all: "All",
  active: "Active",
  expiring: "Expiring soon",
  suspended: "Suspended",
  offline: "Offline > 7d",
};

function Clients() {
  const api = useApi();
  const { me } = usePortal();
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get("status") as Status | null;
  const [status, setStatus] = useState<Status>(initial && STATUSES.includes(initial) ? initial : "all");
  const [plan, setPlan] = useState("");
  const [city, setCity] = useState("");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [page, setPage] = useState(0);
  const debounced = useDebounced(search);
  const now = useNowMs();

  const { data, error, loading, reload } = useAsync(
    () => api.clients({ status, plan: plan || undefined, city: city || undefined, search: debounced, limit: PAGE, offset: page * PAGE }),
    [api, status, plan, city, debounced, page],
  );
  const { data: plans } = useAsync(() => api.plans(), [api]);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const filtering = (fn: () => void) => () => {
    fn();
    setPage(0);
  };

  async function exportCsv() {
    const rows: (string | number)[][] = [
      ["Code", "Restaurant", "City", "Owner", "Phone", "Email", "Plan", "Status", "Expires", "Terminals", "Last check-in", "Sales today (INR)", "Bills today"],
    ];
    for (let off = 0; ; off += 100) {
      const r = await api.clients({ status, plan: plan || undefined, city: city || undefined, search: debounced, limit: 100, offset: off });
      for (const c of r.rows) {
        rows.push([
          c.code, c.name, c.city, c.owner_name, c.phone, c.email, c.plan_name, STATE_LABEL[c.state],
          c.expires_at ? c.expires_at.slice(0, 10) : "Lifetime", `${c.devices_used}/${c.max_devices}`,
          c.last_check_in_at ?? "Never", c.today_sales_paise / 100, c.today_bills,
        ]);
      }
      if (off + 100 >= r.total) break;
    }
    downloadCsv(`ss-bills-clients-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  }

  const counts = data?.counts;
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Client fleet"
        title="Client management"
        subtitle={counts ? `${counts.all} restaurant${counts.all === 1 ? "" : "s"} · ${counts.active} active · ${counts.expiring} need renewal` : "Loading…"}
        actions={
          <>
            <Button variant="secondary" icon="download" onClick={exportCsv}>
              Export CSV
            </Button>
            {me?.role === "super_admin" && (
              <Link href="/clients/new/">
                <Button variant="primary" icon="add">
                  Add client
                </Button>
              </Link>
            )}
          </>
        }
      />

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {STATUSES.map((s) => (
            <Chip key={s} active={status === s} count={counts?.[s === "all" ? "all" : s]} onClick={filtering(() => setStatus(s))}>
              {STATUS_LABEL[s]}
            </Chip>
          ))}
          <span className="mx-1 h-6 w-px bg-line" />
          <Chip active={plan === ""} onClick={filtering(() => setPlan(""))}>
            All plans
          </Chip>
          {(plans ?? []).map((p) => (
            <Chip key={p.id} active={plan === p.id} onClick={filtering(() => setPlan(p.id))}>
              {p.name.replace(/ (Standard|Pro|POS)$/, "")}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            className="w-[320px]"
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(0);
            }}
            placeholder="Name, city, owner, license key…"
          />
          <span className="ml-2 text-label-md uppercase tracking-wider text-muted">Cities</span>
          <Chip active={city === ""} onClick={filtering(() => setCity(""))}>
            Everywhere
          </Chip>
          {(data?.cities ?? []).map((c) => (
            <Chip key={c.city} active={city === c.city} count={c.n} onClick={filtering(() => setCity(c.city))}>
              {c.city}
            </Chip>
          ))}
        </div>
      </Card>

      <Async error={error} loading={loading} hasData={!!data} onRetry={reload}>
        <Card className={cx("overflow-hidden transition-opacity", loading && "opacity-60")}>
          {data && data.rows.length === 0 ? (
            <EmptyState icon="storefront" title="No clients match">
              Try a different filter or search.
            </EmptyState>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-surface-low text-label-md uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-3">Restaurant</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">License</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Last check-in</th>
                  <th className="px-4 py-3 text-right">Sales today</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-low">
                {data?.rows.map((c) => (
                  <tr key={c.id} onClick={() => router.push(`/clients/view/?id=${c.id}`)} className="cursor-pointer align-middle transition-colors hover:bg-surface-low">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={c.name} />
                        <div>
                          <Link href={`/clients/view/?id=${c.id}`} onClick={(e) => e.stopPropagation()} className="text-label-lg hover:underline">
                            {c.name}
                          </Link>
                          <div className="text-body-sm text-muted">
                            {c.city} · {c.code} · {c.devices_used}/{c.max_devices} terminal{c.max_devices === 1 ? "" : "s"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-body-md">{c.owner_name}</div>
                      <div className="text-body-sm text-muted">{c.phone}</div>
                    </td>
                    <td className="px-4 py-3">
                      <PlanBadge name={c.plan_name} kind={c.plan_id} />
                    </td>
                    <td className="px-4 py-3">
                      <StateBadge state={c.state} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="tnum text-body-md">{c.expires_at ? fmtDate(c.expires_at) : "Lifetime"}</div>
                      <div className="text-body-sm text-muted">
                        {c.expires_at ? daysLabel(Math.ceil((new Date(c.expires_at).getTime() - now) / 86_400_000)) : "Perpetual"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cx("flex items-center gap-1.5 text-body-md", c.offline && c.state !== "suspended" && "text-hold-ink")}>
                        <Icon name={c.offline ? "wifi_off" : "wifi"} className="text-[18px]" /> {ago(c.last_check_in_at, new Date(now))}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="tnum text-price-md">{c.today_sales_paise ? formatINRShort(c.today_sales_paise) : "—"}</div>
                      <div className="tnum text-body-sm text-muted">{c.today_bills ? `${c.today_bills} bills` : "no sync yet"}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-body-md text-muted">
            <span>{total === 0 ? "No restaurants" : `Showing ${page * PAGE + 1}–${Math.min(total, (page + 1) * PAGE)} of ${total}`}</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="secondary" icon="chevron_left" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page" />
              <Badge tone="neutral">
                Page {page + 1} of {pages}
              </Badge>
              <Button size="sm" variant="secondary" icon="chevron_right" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} aria-label="Next page" />
            </div>
          </div>
        </Card>
      </Async>
    </div>
  );
}

export default function ClientsPage() {
  return (
    <Suspense>
      <Clients />
    </Suspense>
  );
}
