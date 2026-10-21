"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Donut, LineChart, RankBars } from "@/components/charts";
import { Page } from "@/components/shell";
import { AdminOnly, Button, Card, Chip, Icon, PageHeader, VegMark, cx, inputClass } from "@/components/ui";
import { bpToPercentLabel } from "@/lib/billing";
import { isSameDay, useNow } from "@/lib/hooks";
import { formatINR, formatINRShort } from "@/lib/money";
import { toISODate } from "@/lib/mock-data";
import { usePos } from "@/lib/pos-store";
import { bestSellers, summarizeBills, totalsOf } from "@/lib/reports";
import type { DailySummary } from "@/lib/types";

type Tab = "sales" | "payments" | "items" | "tax";
type RangeKey = "today" | "yesterday" | "week" | "month" | "custom";

const TABS: { key: Tab; title: string; sub: string; icon: string }[] = [
  { key: "sales", title: "Sales", sub: "Daily sales & bills", icon: "monitoring" },
  { key: "payments", title: "Payments", sub: "Cash, UPI & card", icon: "account_balance_wallet" },
  { key: "items", title: "Best-selling items", sub: "Top dishes", icon: "local_fire_department" },
  { key: "tax", title: "Tax summary", sub: "CGST & SGST", icon: "account_balance" },
];

const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
const weekdayFmt = new Intl.DateTimeFormat("en-IN", { weekday: "long" });

