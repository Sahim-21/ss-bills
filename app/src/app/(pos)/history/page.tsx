"use client";

import { useMemo, useState } from "react";
import { Receipt, useReceiptData } from "@/components/receipt";
import { Page } from "@/components/shell";
import { Badge, Button, Card, Chip, Drawer, EmptyState, Icon, Modal, PageHeader, SearchInput, Segmented, cx, inputClass } from "@/components/ui";
import { fmtDate, fmtTime, isSameDay, useNow } from "@/lib/hooks";
import { formatINR } from "@/lib/money";
import { usePos } from "@/lib/pos-store";
import { describeOutcome, usePrinting, type PrintOutcome } from "@/lib/printing";
import type { PaidBill, PaymentMethod } from "@/lib/types";
import { ORDER_TYPE_LABEL, PAYMENT_ICON, PAYMENT_LABEL } from "@/lib/types";

type Status = "all" | "paid" | "cancelled";
type Range = "today" | "all";
const CANCEL_REASONS = ["Wrong items punched", "Customer walked out", "Duplicate bill", "Other"];

export default function HistoryPage() {
  const { state, isAdmin } = usePos();
  const now = useNow(60_000);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [payment, setPayment] = useState<PaymentMethod | "all">("all");
  // Cashiers see today's bills only (PRD §4).
  const [range, setRange] = useState<Range>("today");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const scoped = useMemo(
    () => state.paid.filter((b) => (range === "today" || !isAdmin ? isSameDay(b.paidAt, now) : true)),
    [state.paid, range, isAdmin, now],
  );
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped.filter((b) => {
      if (status !== "all" && b.status !== status) return false;
      if (payment !== "all" && b.paymentMethod !== payment) return false;
      if (!q) return true;
      const table = state.tables.find((t) => t.id === b.tableId)?.label.toLowerCase() ?? "";
      return b.billNo.toLowerCase().includes(q) || table === q || String(Math.round(b.totalPaise / 100)).startsWith(q.replace(/[₹,]/g, ""));
    });
  }, [scoped, query, status, payment, state.tables]);

  const paid = scoped.filter((b) => b.status === "paid");
  const sum = (m?: PaymentMethod) => paid.filter((b) => !m || b.paymentMethod === m).reduce((s, b) => s + b.totalPaise, 0);
  const selected = state.paid.find((b) => b.id === selectedId);

  return (
    <Page>
      <PageHeader
        eyebrow="Records"
        title="Bill history"
        subtitle={isAdmin ? "Search, view, reprint and cancel bills" : "Today's bills · search, view and reprint"}
        actions={
          isAdmin && (
            <Segmented<Range>
              size="sm"
              className="w-[260px]"
              value={range}
              onChange={setRange}
              options={[
                { value: "today", label: "Today" },
                { value: "all", label: "All bills" },
              ]}
            />
          )
        }
      />

      <div className="mt-5 grid grid-cols-5 gap-3">
        <MiniStat label="Bills" value={String(scoped.length)} sub={`${paid.length} paid`} icon="receipt_long" />
        <MiniStat label="Collected" value={formatINR(sum())} icon="account_balance_wallet" tone="primary" />
        <MiniStat label="Cash" value={formatINR(sum("cash"))} icon="payments" />
        <MiniStat label="UPI" value={formatINR(sum("upi"))} icon="qr_code_2" />
        <MiniStat label="Card" value={formatINR(sum("card"))} icon="credit_card" />
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <SearchInput className="min-w-[280px] flex-1" value={query} onChange={setQuery} placeholder="Search bill no, table (t4) or amount…" />
          <div className="flex gap-2">
            {(["all", "paid", "cancelled"] as Status[]).map((s) => (
              <Chip key={s} active={status === s} onClick={() => setStatus(s)}>
                {s === "all" ? "All" : s === "paid" ? "Paid" : "Cancelled"}
              </Chip>
            ))}
          </div>
          <div className="flex gap-2">
            {(["all", "cash", "upi", "card"] as const).map((m) => (
              <Chip key={m} active={payment === m} onClick={() => setPayment(m)} icon={m !== "all" ? <Icon name={PAYMENT_ICON[m]} className="text-[18px]" /> : undefined}>
                {m === "all" ? "Any payment" : PAYMENT_LABEL[m]}
              </Chip>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState icon="manage_search" title="No bills found">Try a different search or filter.</EmptyState>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-surface-low text-label-md uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Bill no</th>
                <th className="px-4 py-3">Date & time</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3 text-right">Items</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-low">
              {rows.map((b) => {
                const table = state.tables.find((t) => t.id === b.tableId)?.label;
                const cancelled = b.status === "cancelled";
                return (
                  <tr
                    key={b.id}
                    onClick={() => setSelectedId(b.id)}
                    className={cx("cursor-pointer transition-colors hover:bg-surface-low", selectedId === b.id && "bg-primary-fixed/40", cancelled && "text-muted")}
                  >
                    <td className="px-4 py-3 font-mono text-label-lg">{b.billNo}</td>
                    <td className="tnum px-4 py-3 text-body-md">
                      {isSameDay(b.paidAt, now) ? "Today" : fmtDate(b.paidAt)}, {fmtTime(b.paidAt)}
                    </td>
                    <td className="px-4 py-3 text-body-md">
                      {ORDER_TYPE_LABEL[b.orderType]}
                      {table && <span className="ml-1.5 rounded bg-surface-container px-1.5 py-0.5 text-label-sm">{table}</span>}
                    </td>
                    <td className="tnum px-4 py-3 text-right text-body-md">{b.lines.reduce((s, l) => s + l.qty, 0)}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-body-md">
                        <Icon name={PAYMENT_ICON[b.paymentMethod]} className="text-[18px] text-muted" />
                        {PAYMENT_LABEL[b.paymentMethod]}
                      </span>
                    </td>
                    <td className={cx("tnum px-4 py-3 text-right text-price-md", cancelled && "line-through")}>{formatINR(b.totalPaise)}</td>
                    <td className="px-4 py-3">
                      {cancelled ? <Badge tone="danger">Cancelled</Badge> : <Badge tone="success">Paid</Badge>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Icon name="chevron_right" className="text-muted" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="border-t border-line px-4 py-3 text-body-sm text-muted">
          Showing {rows.length} of {scoped.length} bills · cancelled bills are kept for audit and their numbers are never reused
        </div>
      </Card>

      <BillDrawer bill={selected} onClose={() => setSelectedId(null)} />
    </Page>
  );
}

function MiniStat({ label, value, sub, icon, tone }: { label: string; value: string; sub?: string; icon: string; tone?: "primary" }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", tone === "primary" ? "bg-primary-fixed text-primary" : "bg-surface-container")}>
        <Icon name={icon} />
      </span>
      <div className="min-w-0">
        <div className="text-label-sm uppercase text-muted">{label}</div>
        <div className="tnum truncate text-headline-sm">{value}</div>
        {sub && <div className="text-body-sm text-muted">{sub}</div>}
      </div>
    </Card>
  );
}

function BillDrawer({ bill, onClose }: { bill: PaidBill | undefined; onClose: () => void }) {
  const { state, isAdmin } = usePos();
  const data = useReceiptData(bill);
  const [cancelOpen, setCancelOpen] = useState(false);
  const { printReceipt } = usePrinting();
  const [reprint, setReprint] = useState<PrintOutcome | "working" | null>(null);
  const cancelledBy = state.staff.find((s) => s.id === bill?.cancelledBy)?.name;

  return (
    <>
      <Drawer open={!!bill} onClose={onClose} width={520}>
        {bill && data && (
          <>
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <div>
                <div className="font-mono text-headline-sm">{bill.billNo}</div>
                <div className="text-body-sm text-muted">
                  {fmtDate(bill.paidAt)}, {fmtTime(bill.paidAt)}
                </div>
              </div>
              <button type="button" aria-label="Close" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-surface-high">
                <Icon name="close" />
              </button>
            </div>
            {bill.status === "cancelled" && (
              <div className="mx-6 mt-4 flex items-start gap-3 rounded-xl bg-error-container p-3 text-body-md text-on-error-container">
                <Icon name="block" />
                <div>
                  <b>Cancelled</b> · {bill.cancelReason}
                  {cancelledBy && <div className="text-body-sm">by {cancelledBy}{bill.cancelledAt ? ` at ${fmtTime(bill.cancelledAt)}` : ""}</div>}
                </div>
              </div>
            )}
            <div className="scroll-thin flex-1 overflow-y-auto bg-surface-container py-6">
              <Receipt data={data} profile={state.profile} width={state.profile.paperWidthMm} />
            </div>
            <div className="space-y-2 border-t border-line p-4">
              <Button
                variant="charcoal"
                size="lg"
                icon="print"
                className="w-full"
                disabled={reprint === "working"}
                onClick={async () => {
                  setReprint("working");
                  setReprint(await printReceipt(data, { duplicate: true }));
                }}
              >
                {reprint === "working" ? "Printing…" : "Reprint (marked DUPLICATE)"}
              </Button>
              {reprint && reprint !== "working" && (
                <p
                  role={reprint.ok ? "status" : "alert"}
                  className={`rounded-xl px-4 py-2 text-body-md ${reprint.ok ? "bg-surface-container text-ink-variant" : "bg-error-container text-on-error-container"}`}
                >
                  {describeOutcome(reprint).text}
                </p>
              )}
              {bill.status === "paid" &&
                (isAdmin ? (
                  <Button variant="ghost" icon="cancel" className="w-full text-error! hover:bg-error-container!" onClick={() => setCancelOpen(true)}>
                    Cancel bill
                  </Button>
                ) : (
                  <p className="text-center text-body-sm text-muted">Only an Admin can cancel a bill.</p>
                ))}
            </div>
          </>
        )}
      </Drawer>
      {bill && <CancelDialog open={cancelOpen} bill={bill} onClose={() => setCancelOpen(false)} />}
    </>
  );
}

function CancelDialog({ open, bill, onClose }: { open: boolean; bill: PaidBill; onClose: () => void }) {
  const { state, cancelBill } = usePos();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const [note, setNote] = useState("");
  const table = state.tables.find((t) => t.id === bill.tableId)?.label;
  const finalReason = reason === "Other" ? note.trim() : note.trim() ? `${reason}: ${note.trim()}` : reason;

  return (
    <Modal open={open} onClose={onClose} className="max-w-[640px]" labelledBy="cancel-title">
      <div className="flex items-center gap-4 bg-error-container/60 px-6 py-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-error text-white">
          <Icon name="warning" />
        </span>
        <div>
          <h2 id="cancel-title" className="text-headline-md">
            Cancel bill {bill.billNo}?
          </h2>
          <p className="text-body-md text-ink-variant">Admin action · recorded with your name for audit</p>
        </div>
      </div>
      <div className="space-y-5 p-6">
        <div className="rounded-xl bg-error-container/40 p-3 text-body-md text-on-error-container">
          The bill stays in history marked <b>CANCELLED</b> and is removed from sales totals. Its number is never reused.
        </div>
        <div className="flex items-center justify-between rounded-xl bg-surface-low p-4">
          <div>
            <div className="text-label-sm uppercase text-muted">Order</div>
            <div className="text-headline-sm">
              {ORDER_TYPE_LABEL[bill.orderType]}
              {table ? ` · Table ${table}` : ""}
            </div>
          </div>
          <div className="text-right">
            <div className="text-label-sm uppercase text-muted">Bill total</div>
            <div className="tnum text-headline-lg text-error">{formatINR(bill.totalPaise)}</div>
          </div>
        </div>
        <div>
          <div className="mb-2 text-label-lg">Reason *</div>
          <div role="radiogroup" className="grid grid-cols-2 gap-2">
            {CANCEL_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                onClick={() => setReason(r)}
                className={cx(
                  "flex h-12 items-center gap-3 rounded-xl px-4 text-label-lg transition-colors",
                  reason === r ? "bg-primary-fixed text-on-primary-fixed" : "bg-surface-low hover:bg-surface-high",
                )}
              >
                <Icon name={reason === r ? "radio_button_checked" : "radio_button_unchecked"} className={reason === r ? "text-primary" : "text-muted"} />
                {r}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-2 block text-label-lg">Notes {reason === "Other" && "*"}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} placeholder="e.g. Punched table T4 instead of T14" />
        </label>
      </div>
      {error && (
        <div role="alert" className="mx-6 mb-4 rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-3 border-t border-line bg-surface-low px-6 py-4">
        <Button variant="secondary" onClick={onClose} kbd="Esc">
          Keep bill
        </Button>
        <Button
          variant="danger"
          icon="block"
          disabled={!finalReason}
          onClick={async () => {
            try {
              await cancelBill(bill.id, finalReason);
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not cancel the bill");
            }
          }}
        >
          Cancel bill
        </Button>
      </div>
    </Modal>
  );
}
