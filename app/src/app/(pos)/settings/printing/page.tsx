"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { SettingsSection } from "@/components/settings-ui";
import { Badge, Button, Icon, cx } from "@/components/ui";
import { calcBill } from "@/lib/billing";
import { usePos } from "@/lib/pos-store";
import { describeOutcome, usePrinting, type PrinterInfo, type PrintOutcome } from "@/lib/printing";
import type { KotData, ReceiptData } from "@/lib/receipt-html";

// Printer choice (PRD P-4, B-10). Printing goes through the Windows printer driver (D-023), so any
// printer that has a driver installed works, including thermal receipt printers.
export default function PrintingSettingsPage() {
  const { state, dispatch } = usePos();
  const { printReceipt, printKot, listPrinters, isDesktop } = usePrinting();
  const [printers, setPrinters] = useState<PrinterInfo[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [result, setResult] = useState<{ what: string; outcome: PrintOutcome | "working" } | null>(null);

  const load = useCallback(
    (isCurrent: () => boolean) => {
      listPrinters()
        .then((l) => {
          if (!isCurrent()) return;
          setListError(null);
          setPrinters(l);
        })
        .catch((e: unknown) => {
          if (!isCurrent()) return;
          setPrinters([]);
          setListError(e instanceof Error ? e.message : "Could not read the printer list");
        });
    },
    [listPrinters],
  );

  useEffect(() => {
    let alive = true;
    load(() => alive);
    return () => {
      alive = false;
    };
  }, [load]);

  const { receipt, kot } = state.printers;
  const set = (patch: Partial<typeof state.printers>) => dispatch({ type: "setPrinters", printers: { ...state.printers, ...patch } });

  const sample = useMemo(() => {
    const items = state.menu.filter((m) => !m.deleted).slice(0, 2);
    const lines = items.map((m, i) => ({ itemId: m.id, name: m.name, unitPricePaise: m.pricePaise, veg: m.veg, qty: i + 2, kotQty: 0 }));
    return lines.length ? lines : [{ itemId: "x", name: "Test item", unitPricePaise: 10000, veg: true, qty: 1, kotQty: 0 }];
  }, [state.menu]);

  const test = async (what: "receipt" | "kot") => {
    setResult({ what, outcome: "working" });
    const now = new Date().toISOString();
    const t = calcBill(sample, state.tax);
    let outcome: PrintOutcome;
    if (what === "receipt") {
      const data: ReceiptData = {
        billNo: "TEST/0000/000000",
        at: now,
        orderType: "dine_in",
        tableLabel: "T1",
        cashier: "Test",
        lines: sample,
        subtotalPaise: t.subtotal,
        serviceChargePaise: t.serviceCharge,
        cgstPaise: t.cgst,
        sgstPaise: t.sgst,
        roundOffPaise: t.roundOff,
        totalPaise: t.total,
        paymentMethod: "cash",
        gstRateBp: state.tax.gstRateBp,
        serviceChargeBp: state.tax.serviceChargeBp,
      };
      outcome = await printReceipt(data, { duplicate: true });
    } else {
      const data: KotData = { orderType: "dine_in", tableLabel: "T1", at: now, cashier: "Test", lines: sample.map((l) => ({ name: l.name, qty: l.qty, veg: l.veg })) };
      outcome = await printKot(data);
    }
    setResult({ what, outcome });
  };

  const missing = (name: string | null) => !!name && printers !== null && !printers.some((p) => p.name === name);

  if (!isDesktop) {
    return (
      <SettingsSection icon="print" title="Printing" subtitle="Receipt and kitchen ticket printers">
        <p className="rounded-xl bg-surface-low p-4 text-body-md text-muted">
          Choosing a printer is available in the desktop app. In a browser, printing opens the browser&apos;s print dialog.
        </p>
      </SettingsSection>
    );
  }

  const busy = result?.outcome === "working";

  return (
    <div className="space-y-4">
      <SettingsSection
        icon="print"
        title="Receipt printer"
        subtitle="Bills print here as soon as you confirm payment, with no dialog."
        actions={
          <Button size="sm" variant="soft" icon="refresh" onClick={() => load(() => true)}>
            Refresh list
          </Button>
        }
      >
        <PrinterList
          printers={printers}
          value={receipt}
          nullLabel="Ask every time"
          nullHint="Opens the Windows print dialog for each bill"
          onChange={(name) => set({ receipt: name })}
          listError={listError}
        />
        {missing(receipt) && <Warn name={receipt!} />}
      </SettingsSection>

      <SettingsSection icon="soup_kitchen" title="Kitchen (KOT) printer" subtitle="Kitchen tickets list new items only, with no prices.">
        <PrinterList
          printers={printers}
          value={kot}
          nullLabel="Same as the receipt printer"
          nullHint={receipt ? `Uses ${receipt}` : "Uses the receipt setting above"}
          onChange={(name) => set({ kot: name })}
          listError={listError}
        />
        {missing(kot) && <Warn name={kot!} />}
      </SettingsSection>

      <SettingsSection icon="task_alt" title="Check it works" subtitle={`Prints a short sample on ${state.profile.paperWidthMm}mm paper. Change the width in Settings → Receipt.`}>
        <div className="flex flex-wrap gap-3">
          <Button variant="charcoal" icon="receipt_long" disabled={busy} onClick={() => test("receipt")}>
            Print test receipt
          </Button>
          <Button variant="secondary" icon="soup_kitchen" disabled={busy} onClick={() => test("kot")}>
            Print test kitchen ticket
          </Button>
        </div>
        {result && <ResultLine result={result} />}
        <p className="mt-4 text-body-sm text-muted">
          Tip: install the printer&apos;s Windows driver first, set its paper size to the roll width, and turn off any &quot;fit to page&quot; option in the driver.
        </p>
      </SettingsSection>
    </div>
  );
}

function ResultLine({ result }: { result: { what: string; outcome: PrintOutcome | "working" } }) {
  const o = result.outcome;
  const working = o === "working";
  const tone = working ? "bg-surface-container" : o.ok ? (o.cancelled ? "bg-hold-surface text-hold-ink" : "bg-[#dcfce7] text-tertiary") : "bg-error-container text-on-error-container";
  const icon = working ? "progress_activity" : o.ok ? "check_circle" : "error";
  return (
    <div role="status" className={cx("mt-4 flex items-start gap-2 rounded-xl px-4 py-3 text-body-md", tone)}>
      <Icon name={icon} className={cx("text-[20px]", working && "animate-spin")} />
      {working ? "Printing…" : describeOutcome(o, result.what === "kot" ? "Kitchen ticket" : "Receipt").text}
    </div>
  );
}

function Warn({ name }: { name: string }) {
  return (
    <p className="mt-3 flex items-center gap-2 rounded-xl bg-hold-surface px-4 py-3 text-body-md text-hold-ink">
      <Icon name="warning" /> {name} is not connected right now. Printing will fail until it is plugged in and turned on, or you choose another printer.
    </p>
  );
}

function PrinterList({
  printers,
  value,
  nullLabel,
  nullHint,
  onChange,
  listError,
}: {
  printers: PrinterInfo[] | null;
  value: string | null;
  nullLabel: string;
  nullHint: string;
  onChange: (name: string | null) => void;
  listError: string | null;
}) {
  return (
    <div role="radiogroup" className="space-y-2">
      <Option selected={value === null} icon="help" title={nullLabel} hint={nullHint} onClick={() => onChange(null)} />
      {printers === null && <div className="px-2 py-3 text-body-md text-muted">Looking for printers…</div>}
      {printers?.length === 0 && (
        <div className="rounded-xl bg-surface-low px-4 py-3 text-body-md text-muted">
          {listError ?? "No printers found. Install your printer's driver in Windows, then press Refresh list."}
        </div>
      )}
      {printers?.map((p) => (
        <Option
          key={p.name}
          selected={value === p.name}
          icon="print"
          title={p.displayName}
          hint={p.displayName !== p.name ? p.name : undefined}
          badge={p.isDefault ? <Badge tone="neutral">Windows default</Badge> : undefined}
          onClick={() => onChange(p.name)}
        />
      ))}
      {value && printers && !printers.some((p) => p.name === value) && (
        <Option selected icon="print_disabled" title={value} hint="Saved choice (not connected)" onClick={() => onChange(value)} />
      )}
    </div>
  );
}

function Option({
  selected,
  icon,
  title,
  hint,
  badge,
  onClick,
}: {
  selected: boolean;
  icon: string;
  title: string;
  hint?: string;
  badge?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-colors",
        selected ? "border-primary bg-[#fdf3ee]" : "border-line bg-surface-lowest hover:border-line-strong",
      )}
    >
      <Icon name={selected ? "radio_button_checked" : "radio_button_unchecked"} className={cx("text-[22px]", selected ? "text-primary" : "text-muted")} />
      <span className={cx("flex h-10 w-10 items-center justify-center rounded-lg", selected ? "bg-primary text-white" : "bg-surface-container")}>
        <Icon name={icon} className="text-[22px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-label-lg">
          {title} {badge}
        </span>
        {hint && <span className="block truncate text-body-sm text-muted">{hint}</span>}
      </span>
    </button>
  );
}