function Reports() {
  const { state, isAdmin } = usePos();
  const params = useSearchParams();
  const now = useNow(60_000);
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "sales");
  const [range, setRange] = useState<RangeKey>("week");
  const [from, setFrom] = useState(toISODate(new Date(now.getTime() - 13 * 86_400_000)));
  const [to, setTo] = useState(toISODate(now));

  const todayBills = useMemo(() => state.paid.filter((b) => isSameDay(b.paidAt, now)), [state.paid, now]);
  const allDays: DailySummary[] = useMemo(() => [...state.history, summarizeBills(now, todayBills)], [state.history, todayBills, now]);

  const days = useMemo(() => {
    const todayISO = toISODate(now);
    const n = allDays.length;
    switch (range) {
      case "today":
        return allDays.filter((d) => d.date === todayISO);
      case "yesterday":
        return allDays.slice(n - 2, n - 1);
      case "week":
        return allDays.slice(-7);
      case "month":
        return allDays.filter((d) => d.date.slice(0, 7) === todayISO.slice(0, 7));
      case "custom":
        return allDays.filter((d) => d.date >= from && d.date <= to);
    }
  }, [allDays, range, from, to, now]);

  if (!isAdmin) return <AdminOnly />;

  const t = totalsOf(days);
  // Item-level detail only exists on the PC's own bills; mock data has today's bills,
  // so other ranges scale today's mix by the number of days (UI preview only).
  const items = bestSellers(todayBills, state.menu, 10).map((r) => ({
    ...r,
    qty: Math.round(r.qty * Math.max(1, days.length)),
    value: Math.round(r.value * Math.max(1, days.length)),
  }));
  const chartData = days.map((d) => ({
    label: dayFmt.format(new Date(d.date)),
    value: d.salesPaise,
    sub: `${d.bills} bills`,
  }));
  const rangeLabel =
    days.length === 0
      ? "No data"
      : days.length === 1
        ? dayFmt.format(new Date(days[0].date))
        : `${dayFmt.format(new Date(days[0].date))} – ${dayFmt.format(new Date(days[days.length - 1].date))} (${days.length} days)`;

  return (
    <Page>
      <PageHeader
        eyebrow="Admin reports"
        title="Business reports"
        subtitle={`${state.profile.name} · GSTIN ${state.profile.gstin}`}
        actions={
          <Button variant="primary" icon="print" onClick={() => window.print()}>
            Print report
          </Button>
        }
      />

      <div className="mt-5 grid grid-cols-4 gap-3">
        {TABS.map((x) => {
          const active = x.key === tab;
          return (
            <button
              key={x.key}
              type="button"
              onClick={() => setTab(x.key)}
              aria-pressed={active}
              className={cx(
                "flex items-center gap-3 rounded-2xl border-2 p-4 text-left transition-all",
                active ? "border-primary bg-[#fdf3ee] shadow-level2" : "border-line bg-surface-lowest hover:border-line-strong",
              )}
            >
              <span className={cx("flex h-12 w-12 items-center justify-center rounded-xl", active ? "bg-primary text-white" : "bg-surface-container")}>
                <Icon name={x.icon} className="text-[24px]" />
              </span>
              <span>
                <span className={cx("block text-headline-sm", active && "text-primary")}>{x.title}</span>
                <span className="block text-body-sm text-muted">{x.sub}</span>
              </span>
            </button>
          );
        })}
      </div>

      <Card className="mt-4 flex flex-wrap items-center gap-2 p-3">
        <span className="mr-2 flex items-center gap-2 px-2 text-label-lg">
          <Icon name="date_range" className="text-primary" /> {rangeLabel}
        </span>
        {(
          [
            ["today", "Today"],
            ["yesterday", "Yesterday"],
            ["week", "Last 7 days"],
            ["month", "This month"],
            ["custom", "Custom"],
          ] as [RangeKey, string][]
        ).map(([k, label]) => (
          <Chip key={k} active={range === k} onClick={() => setRange(k)}>
            {label}
          </Chip>
        ))}
        {range === "custom" && (
          <span className="ml-2 flex items-center gap-2">
            <input type="date" aria-label="From date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={cx(inputClass, "h-11 w-auto")} />
            <span className="text-muted">to</span>
            <input type="date" aria-label="To date" value={to} min={from} max={toISODate(now)} onChange={(e) => setTo(e.target.value)} className={cx(inputClass, "h-11 w-auto")} />
          </span>
        )}
      </Card>

      <div id="print-area" className="mt-4 space-y-4 bg-surface">
        <div className="grid grid-cols-4 gap-3">
          <Kpi label="Total sales" value={formatINR(t.sales)} />
          <Kpi label="Bills" value={t.bills.toLocaleString("en-IN")} sub={`${t.cancelled} cancelled`} />
          <Kpi label="GST collected" value={formatINR(t.tax)} sub={`CGST ${formatINR(Math.floor(t.tax / 2))} · SGST ${formatINR(t.tax - Math.floor(t.tax / 2))}`} />
          <Kpi label="Average bill" value={formatINR(t.avg)} />
        </div>

        {tab === "sales" && (
          <>
            {chartData.length > 1 && (
              <Card className="p-6">
                <h2 className="text-headline-md">Daily sales trend</h2>
                <p className="mb-3 text-body-md text-muted">Paid bills per day · hover for details</p>
                <LineChart data={chartData} ariaLabel="Daily sales trend" />
              </Card>
            )}
            <DayTable days={days} />
          </>
        )}

        {tab === "payments" && (
          <div className="grid grid-cols-[1fr_1.2fr] gap-4">
            <Card className="p-6">
              <h2 className="mb-4 text-headline-md">Payment split</h2>
              <Donut
                centerLabel="Total"
                centerValue={formatINRShort(t.sales)}
                segments={[
                  { label: "UPI", value: t.upi, color: "var(--color-chart-1)" },
                  { label: "Cash", value: t.cash, color: "var(--color-chart-2)" },
                  { label: "Card", value: t.card, color: "var(--color-chart-3)" },
                ]}
              />
            </Card>
            <DayTable days={days} variant="payments" />
          </div>
        )}

        {tab === "items" && (
          <Card className="p-6">
            <h2 className="text-headline-md">Best-selling items</h2>
            <p className="mb-5 text-body-md text-muted">By quantity sold · {rangeLabel}</p>
            <RankBars rows={items.map((r) => ({ ...r, lead: <VegMark veg={r.veg} /> }))} />
          </Card>
        )}

        {tab === "tax" && (
          <>
            <Card className="grid grid-cols-3 gap-4 p-6">
              <div>
                <div className="text-label-sm uppercase text-muted">GST rate</div>
                <div className="text-headline-lg">{bpToPercentLabel(state.tax.gstRateBp)}</div>
                <div className="text-body-sm text-muted">{state.tax.pricesIncludeTax ? "Included in menu prices" : "Added on top of menu prices"}</div>
              </div>
              <div>
                <div className="text-label-sm uppercase text-muted">SAC code</div>
                <div className="text-headline-lg font-mono">{state.profile.hsnSac}</div>
                <div className="text-body-sm text-muted">Restaurant services</div>
              </div>
              <div>
                <div className="text-label-sm uppercase text-muted">Taxable value</div>
                <div className="tnum text-headline-lg">{formatINR(t.sales - t.tax)}</div>
                <div className="text-body-sm text-muted">Sales minus GST</div>
              </div>
            </Card>
            <DayTable days={days} variant="tax" />
          </>
        )}
      </div>
    </Page>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-5">
      <div className="text-label-md uppercase text-muted">{label}</div>
      <div className="tnum mt-1 text-headline-lg">{value}</div>
      {sub && <div className="tnum mt-1 text-body-sm text-muted">{sub}</div>}
    </Card>
  );
}

