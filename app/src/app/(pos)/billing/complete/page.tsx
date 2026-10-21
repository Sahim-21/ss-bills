"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Receipt, useReceiptData } from "@/components/receipt";
import { Button, Card, EmptyState, Icon, Segmented } from "@/components/ui";
import { fmtTime, useHotkey } from "@/lib/hooks";
import { formatINRShort } from "@/lib/money";
import { usePos } from "@/lib/pos-store";
import { describeOutcome, usePrinting, type PrintOutcome } from "@/lib/printing";
import { ORDER_TYPE_LABEL, PAYMENT_ICON, PAYMENT_LABEL } from "@/lib/types";

function BillComplete() {
  const { state, dispatch } = usePos();
  const router = useRouter();
  const params = useSearchParams();
  const bill = state.paid.find((b) => b.id === state.lastPaidId);
  const data = useReceiptData(bill);
  const [width, setWidth] = useState<58 | 80>(state.profile.paperWidthMm);
  const tableLabel = state.tables.find((t) => t.id === bill?.tableId)?.label;
  const { printReceipt, savePdf, receiptPrinter } = usePrinting();
  const [status, setStatus] = useState<(PrintOutcome & { filePath?: string }) | "working" | null>(null);

  const run = useCallback(async (job: Promise<PrintOutcome & { filePath?: string }>) => {
    setStatus("working");
    setStatus(await job);
  }, []);
  const doPrint = (duplicate: boolean) => data && run(printReceipt(data, { duplicate, width }));
  const doPdf = () => data && bill && run(savePdf(data, bill.billNo.replaceAll("/", "-"), { width }));

  // The first print starts by itself after "Confirm & print" / "Confirm & save PDF".
  const autoStarted = useRef(false);
  useEffect(() => {
    const then = params.get("then");
    if (!bill || !data || !then || autoStarted.current) return;
    autoStarted.current = true;
    router.replace("/billing/complete/");
    void run(then === "pdf" ? savePdf(data, bill.billNo.replaceAll("/", "-"), { width }) : printReceipt(data, { width }));
  }, [bill, data, params, router, run, savePdf, printReceipt, width]);

  const next = useCallback(() => {
    dispatch({ type: "newBill" });
    router.push("/billing/");
  }, [dispatch, router]);
  useHotkey("F1", useCallback((e: KeyboardEvent) => {
    e.preventDefault();
    next();
  }, [next]));

  if (!bill || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState icon="receipt_long" title="No bill to show">
          <Link href="/billing/" className="text-primary underline">
            Back to billing
          </Link>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line bg-surface-low px-6 py-3">
        <div className="flex items-center gap-3">
          <Link href="/billing/" className="flex items-center gap-1 text-label-lg text-ink-variant hover:text-ink">
            <Icon name="arrow_back" className="text-[20px]" /> Back to billing
          </Link>
          <span className="text-muted">/</span>
          <span className="text-headline-sm">
            Bill complete <span className="font-mono text-primary">{bill.billNo}</span>
          </span>
          <span className="flex items-center gap-1 rounded-full bg-[#dcfce7] px-3 py-1 text-label-sm uppercase text-tertiary">
            <span className="h-2 w-2 rounded-full bg-tertiary" /> Paid
          </span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_460px] gap-5 p-5">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex justify-center">
            <Segmented<"80" | "58">
              size="sm"
              className="w-[360px]"
              value={String(width) as "80" | "58"}
              onChange={(v) => setWidth(Number(v) as 58 | 80)}
              options={[
                { value: "80", label: "80mm (standard)", icon: "receipt" },
                { value: "58", label: "58mm (compact)", icon: "receipt" },
              ]}
            />
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto rounded-3xl bg-surface-container py-8">
            <Receipt data={data} profile={state.profile} width={width} />
          </div>
        </div>

        <div className="scroll-thin space-y-4 overflow-y-auto">
          <Card className="p-5">
            <div className="flex items-start gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-tertiary-fixed text-tertiary">
                <Icon name="check_circle" className="text-[32px]" />
              </span>
              <div>
                <h2 className="text-headline-md">Bill saved</h2>
                <p className="text-body-md text-muted">
                  {tableLabel ? `Table ${tableLabel} is now free.` : `${ORDER_TYPE_LABEL[bill.orderType]} order closed.`}
                </p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4 rounded-2xl bg-surface-low p-4">
              <div>
                <div className="text-label-sm uppercase text-muted">Total paid</div>
                <div className="tnum text-[40px] font-extrabold leading-[48px] tracking-tight text-primary">{formatINRShort(bill.totalPaise)}</div>
              </div>
              <div className="text-right">
                <div className="text-label-sm uppercase text-muted">Order</div>
                <div className="text-headline-sm">{tableLabel ? `Table ${tableLabel}` : ORDER_TYPE_LABEL[bill.orderType]}</div>
                <div className="text-body-sm text-muted">{ORDER_TYPE_LABEL[bill.orderType]}</div>
              </div>
              <div>
                <div className="text-label-sm uppercase text-muted">Payment</div>
                <div className="flex items-center gap-1.5 text-headline-sm">
                  <Icon name={PAYMENT_ICON[bill.paymentMethod]} className="text-primary" /> {PAYMENT_LABEL[bill.paymentMethod]}
                </div>
              </div>
              <div className="text-right">
                <div className="text-label-sm uppercase text-muted">Time</div>
                <div className="tnum text-headline-sm">{fmtTime(bill.paidAt)}</div>
              </div>
            </div>
          </Card>

          <button
            type="button"
            onClick={next}
            className="flex h-16 w-full items-center justify-between rounded-2xl bg-primary px-6 text-white shadow-level2 transition-all hover:bg-primary-hover active:scale-[0.99]"
          >
            <span className="flex items-center gap-3 text-headline-md">
              <Icon name="add_circle" className="text-[28px]" /> Start next bill
            </span>
            <span className="rounded-lg bg-white/20 px-2 py-1 font-mono text-label-md">F1</span>
          </button>
          <PrintStatus status={status} printer={receiptPrinter} onRetry={() => doPrint(false)} />
          <div className="grid grid-cols-2 gap-3">
            <Button variant="charcoal" size="lg" icon="print" disabled={status === "working"} onClick={() => doPrint(true)}>
              Reprint
            </Button>
            <Button variant="secondary" size="lg" icon="picture_as_pdf" disabled={status === "working"} onClick={doPdf}>
              Save PDF
            </Button>
          </div>
          <p className="px-1 text-body-sm text-muted">
            Reprints are marked <b>DUPLICATE</b>.{" "}
            {receiptPrinter ? `Printing to ${receiptPrinter}.` : "No receipt printer is chosen, so the print dialog opens each time. Choose one in Settings → Printing."}
          </p>
        </div>
      </div>
    </div>
  );
}

