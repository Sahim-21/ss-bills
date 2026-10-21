"use client";

import { useMemo, useState } from "react";
import { Receipt, type ReceiptData } from "@/components/receipt";
import { SaveBar, SettingsSection } from "@/components/settings-ui";
import { Card, Field, Icon, Segmented, Toggle, cx } from "@/components/ui";
import { calcBill, financialYear, formatBillNo } from "@/lib/billing";
import { usePos } from "@/lib/pos-store";

const textareaClass =
  "w-full resize-none rounded-xl bg-surface-low px-4 py-3 font-mono text-[13px] leading-6 text-ink outline-none focus:bg-surface-lowest focus:ring-2 focus:ring-primary";

// Receipt customization with live preview (PRD S-3)
export default function ReceiptSettingsPage() {
  const { state, dispatch } = usePos();
  const [p, setP] = useState(state.profile);
  const dirty = JSON.stringify(p) !== JSON.stringify(state.profile);
  const chars = p.paperWidthMm === 80 ? 48 : 32;

  const sample: ReceiptData = useMemo(() => {
    const pick = (id: string, qty: number) => {
      const m = state.menu.find((x) => x.id === id)!;
      return { itemId: m.id, name: m.name, unitPricePaise: m.pricePaise, veg: m.veg, qty, kotQty: qty };
    };
    const lines = [pick("m6", 2), pick("m12", 3), pick("m17", 1), pick("m27", 1)];
    const t = calcBill(lines, state.tax);
    const now = new Date();
    return {
      billNo: formatBillNo(financialYear(now), state.nextSeq),
      at: now.toISOString(),
      orderType: "dine_in",
      tableLabel: "T4",
      cashier: "Ramesh Kumar",
      lines,
      subtotalPaise: t.subtotal,
      serviceChargePaise: t.serviceCharge,
      cgstPaise: t.cgst,
      sgstPaise: t.sgst,
      roundOffPaise: t.roundOff,
      totalPaise: t.total,
      paymentMethod: "upi",
      gstRateBp: state.tax.gstRateBp,
      serviceChargeBp: state.tax.serviceChargeBp,
    };
  }, [state.menu, state.tax, state.nextSeq]);

  const longest = (text: string) => Math.max(0, ...text.split("\n").map((l) => l.length));

  return (
    <div className="grid grid-cols-[1fr_440px] gap-4">
      <div>
        <SettingsSection icon="receipt" title="Receipt" subtitle="Layout of printed bills for 80mm and 58mm thermal printers">
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-label-lg">Paper width</span>
                <span className="text-body-sm text-muted">About {chars} characters per line</span>
              </div>
              <Segmented
                value={String(p.paperWidthMm)}
                onChange={(v) => setP({ ...p, paperWidthMm: Number(v) as 58 | 80 })}
                options={[
                  { value: "80", label: "80mm (standard)", icon: "receipt_long" },
                  { value: "58", label: "58mm (compact)", icon: "receipt" },
                ]}
              />
            </div>
            <div className="flex items-center justify-between rounded-xl bg-surface-low p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-surface-lowest font-extrabold text-primary">SG</span>
                <div>
                  <div className="text-label-lg">Show logo on receipt</div>
                  <div className="text-body-sm text-muted">Printed in black & white</div>
                </div>
              </div>
              <Toggle checked={p.showLogo} onChange={(v) => setP({ ...p, showLogo: v })} label="Show logo on receipt" />
            </div>
            <Field label="Header text" hint={<span className={cx(longest(p.receiptHeader) > chars && "text-error")}>Up to {chars} characters per line</span>}>
              <textarea rows={4} value={p.receiptHeader} onChange={(e) => setP({ ...p, receiptHeader: e.target.value })} className={textareaClass} />
            </Field>
            <Field label="Footer text" hint="Printed at the bottom">
              <textarea rows={3} value={p.receiptFooter} onChange={(e) => setP({ ...p, receiptFooter: e.target.value })} className={textareaClass} />
            </Field>
            <p className="flex items-center gap-2 text-body-sm text-muted">
              <Icon name="info" className="text-[18px]" /> GSTIN, FSSAI and SAC come from Restaurant profile and GST settings.
            </p>
          </div>
        </SettingsSection>
        <SaveBar dirty={dirty} onSave={() => dispatch({ type: "setProfile", profile: p })} onDiscard={() => setP(state.profile)} />
      </div>

      <Card className="sticky top-0 self-start overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="flex items-center gap-2 text-label-lg">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary-container" /> Live preview
          </span>
          <span className="text-body-sm text-muted">{p.paperWidthMm}mm</span>
        </div>
        <div className="scroll-thin max-h-[calc(100vh-12rem)] overflow-y-auto bg-surface-container py-6">
          <Receipt data={sample} profile={p} width={p.paperWidthMm} />
        </div>
      </Card>
    </div>
  );
}