function DayTable({ days, variant = "sales" }: { days: DailySummary[]; variant?: "sales" | "payments" | "tax" }) {
  const t = totalsOf(days);
  const rows = [...days].reverse();
  return (
    <Card className="overflow-hidden">
      <table className="tnum w-full text-left text-body-md">
        <thead className="bg-surface-low text-label-md uppercase text-muted">
          <tr>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3 text-right">Bills</th>
            {variant !== "tax" && (
              <>
                <th className="px-4 py-3 text-right">Cash</th>
                <th className="px-4 py-3 text-right">UPI</th>
                <th className="px-4 py-3 text-right">Card</th>
              </>
            )}
            {variant !== "payments" && (
              <>
                <th className="px-4 py-3 text-right">CGST</th>
                <th className="px-4 py-3 text-right">SGST</th>
              </>
            )}
            <th className="px-4 py-3 text-right">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-low">
          {rows.map((d) => (
            <tr key={d.date} className="hover:bg-surface-low">
              <td className="px-4 py-3">
                <span className="text-label-lg">{dayFmt.format(new Date(d.date))}</span>{" "}
                <span className="text-body-sm text-muted">{weekdayFmt.format(new Date(d.date))}</span>
              </td>
              <td className="px-4 py-3 text-right">{d.bills}</td>
              {variant !== "tax" && (
                <>
                  <td className="px-4 py-3 text-right">{formatINR(d.cashPaise)}</td>
                  <td className="px-4 py-3 text-right">{formatINR(d.upiPaise)}</td>
                  <td className="px-4 py-3 text-right">{formatINR(d.cardPaise)}</td>
                </>
              )}
              {variant !== "payments" && (
                <>
                  <td className="px-4 py-3 text-right">{formatINR(Math.floor(d.taxPaise / 2))}</td>
                  <td className="px-4 py-3 text-right">{formatINR(d.taxPaise - Math.floor(d.taxPaise / 2))}</td>
                </>
              )}
              <td className="px-4 py-3 text-right text-price-md">{formatINR(d.salesPaise)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-surface-container text-label-lg">
          <tr>
            <td className="px-4 py-3">Total ({days.length} days)</td>
            <td className="px-4 py-3 text-right">{t.bills}</td>
            {variant !== "tax" && (
              <>
                <td className="px-4 py-3 text-right">{formatINR(t.cash)}</td>
                <td className="px-4 py-3 text-right">{formatINR(t.upi)}</td>
                <td className="px-4 py-3 text-right">{formatINR(t.card)}</td>
              </>
            )}
            {variant !== "payments" && (
              <>
                <td className="px-4 py-3 text-right">{formatINR(Math.floor(t.tax / 2))}</td>
                <td className="px-4 py-3 text-right">{formatINR(t.tax - Math.floor(t.tax / 2))}</td>
              </>
            )}
            <td className="px-4 py-3 text-right text-primary">{formatINR(t.sales)}</td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}

export default function ReportsPage() {
  return (
    <Suspense>
      <Reports />
    </Suspense>
  );
}