function PrintStatus({
  status,
  printer,
  onRetry,
}: {
  status: (PrintOutcome & { filePath?: string }) | "working" | null;
  printer: string | null;
  onRetry: () => void;
}) {
  if (status === null) return null;
  if (status === "working") {
    return (
      <div role="status" className="flex items-center gap-3 rounded-2xl bg-surface-container px-5 py-4 text-label-lg">
        <Icon name="progress_activity" className="animate-spin text-primary" /> {printer ? `Printing to ${printer}…` : "Opening the print dialog…"}
      </div>
    );
  }
  const d = describeOutcome(status);
  const error = d.tone === "error";
  return (
    <div
      role={error ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-2xl px-5 py-4 text-label-lg ${error ? "bg-error-container text-on-error-container" : d.tone === "info" ? "bg-hold-surface text-hold-ink" : "bg-[#dcfce7] text-tertiary"}`}
    >
      <Icon name={error ? "error" : d.tone === "info" ? "info" : "check_circle"} className="icon-fill text-[22px]" />
      <div className="flex-1">
        <div>{error ? "The receipt did not print" : d.text}</div>
        {error && <div className="mt-1 text-body-md font-normal">{d.text}</div>}
      </div>
      {error && (
        <Button size="sm" variant="danger" icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export default function BillCompletePage() {
  return (
    <Suspense>
      <BillComplete />
    </Suspense>
  );
}
