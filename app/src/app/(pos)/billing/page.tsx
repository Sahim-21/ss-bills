"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { PaymentModal } from "@/components/payment-modal";
import { Badge, Button, Chip, EmptyState, Icon, Kbd, Modal, SearchInput, Segmented, Stepper, VegMark, cx } from "@/components/ui";
import { bpToPercentLabel } from "@/lib/billing";
import { useHotkey } from "@/lib/hooks";
import { formatINR, formatINRShort, formatSignedINR } from "@/lib/money";
import { useCurrentTotals, usePos } from "@/lib/pos-store";
import { buildKot, describeOutcome, usePrinting } from "@/lib/printing";
import type { MenuItem, OrderType, PaymentMethod } from "@/lib/types";

type Diet = "all" | "veg" | "nonveg";

export default function BillingPage() {
  const { state, dispatch, payCurrent, categories, user } = usePos();
  const router = useRouter();
  const totals = useCurrentTotals();
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [diet, setDiet] = useState<Diet>("all");
  const [payOpen, setPayOpen] = useState(false);
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);
  const paying = useRef(false);
  const [kotBusy, setKotBusy] = useState(false);
  const { printKot } = usePrinting();

  const bill = state.current;
  const menu = useMemo(() => state.menu.filter((m) => !m.deleted), [state.menu]);
  const qtyInBill = useMemo(() => new Map(bill.lines.map((l) => [l.itemId, l.qty])), [bill.lines]);
  const tableLabel = state.tables.find((t) => t.id === bill.tableId)?.label;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return menu.filter((m) => {
      if (categoryId !== "all" && m.categoryId !== categoryId) return false;
      if (diet === "veg" && !m.veg) return false;
      if (diet === "nonveg" && m.veg) return false;
      if (!q) return true;
      return m.name.toLowerCase().includes(q) || m.shortCode.toLowerCase().startsWith(q);
    });
  }, [menu, query, categoryId, diet]);

  const countFor = (catId: string) => menu.filter((m) => catId === "all" || m.categoryId === catId).length;
  const pendingKot = bill.lines.reduce((s, l) => s + Math.max(0, l.qty - l.kotQty), 0);
  const needsTable = bill.orderType === "dine_in" && !bill.tableId;
  const canPay = bill.lines.length > 0 && !needsTable;

  // A new message replaces the old one and restarts the timer, so an old timer can't hide a new error.
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flash = useCallback((msg: string, error = false) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, error });
    toastTimer.current = setTimeout(() => setToast(null), error ? 6000 : 2400);
  }, []);

  const add = (m: MenuItem) => dispatch({ type: "addItem", item: m });

  useHotkey(
    "F2",
    useCallback((e: KeyboardEvent) => {
      e.preventDefault();
      document.querySelector<HTMLInputElement>("[data-search]")?.focus();
    }, []),
  );
  useHotkey(
    "F9",
    useCallback(
      (e: KeyboardEvent) => {
        e.preventDefault();
        if (canPay) setPayOpen(true);
      },
      [canPay],
    ),
  );

  const confirmPayment = useCallback(
    async (method: PaymentMethod, then: "print" | "pdf") => {
      if (paying.current) return; // ignore a second click or Enter while saving
      paying.current = true;
      try {
        await payCurrent(method);
        setPayOpen(false);
        router.push(`/billing/complete/?then=${then}`);
      } catch (e) {
        // The bill stays open and nothing was charged, so the cashier can simply try again.
        flash(`Payment was not saved: ${e instanceof Error ? e.message : "unknown error"}`, true);
      } finally {
        paying.current = false;
      }
    },
    [payCurrent, router, flash],
  );

  return (
    <div className="flex h-full gap-4 p-4">
      {/* Catalog */}
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-3 rounded-2xl bg-surface-lowest p-2 shadow-level1">
          <SearchInput
            className="flex-1"
            value={query}
            onChange={setQuery}
            placeholder="Search items or type a code (e.g. PBM, BTN)…"
            kbd="F2"
            autoFocus
          />
          <div className="flex shrink-0 gap-1 rounded-xl bg-surface-low p-1">
            {(
              [
                ["all", "All"],
                ["veg", "Veg"],
                ["nonveg", "Non-veg"],
              ] as [Diet, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={diet === v}
                onClick={() => setDiet(v)}
                className={cx(
                  "flex h-11 items-center gap-2 rounded-lg px-4 text-label-md transition-colors",
                  diet === v ? "bg-surface-lowest text-ink shadow-level1" : "text-ink-variant hover:bg-surface-lowest",
                )}
              >
                {v !== "all" && <VegMark veg={v === "veg"} size={14} />}
                {label}
              </button>
            ))}
          </div>
        </div>

        <nav aria-label="Menu categories" className="no-scrollbar flex shrink-0 gap-2 overflow-x-auto pb-1">
          <CategoryPill active={categoryId === "all"} count={countFor("all")} onClick={() => setCategoryId("all")}>
            All
          </CategoryPill>
          {categories.map((c) => (
            <CategoryPill key={c.id} active={categoryId === c.id} count={countFor(c.id)} onClick={() => setCategoryId(c.id)}>
              {c.name}
            </CategoryPill>
          ))}
        </nav>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-1">
          {visible.length === 0 ? (
            <EmptyState icon="search_off" title="No items match">
              Try a different name or short code, or clear the filters.
            </EmptyState>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 pb-2">
              {visible.map((m) => (
                <ItemTile key={m.id} item={m} qty={qtyInBill.get(m.id) ?? 0} onAdd={() => add(m)} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Current bill */}
      <aside className="flex w-[420px] shrink-0 flex-col overflow-hidden rounded-2xl bg-surface-lowest shadow-level2">
        <div className="space-y-3 bg-surface-low p-3">
          <Segmented<OrderType>
            value={bill.orderType}
            onChange={(v) => dispatch({ type: "setOrderType", orderType: v })}
            options={[
              { value: "dine_in", label: "Dine-in", icon: "restaurant" },
              { value: "takeaway", label: "Takeaway", icon: "takeout_dining" },
              { value: "delivery", label: "Delivery", icon: "two_wheeler" },
            ]}
          />
          <div className="flex items-center justify-between gap-3">
            {bill.orderType === "dine_in" ? (
              <button
                type="button"
                onClick={() => setTablePickerOpen(true)}
                className={cx(
                  "flex h-12 items-center gap-3 rounded-xl px-2 pr-4 transition-colors",
                  tableLabel ? "bg-surface-lowest shadow-level1 hover:bg-surface-high" : "border-2 border-dashed border-primary-container text-primary hover:bg-primary-fixed",
                )}
              >
                <span className={cx("flex h-9 w-9 items-center justify-center rounded-lg text-label-lg font-extrabold", tableLabel ? "bg-primary-fixed text-primary" : "")}>
                  {tableLabel ?? <Icon name="table_restaurant" />}
                </span>
                <span className="text-left">
                  <span className="block text-label-lg">{tableLabel ? `Table ${tableLabel}` : "Choose a table"}</span>
                  <span className="block text-body-sm text-muted">{tableLabel ? "Tap to change" : "Required for dine-in"}</span>
                </span>
                <Icon name="edit" className="text-[18px] text-muted" />
              </button>
            ) : (
              <span className="flex h-12 items-center gap-2 px-2 text-label-lg">
                <Icon name={bill.orderType === "delivery" ? "two_wheeler" : "takeout_dining"} className="text-primary" />
                {bill.orderType === "delivery" ? "Delivery order" : "Takeaway order"}
              </span>
            )}
            <div className="text-right">
              <div className="text-label-lg">New bill</div>
              <div className="text-body-sm text-muted">Number on payment</div>
            </div>
          </div>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4">
          {bill.lines.length === 0 ? (
            <EmptyState icon="shopping_basket" title="No items yet">
              Click an item on the left, or search by name or short code.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-surface-low">
              {bill.lines.map((l) => (
                <li key={l.itemId} className="flex items-center gap-3 py-3">
                  <VegMark veg={l.veg} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-label-lg">{l.name}</div>
                    <div className="tnum text-body-sm text-muted">
                      {formatINRShort(l.unitPricePaise)} each
                      {l.kotQty > 0 && l.kotQty >= l.qty && <span className="ml-2 text-tertiary">· KOT sent</span>}
                      {l.kotQty > 0 && l.kotQty < l.qty && <span className="ml-2 text-hold-ink">· {l.qty - l.kotQty} new</span>}
                    </div>
                  </div>
                  <Stepper qty={l.qty} onChange={(q) => dispatch({ type: "setQty", itemId: l.itemId, qty: q })} />
                  <div className="tnum w-20 text-right text-price-md">{formatINRShort(l.unitPricePaise * l.qty)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="tnum space-y-1.5 border-t border-line px-4 py-3 text-body-md text-ink-variant">
          <SummaryRow label={`Subtotal (${totals.itemCount} items)`} value={formatINR(totals.subtotal)} />
          {state.tax.serviceChargeEnabled && (
            <SummaryRow label={`Service charge (${bpToPercentLabel(state.tax.serviceChargeBp)}, optional)`} value={formatINR(totals.serviceCharge)} />
          )}
          <SummaryRow label={`CGST (${bpToPercentLabel(state.tax.gstRateBp / 2)})`} value={formatINR(totals.cgst)} />
          <SummaryRow label={`SGST (${bpToPercentLabel(state.tax.gstRateBp / 2)})`} value={formatINR(totals.sgst)} />
          <SummaryRow label="Round off" value={formatSignedINR(totals.roundOff)} />
        </div>
        <div className="flex items-end justify-between bg-surface-container px-4 py-3">
          <div>
            <div className="text-label-md uppercase text-ink-variant">Grand total</div>
            <div className="flex items-center gap-1 text-body-sm text-tertiary">
              <Icon name="verified" className="text-[16px]" />
              {state.tax.pricesIncludeTax ? "Prices include GST" : "GST added"}
            </div>
          </div>
          <div className="tnum text-price-hero">{formatINRShort(totals.total)}</div>
        </div>

        <div className="space-y-2 p-3">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="hold"
              icon="pause_circle"
              disabled={bill.lines.length === 0 || needsTable}
              onClick={() => {
                dispatch({ type: "hold" });
                flash(tableLabel ? `Bill held for Table ${tableLabel}` : "Bill held");
              }}
            >
              Hold bill
            </Button>
            <Button
              variant="charcoal"
              icon="print"
              disabled={pendingKot === 0 || kotBusy}
              title="Kitchen Order Ticket: prints new items for the kitchen, without prices"
              onClick={async () => {
                const count = pendingKot;
                setKotBusy(true);
                const r = await printKot(buildKot(bill, tableLabel, user?.name ?? ""));
                setKotBusy(false);
                if (!r.ok) {
                  // Not printed, so the items stay "new" and the cashier can try again.
                  flash(`KOT not printed: ${describeOutcome(r).text}`, true);
                } else if (r.cancelled) {
                  flash("KOT cancelled. Nothing was printed.", true);
                } else {
                  dispatch({ type: "sendKot" });
                  flash(`KOT sent to ${r.printer ?? "the print dialog"} · ${count} item${count === 1 ? "" : "s"}`);
                }
              }}
            >
              Print KOT {pendingKot > 0 && <Badge tone="warning">{pendingKot}</Badge>}
            </Button>
          </div>
          <button
            type="button"
            disabled={!canPay}
            onClick={() => setPayOpen(true)}
            className="flex h-14 w-full items-center justify-between rounded-xl bg-primary px-5 text-white shadow-level2 transition-all hover:bg-primary-hover active:scale-[0.99] disabled:opacity-40"
          >
            <span className="flex items-center gap-3 text-headline-md">
              <Icon name="payments" className="text-[26px]" />
              {needsTable && bill.lines.length > 0 ? "Choose a table to pay" : "Settle & pay"}
            </span>
            <span className="flex items-center gap-3">
              <span className="tnum text-price-lg">{formatINRShort(totals.total)}</span>
              <Kbd dark>F9</Kbd>
            </span>
          </button>
        </div>
      </aside>

      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        onConfirm={confirmPayment}
        totals={totals}
        gstRateBp={state.tax.gstRateBp}
        orderType={bill.orderType}
        tableLabel={tableLabel}
      />
      <TablePicker open={tablePickerOpen} onClose={() => setTablePickerOpen(false)} />

      {toast && (
        <div
          role={toast.error ? "alert" : "status"}
          className={cx(
            "fixed bottom-6 left-1/2 z-[120] flex -translate-x-1/2 items-center gap-2 rounded-xl px-5 py-3 text-label-lg text-white shadow-level3",
            toast.error ? "bg-error" : "bg-charcoal",
          )}
        >
          <Icon name={toast.error ? "error" : "check_circle"} className={cx("icon-fill", !toast.error && "text-online")} /> {toast.msg}
        </div>
      )}
    </div>
  );
}

function CategoryPill({ active, count, onClick, children }: { active: boolean; count: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <Chip active={active} count={count} onClick={onClick} className={active ? "bg-primary-container!" : ""}>
      {children}
    </Chip>
  );
}

function ItemTile({ item, qty, onAdd }: { item: MenuItem; qty: number; onAdd: () => void }) {
  const off = !item.available;
  return (
    <button
      type="button"
      disabled={off}
      onClick={onAdd}
      className={cx(
        "group relative flex min-h-[124px] flex-col justify-between rounded-2xl border bg-surface-lowest p-4 text-left shadow-tile transition-all duration-150",
        off
          ? "cursor-not-allowed border-transparent opacity-50"
          : qty > 0
            ? "border-primary-container hover:shadow-level2 active:scale-[0.98]"
            : "border-transparent hover:border-line-strong hover:shadow-level2 active:scale-[0.98] active:border-primary-container",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <VegMark veg={item.veg} />
          <span className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-variant">{item.shortCode}</span>
        </div>
        {off ? (
          <span className="flex items-center gap-1 rounded-full bg-error-container px-2 py-0.5 text-label-sm text-on-error-container">
            <Icon name="block" className="text-[12px]" /> Unavailable
          </span>
        ) : (
          qty > 0 && (
            <span className="tnum flex items-center gap-1 rounded-full bg-primary-fixed px-2 py-0.5 text-label-sm text-primary">
              <Icon name="check" className="text-[12px]" /> {qty} in bill
            </span>
          )
        )}
      </div>
      <div>
        <div className="line-clamp-2 text-headline-sm leading-5">{item.name}</div>
        <div className="tnum mt-1 text-price-lg">{formatINRShort(item.pricePaise)}</div>
      </div>
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}

function TablePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch, tables } = usePos();
  const occupied = new Set(state.held.map((b) => b.tableId).filter(Boolean));
  return (
    <Modal open={open} onClose={onClose} className="max-w-[720px]" labelledBy="tp-title">
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <div>
          <h2 id="tp-title" className="text-headline-md">
            Choose a table
          </h2>
          <p className="text-body-md text-muted">Occupied tables open their running bill.</p>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-surface-high">
          <Icon name="close" />
        </button>
      </div>
      <div className="grid grid-cols-4 gap-3 p-6">
        {tables.map((t) => {
          const busy = occupied.has(t.id);
          const current = state.current.tableId === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                dispatch({ type: "setTable", tableId: t.id });
                onClose();
              }}
              className={cx(
                "flex h-24 flex-col items-center justify-center rounded-2xl border-2 transition-all",
                current
                  ? "border-primary bg-primary-fixed"
                  : busy
                    ? "border-primary-fixed-dim bg-[#fdf3ee] hover:border-primary"
                    : "border-line bg-surface-lowest hover:border-tertiary-container",
              )}
            >
              <span className="text-headline-md">{t.label}</span>
              <span className={cx("text-body-sm", busy ? "text-primary" : "text-tertiary")}>
                {current ? "This bill" : busy ? "Occupied" : `Free · ${t.seats} seats`}
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
