"use client";

import Link from "next/link";
import { useState } from "react";
import { LineChart } from "@/components/charts";
import { Async, Avatar } from "@/components/console-ui";
import { Badge, Button, Card, Chip, EmptyState, Icon, PageHeader, inputClass, cx } from "@/components/ui";
import { downloadCsv } from "@/lib/csv";
import { fmtYmd, fmtYmdFull, istDate } from "@/lib/format";
import { useAsync, useNowMs } from "@/lib/hooks";
import { formatINR, formatINRCompact, formatINRShort } from "@/lib/money";
import { useApi } from "@/lib/portal";

type Preset = "today" | "7" | "30" | "month" | "custom";
const PAGE = 8;

export default function InsightsPage() {
  const api = useApi();
  const now = useNowMs();
  const today = istDate(0, new Date(now));
  const [preset, setPreset] = useState<Preset>("30");
  const [custom, setCustom] = useState({ from: istDate(-29, new Date(now)), to: today });
  const [compare, setCompare] = useState(true);
  const [page, setPage] = useState(0);

  const range =
    preset === "today" ? { from: today, to: today }
    : preset === "7" ? { from: istDate(-6, new Date(now)), to: today }
    : preset === "30" ? { from: istDate(-29, new Date(now)), to: today }
    : preset === "month" ? { from: `${today.slice(0, 8)}01`, to: today }
    : custom;
  const validRange = range.from <= range.to;

  const { data, error, loading, reload } = useAsync(() => api.insights(range.from, range.to), [api, range.from, range.to]);
  const d = data;
  const growth = d && d.prev.sales_paise > 0 ? ((d.totals.sales_paise - d.prev.sales_paise) / d.prev.sales_paise) * 100 : null;
  const billsGrowth = d && d.prev.bills > 0 ? ((d.totals.bills - d.prev.bills) / d.prev.bills) * 100 : null;
  const pct = (v: number) => (d && d.totals.sales_paise ? (v / d.totals.sales_paise) * 100 : 0);
  const clients = d?.clients ?? [];
  const pages = Math.max(1, Math.ceil(clients.length / PAGE));
  const top = clients.slice(0, 7);
  const topMax = Math.max(1, ...top.map((c) => c.sales_paise));
  const topShare = d && d.totals.sales_paise ? (top.reduce((s, c) => s + c.sales_paise, 0) / d.totals.sales_paise) * 100 : 0;

  function exportCsv() {
    if (!d) return;
    downloadCsv(`ss-bills-sales-${d.from}-to-${d.to}.csv`, [
      ["Restaurant", "City", "Terminals", "Sales (INR)", "Previous period (INR)", "Growth %", "Bills", "Average bill (INR)", "Top item"],
      ...d.clients.map((c) => [c.name, c.city, c.devices, c.sales_paise / 100, c.prev_sales_paise / 100, c.growth_pct ?? "new", c.bills, c.avg_ticket_paise / 100, c.top_item ?? ""]),
    ]);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Daily summaries from every client"
        title="Sales insights"
        subtitle="Combined sales, payment mix and how each restaurant is growing. Only daily totals are reported, never individual bills."
        actions={
          <>
            <label className="flex h-11 cursor-pointer items-center gap-2 rounded-lg bg-surface-container px-4 text-label-lg">
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="h-5 w-5 accent-[var(--color-primary)]" />
              Compare with before
            </label>
            <Button variant="secondary" icon="download" onClick={exportCsv} disabled={!d}>Export CSV</Button>
          </>
        }
      />

      <Card className="flex flex-wrap items-center gap-2 p-3">
        {([["today", "Today"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["month", "This month"], ["custom", "Custom"]] as [Preset, string][]).map(([k, label]) => (
          <Chip key={k} active={preset === k} onClick={() => { setPreset(k); setPage(0); }}>{label}</Chip>
        ))}
        {preset === "custom" && (
          <span className="ml-2 flex items-center gap-2">
            <input type="date" aria-label="From" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className={cx(inputClass, "h-11 w-auto")} />
            <span className="text-muted">to</span>
            <input type="date" aria-label="To" value={custom.to} min={custom.from} max={today} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className={cx(inputClass, "h-11 w-auto")} />
          </span>
        )}
        {d && <span className="ml-auto text-body-md text-muted">{fmtYmdFull(d.from)} – {fmtYmdFull(d.to)} · {d.days} day{d.days === 1 ? "" : "s"}</span>}
      </Card>

      {!validRange ? (
        <Card><EmptyState icon="date_range" title="Check the dates">The start date must be on or before the end date.</EmptyState></Card>
      ) : (
        <Async error={error} loading={loading} hasData={!!d} onRetry={reload}>
          {d && (
            <div className={cx("space-y-5 transition-opacity", loading && "opacity-60")}>
              <div className="grid grid-cols-4 gap-3">
                <Kpi label="Total sales" value={formatINR(d.totals.sales_paise)} delta={growth} sub={d.days > 0 ? `${formatINRCompact(Math.round(d.totals.sales_paise / d.days))} a day` : ""} />
                <Kpi label="Bills" value={d.totals.bills.toLocaleString("en-IN")} delta={billsGrowth} sub={`${clients.length} restaurants reported`} />
                <Kpi label="Average bill" value={d.totals.bills ? formatINRShort(Math.round(d.totals.sales_paise / d.totals.bills)) : "—"} sub={d.totals.bills ? "across all clients" : ""} />
                <Card className="p-4">
                  <div className="text-label-sm uppercase tracking-wider text-muted">Payment mix</div>
                  <div className="tnum mt-2 text-headline-md">{pct(d.totals.upi_paise).toFixed(0)}% UPI</div>
                  <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-container" role="img" aria-label={`UPI ${pct(d.totals.upi_paise).toFixed(0)}%, cash ${pct(d.totals.cash_paise).toFixed(0)}%, card ${pct(d.totals.card_paise).toFixed(0)}%`}>
                    <span className="bg-chart-1" style={{ width: `${pct(d.totals.upi_paise)}%`, marginRight: 2 }} />
                    <span className="bg-chart-2" style={{ width: `${pct(d.totals.cash_paise)}%`, marginRight: 2 }} />
                    <span className="bg-chart-3" style={{ width: `${pct(d.totals.card_paise)}%` }} />
                  </div>
                  <div className="mt-2 flex gap-3 text-body-sm text-muted">
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-chart-1" />UPI</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-chart-2" />Cash {pct(d.totals.cash_paise).toFixed(0)}%</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-chart-3" />Card {pct(d.totals.card_paise).toFixed(0)}%</span>
                  </div>
                </Card>
              </div>

              <div className="grid grid-cols-[1.5fr_1fr] gap-5">
                <Card className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-headline-md">Combined sales trend</h2>
                      <p className="text-body-md text-muted">All clients together, per day</p>
                    </div>
                    <div className="flex items-center gap-4 text-body-sm text-muted">
                      <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-chart-1" /> This period</span>
                      {compare && <span className="flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-outline" /> Before</span>}
                    </div>
                  </div>
                  {d.totals.sales_paise === 0 ? (
                    <EmptyState icon="monitoring" title="No sales in this period" />
                  ) : (
                    <div className="mt-3">
                      <LineChart
                        ariaLabel="Combined sales trend"
                        data={d.series.map((s) => ({ label: fmtYmd(s.date), value: s.sales_paise, sub: `${s.bills.toLocaleString("en-IN")} bills` }))}
                        compare={compare ? d.prev_series.map((s) => ({ label: fmtYmd(s.date), value: s.sales_paise })) : undefined}
                      />
                    </div>
                  )}
                </Card>

                <Card className="p-6">
                  <h2 className="text-headline-md">Client leaderboard</h2>
                  <p className="mb-4 text-body-md text-muted">Top {top.length} by sales in this period</p>
                  <ol className="space-y-3">
                    {top.map((c, i) => (
                      <li key={c.id}>
                        <div className="flex items-center gap-2">
                          <span className="tnum w-5 text-label-lg text-muted">{i + 1}</span>
                          <Link href={`/clients/view/?id=${c.id}`} className="min-w-0 flex-1 truncate text-label-lg hover:underline">{c.name}</Link>
                          <span className="tnum text-price-md">{formatINRCompact(c.sales_paise)}</span>
                          <Growth pct={c.growth_pct} isNew={c.is_new} />
                        </div>
                        <div className="ml-7 mt-1 h-1.5 rounded-full bg-surface-container"><div className="h-1.5 rounded-full bg-chart-1" style={{ width: `${(c.sales_paise / topMax) * 100}%` }} /></div>
                        <div className="ml-7 text-body-sm text-muted">{c.city}</div>
                      </li>
                    ))}
                    {top.length === 0 && <li className="text-body-md text-muted">No sales reported.</li>}
                  </ol>
                  {top.length > 0 && <p className="mt-4 border-t border-line pt-3 text-body-sm text-muted">The top {top.length} make up <b className="text-ink">{topShare.toFixed(1)}%</b> of all sales.</p>}
                  {d.cities.length > 0 && (
                    <div className="mt-4 rounded-xl bg-surface-low p-3 text-body-sm">
                      <div className="mb-1 text-label-sm uppercase tracking-wider text-muted">Top cities</div>
                      {d.cities.slice(0, 3).map((c) => (
                        <div key={c.city} className="flex justify-between"><span>{c.city}</span><span className="tnum text-ink-variant">{formatINRCompact(c.sales_paise)}</span></div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              <Card className="overflow-hidden">
                <div className="px-6 pb-3 pt-5">
                  <h2 className="text-headline-md">Client billing & growth</h2>
                  <p className="text-body-md text-muted">Compared with the {d.days} day{d.days === 1 ? "" : "s"} before</p>
                </div>
                <table className="tnum w-full text-left text-body-md">
                  <thead className="bg-surface-low text-label-md uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-6 py-3">Restaurant</th><th className="px-3 py-3 text-right">Terminals</th><th className="px-3 py-3 text-right">Sales</th>
                      <th className="px-3 py-3 text-right">Before</th><th className="px-3 py-3 text-right">Growth</th><th className="px-3 py-3 text-right">Bills</th>
                      <th className="px-3 py-3 text-right">Avg bill</th><th className="px-6 py-3">Top item</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-low">
                    {clients.slice(page * PAGE, (page + 1) * PAGE).map((c) => (
                      <tr key={c.id} className="hover:bg-surface-low">
                        <td className="px-6 py-3">
                          <Link href={`/clients/view/?id=${c.id}`} className="flex items-center gap-3 hover:underline">
                            <Avatar name={c.name} size={36} />
                            <span><span className="block text-label-lg">{c.name}</span><span className="block text-body-sm text-muted">{c.city}</span></span>
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-right">{c.devices}</td>
                        <td className="px-3 py-3 text-right text-price-md">{formatINR(c.sales_paise)}</td>
                        <td className="px-3 py-3 text-right text-muted">{c.is_new ? "—" : formatINRShort(c.prev_sales_paise)}</td>
                        <td className="px-3 py-3 text-right"><Growth pct={c.growth_pct} isNew={c.is_new} /></td>
                        <td className="px-3 py-3 text-right">{c.bills.toLocaleString("en-IN")}</td>
                        <td className="px-3 py-3 text-right">{formatINRShort(c.avg_ticket_paise)}</td>
                        <td className="px-6 py-3 text-ink-variant">{c.top_item ?? "—"}</td>
                      </tr>
                    ))}
                    {clients.length === 0 && <tr><td colSpan={8} className="px-6 py-8 text-center text-muted">No restaurant reported sales in this period.</td></tr>}
                  </tbody>
                </table>
                <div className="flex items-center justify-between border-t border-line px-6 py-3 text-body-md text-muted">
                  <span>{clients.length === 0 ? "" : `Showing ${page * PAGE + 1}–${Math.min(clients.length, (page + 1) * PAGE)} of ${clients.length}`}</span>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="secondary" icon="chevron_left" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page" />
                    <Badge tone="neutral">Page {page + 1} of {pages}</Badge>
                    <Button size="sm" variant="secondary" icon="chevron_right" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} aria-label="Next page" />
                  </div>
                </div>
              </Card>
            </div>
          )}
        </Async>
      )}
    </div>
  );
}

function Kpi({ label, value, delta, sub }: { label: string; value: string; delta?: number | null; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-label-sm uppercase tracking-wider text-muted">{label}</div>
        {delta != null && (
          <Badge tone={delta >= 0 ? "success" : "danger"}>
            <Icon name={delta >= 0 ? "trending_up" : "trending_down"} className="text-[14px]" /> {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
          </Badge>
        )}
      </div>
      <div className="tnum mt-2 text-headline-lg">{value}</div>
      {sub && <div className="mt-1 text-body-sm text-muted">{sub}</div>}
    </Card>
  );
}

function Growth({ pct, isNew }: { pct: number | null; isNew: boolean }) {
  if (isNew || pct === null) return <Badge tone="primary">New</Badge>;
  return <Badge tone={pct >= 0 ? "success" : "danger"}>{pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%</Badge>;
}
