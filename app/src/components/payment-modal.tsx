"use client";

import { useEffect, useState } from "react";
import { bpToPercentLabel, type BillTotals } from "@/lib/billing";
import { formatINR, formatINRShort, formatSignedINR } from "@/lib/money";
import type { OrderType, PaymentMethod } from "@/lib/types";
import { ORDER_TYPE_LABEL, PAYMENT_ICON, PAYMENT_LABEL } from "@/lib/types";
import { Button, Icon, Kbd, Modal, cx } from "./ui";

const METHODS: { method: PaymentMethod; hint: string; key: string }[] = [
  { method: "cash", hint: "Collected at the counter", key: "1" },
  { method: "upi", hint: "Any UPI app", key: "2" },
  { method: "card", hint: "Debit or credit card", key: "3" },
];

/** Settle step (PRD P-1, P-2): one payment method per bill in the MVP. */
export function PaymentModal({
  open,
  onClose,
  onConfirm,
  totals,
  gstRateBp,
  orderType,
  tableLabel,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (method: PaymentMethod, then: "print" | "pdf") => void;
  totals: BillTotals;
  gstRateBp: number;
  orderType: OrderType;
  tableLabel?: string;
}) {
  const [method, setMethod] = useState<PaymentMethod>("upi");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const m = METHODS.find((x) => x.key === e.key);
      if (m) setMethod(m.method);
      if (e.key === "Enter") onConfirm(method, "print");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, method, onConfirm]);

  return (
    <Modal open={open} onClose={onClose} className="max-w-[880px]" labelledBy="pay-title">
      <div className="flex items-center justify-between border-b border-line bg-surface-low px-6 py-4">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-fixed text-primary">
            <Icon name="payments" className="text-[26px]" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 id="pay-title" className="text-headline-md">
                Settle payment
              </h2>
              <span className="rounded-full bg-primary-fixed px-2.5 py-0.5 text-label-md text-on-primary-fixed">
                {ORDER_TYPE_LABEL[orderType]}
                {tableLabel ? ` · Table ${tableLabel}` : ""}
              </span>
            </div>
            <p className="text-body-md text-muted">The bill number is assigned when you confirm.</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="flex h-11 items-center gap-2 rounded-lg px-3 hover:bg-surface-high" aria-label="Close">
          <Icon name="close" /> <Kbd>Esc</Kbd>
        </button>
      </div>

      <div className="space-y-6 p-6">
        <div className="rounded-2xl border border-primary-fixed-dim bg-[#fbeee7] px-6 py-5 text-center">
          <div className="text-label-md uppercase tracking-wider text-primary">Total amount due</div>
          <div className="tnum mt-1 text-[48px] font-extrabold leading-[56px] tracking-tight text-primary">
            {formatINRShort(totals.total)}
          </div>
          <div className="tnum mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-body-md text-ink-variant">
            <span>Subtotal {formatINR(totals.subtotal)}</span>
            {totals.serviceCharge > 0 && <span>· Service charge {formatINR(totals.serviceCharge)}</span>}
            <span>· GST {bpToPercentLabel(gstRateBp)} {formatINR(totals.cgst + totals.sgst)}</span>
            <span>· Round off {formatSignedINR(totals.roundOff)}</span>
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-label-lg uppercase tracking-wide">Payment method</h3>
            <span className="text-body-sm text-muted">Press 1, 2 or 3</span>
          </div>
          <div role="radiogroup" className="grid grid-cols-3 gap-4">
            {METHODS.map((m) => {
              const active = m.method === method;
              return (
                <button
                  key={m.method}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setMethod(m.method)}
                  className={cx(
                    "relative flex flex-col items-start gap-3 rounded-2xl border-2 p-5 text-left transition-all",
                    active ? "border-primary bg-[#fdf3ee] shadow-level2" : "border-line bg-surface-lowest hover:border-line-strong",
                  )}
                >
                  <span className="absolute right-4 top-4">
                    <Kbd>{m.key}</Kbd>
                  </span>
                  <span
                    className={cx(
                      "flex h-12 w-12 items-center justify-center rounded-xl",
                      active ? "bg-primary text-white" : "bg-surface-container text-ink",
                    )}
                  >
                    <Icon name={PAYMENT_ICON[m.method]} className="text-[26px]" />
                  </span>
                  <span>
                    <span className={cx("flex items-center gap-1.5 text-headline-md", active && "text-primary")}>
                      {PAYMENT_LABEL[m.method]}
                      {active && <Icon name="check_circle" className="icon-fill text-[22px]" />}
                    </span>
                    <span className="text-body-md text-muted">{m.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line bg-surface-low px-6 py-4">
        <Button variant="secondary" icon="arrow_back" kbd="Esc" onClick={onClose}>
          Back to billing
        </Button>
        <div className="flex items-center gap-3">
          <Button variant="secondary" icon="picture_as_pdf" onClick={() => onConfirm(method, "pdf")}>
            Confirm & save PDF
          </Button>
          <Button variant="primary" size="lg" icon="print" kbd="Enter" onClick={() => onConfirm(method, "print")}>
            Confirm & print
          </Button>
        </div>
      </div>
    </Modal>
  );
}
