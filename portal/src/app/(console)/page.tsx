"use client";

import Link from "next/link";
import { useState } from "react";
import { LineChart } from "@/components/charts";
import { Async, Avatar, PlanBadge, ReasonDialog, RenewDialog, StateBadge } from "@/components/console-ui";
import { Badge, Button, Card, EmptyState, Icon, PageHeader, Segmented, cx } from "@/components/ui";
import { ago, daysLabel, describeEvent, EVENT_ICON, EVENT_LABEL, EVENT_TONE, fmtDate, fmtYmd } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import { formatINR, formatINRCompact } from "@/lib/money";
import { useApi, usePortal } from "@/lib/portal";
import type { Overview } from "@/lib/types";

type Row = Overview["attention"][number];

export default function OverviewPage() {
  const api = useApi();
  const { me } = usePortal();
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const { data, error, loading, reload } = useAsync(() => api.overview(Number(days)), [api, days]);
  const [renew, setRenew] = useState<Row | null>(null);
  const [reactivate, setReactivate] = useState<Row | null>(null);
  const [filter, setFilter] = useState<"all" | "expiring" | "suspended" | "offline">("all");

  const o = data;
  const delta = o && o.gmv.prev_total_paise > 0 ? ((o.gmv.total_paise - o.gmv.prev_total_paise) / o.gmv.prev_total_paise) * 100 : null;
  const attention = (o?.attention ?? []).filter((a) =>
    filter === "all" ? true : filter === "suspended" ? a.state === "suspended" : filter === "offline" ? a.offline && a.state !== "suspended" : ["expiring", "grace", "expired"].includes(a.state),
  );
  const peak = o?.gmv.series.reduce((m, d) => (d.sales_paise > m.sales_paise ? d : m), o.gmv.series[0]);

  return (
    <Async error={error} loading={loading} hasData={!!o} onRetry={reload}>
      {o && (
        <div className="space-y-5">
          <PageHeader
            eyebrow="Vendor command hub"
            title="System overview"
            subtitle={`Monitoring ${o.counts.total} restaurant${o.counts.total === 1 ? "" : "s"}. Sales come from the daily summaries each restaurant uploads.`}
            actions={
              <>
                <Segmented<"7" | "30" | "90"> size="sm" className="w-[280px]" value={days} onChange={setDays} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
                {me?.role === "super_admin" && (
                  <Link href="/clients/new/">
                    <Button variant="primary" icon="add_business">Onboard restaurant</Button>
                  </Link>
                )}
              </>
            }
          />

          <div className="grid grid-cols-5 gap-3">
            <Kpi href="/clients/" label="Total clients" value={o.counts.total} sub={`+${o.counts.enrolled_this_month} this month`} icon="trending_up" />
            <Kpi href="/clients/?status=active" label="Active licenses" value={o.counts.active} sub="Paid and current" icon="check_circle" tone="good" />
            <Kpi href="/clients/?status=expiring" label="Need renewal" value={o.counts.expiring} sub="Expiring, in grace or expired" icon="hourglass_top" tone="warn" />
            <Kpi href="/clients/?status=suspended" label="Suspended" value={o.counts.suspended} sub={o.counts.suspended ? "Billing locked" : "None"} icon="block" tone="bad" />
            <Kpi href="/clients/?status=offline" label="Offline > 7 days" value={o.counts.offline} sub="No recent check-in" icon="wifi_off" tone={o.counts.offline ? "warn" : undefined} />
          </div>

          <div className="grid grid-cols-[1fr_380px] gap-5">
            <div className="space-y-5">
              <Card className="p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-label-sm uppercase tracking-wider text-muted">Daily summaries from all clients</div>
                    <h2 className="text-headline-md">Combined sales, last {o.gmv.days} days</h2>
                    <div className="mt-2 flex items-center gap-3">
                      <span className="tnum text-[34px] font-extrabold leading-10 tracking-tight">{formatINR(o.gmv.total_paise)}</span>
                      {delta !== null && (
                        <Badge tone={delta >= 0 ? "success" : "danger"}>
                          <Icon name={delta >= 0 ? "trending_up" : "trending_down"} className="text-[14px]" /> {delta >= 0 ? "+" : ""}{delta.toFixed(1)}% vs before
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-body-sm text-muted">
                    <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-chart-1" /> This period</span>
                  </div>
                </div>
                <div className="mt-3">
                  <LineChart
                    ariaLabel="Combined daily sales"
                    data={o.gmv.series.map((d) => ({ label: fmtYmd(d.date), value: d.sales_paise, sub: `${d.outlets} restaurants reported · ${d.bills.toLocaleString("en-IN")} bills` }))}
                  />
                </div>
                {peak && peak.sales_paise > 0 && (
                  <div className="mt-2 grid grid-cols-3 gap-3 rounded-xl bg-surface-low p-4 text-body-md">
                    <div><div className="text-muted">Best day</div><div className="tnum text-label-lg">{fmtYmd(peak.date)} · {formatINRCompact(peak.sales_paise)}</div></div>
                    <div><div className="text-muted">Bills in the period</div><div className="tnum text-label-lg">{o.gmv.series.reduce((s, d) => s + d.bills, 0).toLocaleString("en-IN")}</div></div>
                    <div><div className="text-muted">Average per day</div><div className="tnum text-label-lg">{formatINRCompact(Math.round(o.gmv.total_paise / o.gmv.days))}</div></div>
                  </div>
                )}
              </Card>

              <Card className="p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-fixed text-primary"><Icon name="notifications_active" /></span>
                    <div>
                      <h2 className="text-headline-md">Needs attention</h2>
                      <p className="text-body-md text-muted">Renewals, suspensions and restaurants that went quiet</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {([["all", "All"], ["expiring", "Renewals"], ["suspended", "Suspended"], ["offline", "Offline"]] as const).map(([k, label]) => (
                      <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={cx("h-9 rounded-full px-4 text-label-md", filter === k ? "bg-charcoal text-white" : "border border-line bg-surface-lowest text-muted hover:bg-surface-low")}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {attention.length === 0 && <EmptyState icon="task_alt" title="All clear">Nothing needs attention right now.</EmptyState>}
                  {attention.map((a) => (
                    <div key={a.id} className="flex items-center gap-4 rounded-2xl bg-surface-low p-4">
                      <Avatar name={a.name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/clients/view/?id=${a.id}`} className="text-label-lg hover:underline">{a.name}</Link>
                          <span className="text-body-sm text-muted">{a.city}</span>
                          <PlanBadge name={a.plan_name} />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-body-md">
                          <StateBadge state={a.state} />
                          {a.state === "suspended" ? <span className="text-error">{a.suspended_reason}</span> : <span className="text-ink-variant">{daysLabel(a.days_left)}{a.expires_at ? ` (${fmtDate(a.expires_at)})` : ""}</span>}
                          {a.offline && a.state !== "suspended" && <span className="flex items-center gap-1 text-hold-ink"><Icon name="wifi_off" className="text-[16px]" /> Last seen {ago(a.last_check_in_at)}</span>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Link href={`/clients/view/?id=${a.id}`}><Button size="sm" variant="secondary">View</Button></Link>
                        {a.state === "suspended" ? (
                          <Button size="sm" variant="primary" icon="lock_open" onClick={() => setReactivate(a)}>Reactivate</Button>
                        ) : a.state !== "active" ? (
                          <Button size="sm" variant="primary" icon="autorenew" onClick={() => setRenew(a)}>Renew</Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <div className="space-y-5">
              <Card className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-label-sm uppercase tracking-wider text-muted">Billing volume</div>
                    <h2 className="text-headline-md">Top clients</h2>
                  </div>
                  <Link href="/insights/" className="text-label-md text-primary hover:underline">View all →</Link>
                </div>
                <ol className="mt-4 space-y-3">
                  {o.top_clients.length === 0 && <li className="text-body-md text-muted">No sales reported yet.</li>}
                  {o.top_clients.map((c, i) => (
                    <li key={c.id} className="flex items-center gap-3">
                      <span className={cx("flex h-6 w-6 items-center justify-center rounded-full text-label-sm", i === 0 ? "bg-primary text-white" : "bg-surface-container text-muted")}>{i + 1}</span>
                      <Avatar name={c.name} size={40} />
                      <div className="min-w-0 flex-1">
                        <Link href={`/clients/view/?id=${c.id}`} className="block truncate text-label-lg hover:underline">{c.name}</Link>
                        <div className="text-body-sm text-muted">{c.city} · {c.bills.toLocaleString("en-IN")} bills</div>
                      </div>
                      <div className="tnum text-price-md">{formatINRCompact(c.sales_paise)}</div>
                    </li>
                  ))}
                </ol>
              </Card>

              <Card className="p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-headline-md">Recent activity</h2>
                  <Link href="/activity/" className="text-label-md text-primary hover:underline">Full log →</Link>
                </div>
                <ul className="mt-4 space-y-4">
                  {o.recent.map((e) => (
                    <li key={e.id} className="flex gap-3">
                      <span className={cx("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", e.event === "suspended" || e.event === "device_reset" ? "bg-error-container text-error" : "bg-primary-fixed text-primary")}>
                        <Icon name={EVENT_ICON[e.event]} className="text-[20px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-label-lg">{e.restaurant_name ?? "Platform"}</span>
                          <span className="shrink-0 text-body-sm text-muted">{ago(e.created_at)}</span>
                        </div>
                        <div className="text-body-sm text-muted">{EVENT_LABEL[e.event]} · {e.actor_name}</div>
                        <div className="text-body-sm text-ink-variant">{describeEvent(e)}</div>
                        <Badge tone={EVENT_TONE[e.event]} className="mt-1">{e.event.replace("_", " ")}</Badge>
                      </div>
                    </li>
                  ))}
                  {o.recent.length === 0 && <li className="text-body-md text-muted">Nothing yet.</li>}
                </ul>
              </Card>
            </div>
          </div>

          <RenewDialog
            open={!!renew}
            onClose={() => setRenew(null)}
            onDone={reload}
            target={renew ? { id: renew.id, name: renew.name, plan_id: renew.plan_id, expires_at: renew.expires_at, suspended: false } : null}
          />
          <ReasonDialog
            open={!!reactivate}
            onClose={() => setReactivate(null)}
            title={`Reactivate ${reactivate?.name ?? ""}`}
            subtitle="Billing works again at the restaurant's next sync"
            confirmLabel="Reactivate"
            requireReason={false}
            placeholder="e.g. Payment received by UPI"
            onConfirm={async (note) => {
              await api.reactivate(reactivate!.id, note);
              reload();
            }}
          />
        </div>
      )}
    </Async>
  );
}

function Kpi({ href, label, value, sub, icon, tone }: { href: string; label: string; value: number; sub: string; icon: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-tertiary" : tone === "warn" ? "text-hold-ink" : tone === "bad" ? "text-error" : "text-ink";
  return (
    <Link href={href} className="group block">
      <Card className="h-full p-4 transition-shadow group-hover:shadow-level2">
        <div className="flex items-start justify-between gap-2">
          <div className="text-label-sm uppercase tracking-wider text-muted">{label}</div>
          <Icon name={icon} className={cx("text-[20px]", color)} />
        </div>
        <div className="tnum mt-2 text-[34px] font-extrabold leading-9 tracking-tight">{value}</div>
        <div className={cx("mt-2 text-body-sm", color === "text-ink" ? "text-muted" : color)}>{sub}</div>
      </Card>
    </Link>
  );
}
