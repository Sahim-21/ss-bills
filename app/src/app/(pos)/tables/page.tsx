"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Page } from "@/components/shell";
import { Button, Card, Chip, EmptyState, Icon, PageHeader, Segmented, cx } from "@/components/ui";
import { calcBill } from "@/lib/billing";
import { fmtDuration, minutesSince, useNow } from "@/lib/hooks";
import { formatINRShort } from "@/lib/money";
import { usePos } from "@/lib/pos-store";
import type { OpenBill } from "@/lib/types";

type Filter = "all" | "free" | "occupied";
type Lane = "all" | "takeaway" | "delivery";

export default function TablesPage() {
  const { state, dispatch, openBills, tables: allTables } = usePos();
  const router = useRouter();
  const now = useNow(30_000);
  const [filter, setFilter] = useState<Filter>("all");
  const [lane, setLane] = useState<Lane>("all");

  const byTable = new Map(openBills.filter((b) => b.tableId).map((b) => [b.tableId!, b]));
  const nonTable = openBills.filter((b) => !b.tableId && (lane === "all" || b.orderType === lane));
  const occupiedCount = byTable.size;
  const freeCount = allTables.length - occupiedCount;
  const running = openBills.reduce((s, b) => s + calcBill(b.lines, state.tax).total, 0);

  const tables = allTables.filter((t) =>
    filter === "all" ? true : filter === "free" ? !byTable.has(t.id) : byTable.has(t.id),
  );

  const openTable = (tableId: string) => {
    dispatch({ type: "openTable", tableId });
    router.push("/billing/");
  };
  const openBill = (b: OpenBill) => {
    if (b.id !== state.current.id) dispatch({ type: "openBill", id: b.id });
    router.push("/billing/");
  };

  return (
    <div className="flex h-full gap-4 p-4">
      <Page className="flex-1 p-2!">
        <PageHeader
          eyebrow="Floor"
          title="Tables"
          subtitle={`${allTables.length} tables · click a table to open its bill or start a new one`}
          actions={
            <Card className="flex items-center divide-x divide-line px-1 py-2">
              <div className="px-4">
                <div className="text-label-sm uppercase text-muted">Occupied</div>
                <div className="tnum text-headline-md">
                  {occupiedCount} / {allTables.length}
                </div>
              </div>
              <div className="px-4">
                <div className="text-label-sm uppercase text-muted">Running value</div>
                <div className="tnum text-headline-md text-primary">{formatINRShort(running)}</div>
              </div>
            </Card>
          }
        />

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <Chip active={filter === "all"} count={allTables.length} onClick={() => setFilter("all")}>
              All tables
            </Chip>
            <Chip active={filter === "free"} count={freeCount} onClick={() => setFilter("free")} icon={<span className="h-2.5 w-2.5 rounded-full bg-tertiary-container" />}>
              Free
            </Chip>
            <Chip active={filter === "occupied"} count={occupiedCount} onClick={() => setFilter("occupied")} icon={<span className="h-2.5 w-2.5 rounded-full bg-primary-container" />}>
              Occupied
            </Chip>
          </div>
          <div className="flex items-center gap-4 rounded-full border border-line bg-surface-lowest px-4 py-2 text-body-sm text-muted">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-tertiary-container" /> Free</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary-container" /> Occupied</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-error" /> Open over 45 min</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3 pb-4">
          {tables.map((t) => {
            const bill = byTable.get(t.id);
            if (!bill) {
              return (
                <div key={t.id} className="flex min-h-[176px] flex-col justify-between rounded-2xl border border-line border-l-4 border-l-tertiary-container bg-surface-lowest p-4 shadow-level1">
                  <div className="flex items-start justify-between">
                    <div className="flex items-baseline gap-2">
                      <span className="text-headline-lg">{t.label}</span>
                      <span className="rounded bg-surface-container px-1.5 py-0.5 text-label-sm">{t.seats}-seat</span>
                    </div>
                    <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-label-sm uppercase text-tertiary">Free</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-body-md text-tertiary">
                    <Icon name="check_circle" className="text-[18px]" /> Ready for guests
                  </div>
                  <div className="flex items-center justify-end">
                    <Button size="sm" variant="soft" icon="add" onClick={() => openTable(t.id)}>
                      Open bill
                    </Button>
                  </div>
                </div>
              );
            }
            const totals = calcBill(bill.lines, state.tax);
            const mins = minutesSince(bill.createdAt, now);
            const late = mins > 45;
            const isCurrent = bill.id === state.current.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => openBill(bill)}
                className={cx(
                  "flex min-h-[176px] flex-col justify-between rounded-2xl border border-l-4 bg-surface-lowest p-4 text-left shadow-level1 transition-all hover:shadow-level2",
                  isCurrent ? "border-primary border-l-primary ring-2 ring-primary/30" : "border-line border-l-primary-container",
                )}
              >
                <div className="flex w-full items-start justify-between">
                  <div className="flex items-baseline gap-2">
                    <span className={cx("text-headline-lg", isCurrent && "text-primary")}>{t.label}</span>
                    <span className="rounded bg-surface-container px-1.5 py-0.5 text-label-sm">{t.seats}-seat</span>
                  </div>
                  <span className={cx("rounded-full px-2 py-0.5 text-label-sm uppercase", isCurrent ? "bg-primary text-white" : late ? "bg-error-container text-on-error-container" : "bg-primary-fixed text-primary")}>
                    {isCurrent ? "On screen" : late ? `${fmtDuration(mins)}` : "Occupied"}
                  </span>
                </div>
                <div className="text-body-md text-muted">
                  <span className="flex items-center gap-1.5">
                    <Icon name="timer" className={cx("text-[18px]", late && "text-error")} /> {fmtDuration(mins)} · {totals.pieceCount} items
                  </span>
                  <span className="mt-0.5 block truncate text-body-sm">{bill.lines.map((l) => l.name).join(", ")}</span>
                </div>
                <div className="flex w-full items-end justify-between">
                  <div>
                    <div className="text-label-sm uppercase text-muted">Running total</div>
                    <div className="tnum text-price-lg">{formatINRShort(totals.total)}</div>
                  </div>
                  <span className="flex h-9 items-center gap-1 rounded-lg bg-surface-container px-3 text-label-md">
                    View bill <Icon name="chevron_right" className="text-[18px]" />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </Page>

      <aside className="flex w-[380px] shrink-0 flex-col overflow-hidden rounded-2xl bg-surface-lowest shadow-level2">
        <div className="flex items-center gap-3 border-b border-line p-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-fixed text-primary">
            <Icon name="takeout_dining" />
          </span>
          <div className="flex-1">
            <h2 className="text-headline-sm">Takeaway & delivery</h2>
            <p className="text-body-sm text-muted">Held orders without a table</p>
          </div>
          <span className="tnum rounded-full bg-primary px-2.5 py-0.5 text-label-sm text-white">{openBills.filter((b) => !b.tableId).length}</span>
        </div>
        <div className="p-3">
          <Segmented<Lane>
            size="sm"
            value={lane}
            onChange={setLane}
            options={[
              { value: "all", label: "All" },
              { value: "takeaway", label: "Takeaway" },
              { value: "delivery", label: "Delivery" },
            ]}
          />
        </div>
        <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
          {nonTable.length === 0 && <EmptyState icon="inventory_2" title="Nothing held">Held takeaway and delivery orders show up here.</EmptyState>}
          {nonTable.map((b) => {
            const totals = calcBill(b.lines, state.tax);
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => openBill(b)}
                className="w-full rounded-2xl border border-line bg-surface-low p-4 text-left transition-all hover:border-primary-container hover:bg-surface-lowest"
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-label-lg">
                    <Icon name={b.orderType === "delivery" ? "two_wheeler" : "takeout_dining"} className="text-primary" />
                    {b.orderType === "delivery" ? "Delivery" : "Takeaway"}
                  </span>
                  <span className="tnum text-price-lg">{formatINRShort(totals.total)}</span>
                </div>
                <div className="mt-1 truncate text-body-sm text-muted">{b.lines.map((l) => `${l.name} ×${l.qty}`).join(", ")}</div>
                <div className="mt-1 text-body-sm text-muted">{fmtDuration(minutesSince(b.createdAt, now))} ago</div>
              </button>
            );
          })}
        </div>
        <div className="border-t border-line p-3">
          <Button
            variant="charcoal"
            size="lg"
            className="w-full"
            icon="add_shopping_cart"
            onClick={() => {
              dispatch({ type: "newBill", orderType: lane === "delivery" ? "delivery" : "takeaway" });
              router.push("/billing/");
            }}
          >
            New takeaway / delivery
          </Button>
        </div>
      </aside>
    </div>
  );
}
