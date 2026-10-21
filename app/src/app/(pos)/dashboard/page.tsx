"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ColumnChart, Donut, RankBars } from "@/components/charts";
import { Page } from "@/components/shell";
import { AdminOnly, Button, Card, EmptyState, Icon, StatCard, VegMark, cx } from "@/components/ui";
import { calcBill } from "@/lib/billing";
import { fmtDateLong, fmtDuration, isSameDay, minutesSince, useNow } from "@/lib/hooks";
import { formatINRShort } from "@/lib/money";
import { usePos } from "@/lib/pos-store";
import { bestSellers, salesByHour, summarizeBills } from "@/lib/reports";
import { ORDER_TYPE_LABEL } from "@/lib/types";

export default function DashboardPage() {
  const { state, isAdmin, user, dispatch } = usePos();
  const router = useRouter();
  const now = useNow(60_000);
  if (!isAdmin) return <AdminOnly />;

  const today = state.paid.filter((b) => isSameDay(b.paidAt, now));
  const s = summarizeBills(now, today);
  const yesterday = state.history[state.history.length - 1];
  const delta = yesterday?.salesPaise ? ((s.salesPaise - yesterday.salesPaise) / yesterday.salesPaise) * 100 : 0;
  const cancelledValue = today.filter((b) => b.status === "cancelled").reduce((x, b) => x + b.totalPaise, 0);
  const firstHour = Math.min(11, ...today.map((b) => new Date(b.paidAt).getHours()));
  const lastHour = Math.min(23, Math.max(firstHour + 5, now.getHours()));
  const hours = salesByHour(today, firstHour, lastHour);
  const peak = hours.reduce((m, h) => (h.value > m.value ? h : m), hours[0]);
  const best = bestSellers(today, state.menu, 5);
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";

  return (
    <Page>
      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-headline-xl">
              {greeting}, {user?.name.split(" ")[0]}
            </h1>
            <span className="flex items-center gap-1.5 rounded-full bg-surface-container px-3 py-1 text-label-md">
              <span className="h-2 w-2 rounded-full bg-primary-container" /> {state.profile.name}
            </span>
          </div>
          <p className="mt-1 text-body-lg text-muted">{fmtDateLong(now)} · today so far</p>
        </div>
        <div className="flex gap-2">
          <Button variant="charcoal" icon="analytics" onClick={() => router.push("/reports/")}>
            Full reports
          </Button>
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-4 gap-4">
        <StatCard
          label="Today's sales"
          value={formatINRShort(s.salesPaise)}
          icon="payments"
          tone="primary"
          sub={
            <span className={cx("flex items-center gap-1", delta >= 0 ? "text-tertiary" : "text-error")}>
              <Icon name={delta >= 0 ? "trending_up" : "trending_down"} className="text-[18px]" />
              {delta >= 0 ? "+" : ""}
              {delta.toFixed(1)}% vs yesterday&apos;s full day
            </span>
          }
        />
        <StatCard label="Bills today" value={s.bills} icon="receipt_long" sub={`${state.held.length} held right now`} />
        <StatCard label="Average bill" value={formatINRShort(s.bills ? Math.round(s.salesPaise / s.bills) : 0)} icon="query_stats" sub={`GST collected ${formatINRShort(s.taxPaise)}`} />
        <StatCard
          label="Cancelled"
          value={s.cancelled}
          icon="cancel"
          tone="danger"
          sub={<span className="text-error">{formatINRShort(cancelledValue)} cancelled today</span>}
        />
      </div>

      <div className="mt-4 grid grid-cols-[1.35fr_1fr] gap-4">
        <div className="space-y-4">
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-headline-md">
                  <Icon name="bar_chart" className="text-primary" /> Sales by hour
                </h2>
                <p className="text-body-md text-muted">Paid bills today · hover a bar for details</p>
              </div>
            </div>
            <div className="mt-4">
              <ColumnChart data={hours} ariaLabel="Sales by hour today" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-surface-low p-4 text-body-md">
              <div>
                <div className="text-muted">Busiest hour</div>
                <div className="tnum text-label-lg text-primary">
                  {peak?.label} · {formatINRShort(peak?.value ?? 0)}
                </div>
              </div>
              <div>
                <div className="text-muted">Bills in busiest hour</div>
                <div className="tnum text-label-lg">{peak?.sub}</div>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="flex items-center gap-2 text-headline-md">
              <Icon name="donut_large" className="text-primary" /> Payment split
            </h2>
            <p className="mb-4 text-body-md text-muted">How customers paid today</p>
            <Donut
              centerLabel="Total"
              centerValue={formatINRShort(s.salesPaise)}
              segments={[
                { label: "UPI", value: s.upiPaise, color: "var(--color-chart-1)", sub: `${today.filter((b) => b.status === "paid" && b.paymentMethod === "upi").length} bills` },
                { label: "Cash", value: s.cashPaise, color: "var(--color-chart-2)", sub: `${today.filter((b) => b.status === "paid" && b.paymentMethod === "cash").length} bills` },
                { label: "Card", value: s.cardPaise, color: "var(--color-chart-3)", sub: `${today.filter((b) => b.status === "paid" && b.paymentMethod === "card").length} bills` },
              ]}
            />
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-6">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-headline-md">
                  <Icon name="local_fire_department" className="text-primary" /> Best-selling items
                </h2>
                <p className="text-body-md text-muted">Today, by quantity</p>
              </div>
              <Link href="/reports/?tab=items" className="text-label-md text-primary hover:underline">
                More →
              </Link>
            </div>
            {best.length ? (
              <RankBars rows={best.map((b) => ({ ...b, lead: <VegMark veg={b.veg} /> }))} />
            ) : (
              <EmptyState icon="restaurant" title="No sales yet today" />
            )}
          </Card>

          <Card className="p-6">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-headline-md">
                  <Icon name="pause_circle" className="text-primary" /> Held bills right now
                </h2>
                <p className="flex items-center gap-1.5 text-body-md text-tertiary">
                  <span className="h-2 w-2 rounded-full bg-tertiary" />
                  {state.held.length} open ·{" "}
                  {formatINRShort(state.held.reduce((x, b) => x + calcBill(b.lines, state.tax).total, 0))} running
                </p>
              </div>
              <Link href="/tables/" className="text-label-md text-primary hover:underline">
                Tables →
              </Link>
            </div>
            <div className="space-y-2">
              {state.held.slice(0, 4).map((b) => {
                const t = calcBill(b.lines, state.tax);
                const mins = minutesSince(b.createdAt, now);
                const label = state.tables.find((x) => x.id === b.tableId)?.label;
                return (
                  <div key={b.id} className="flex items-center gap-3 rounded-xl bg-surface-low p-3">
                    <span className="flex h-11 w-12 flex-col items-center justify-center rounded-lg bg-surface-lowest">
                      {label ? (
                        <>
                          <span className="text-[9px] font-bold uppercase text-muted">Table</span>
                          <span className="text-label-lg">{label}</span>
                        </>
                      ) : (
                        <Icon name={b.orderType === "delivery" ? "two_wheeler" : "takeout_dining"} className="text-primary" />
                      )}
                    </span>
                    <div className="flex-1">
                      <div className="text-label-lg">{ORDER_TYPE_LABEL[b.orderType]}</div>
                      <div className={cx("flex items-center gap-1 text-body-sm", mins > 45 ? "text-error" : "text-muted")}>
                        <Icon name="timer" className="text-[14px]" /> {fmtDuration(mins)}
                      </div>
                    </div>
                    <span className="tnum text-price-md">{formatINRShort(t.total)}</span>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        dispatch({ type: "openBill", id: b.id });
                        router.push("/billing/");
                      }}
                    >
                      Open
                    </Button>
                  </div>
                );
              })}
              {state.held.length === 0 && <EmptyState icon="check_circle" title="No held bills" />}
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}
