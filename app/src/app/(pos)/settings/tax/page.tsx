"use client";

import { useState } from "react";
import { SaveBar, SettingsSection } from "@/components/settings-ui";
import { Field, Icon, Toggle, cx, inputClass } from "@/components/ui";
import { bpToPercentLabel, calcBill } from "@/lib/billing";
import { formatINR } from "@/lib/money";
import { usePos } from "@/lib/pos-store";

const RATES = [0, 500, 1200, 1800];

// GST & tax settings (PRD S-2, B-9; TRD §4)
export default function TaxSettingsPage() {
  const { state, dispatch } = usePos();
  const [tax, setTax] = useState(state.tax);
  const [hsn, setHsn] = useState(state.profile.hsnSac);
  const [custom, setCustom] = useState(!RATES.includes(state.tax.gstRateBp));
  const dirty = JSON.stringify(tax) !== JSON.stringify(state.tax) || hsn !== state.profile.hsnSac;
  const example = calcBill([{ unitPricePaise: 100000, qty: 1 }], tax);

  return (
    <div className="space-y-4">
      <SettingsSection icon="account_balance" title="GST" subtitle="Choose the rate that applies to your restaurant. Ask your accountant if unsure.">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-label-lg">GST rate</span>
          <span className="text-label-md text-primary">
            Selected: {bpToPercentLabel(tax.gstRateBp)} (CGST {bpToPercentLabel(tax.gstRateBp / 2)} + SGST {bpToPercentLabel(tax.gstRateBp / 2)})
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {RATES.map((r) => {
            const active = !custom && tax.gstRateBp === r;
            return (
              <button
                key={r}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setCustom(false);
                  setTax({ ...tax, gstRateBp: r });
                }}
                className={cx(
                  "flex h-11 items-center gap-2 rounded-full px-5 text-label-lg transition-colors",
                  active ? "bg-primary text-white shadow-level2" : "bg-surface-low text-ink-variant hover:bg-surface-high",
                )}
              >
                {active && <Icon name="check_circle" className="text-[18px]" />}
                {bpToPercentLabel(r)}
                {r === 500 && <span className="text-label-md opacity-80">· most restaurants</span>}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={custom}
            onClick={() => setCustom(true)}
            className={cx("h-11 rounded-full px-5 text-label-lg", custom ? "bg-primary text-white" : "bg-surface-low text-ink-variant hover:bg-surface-high")}
          >
            Custom
          </button>
          {custom && (
            <div className="relative w-32">
              <input
                inputMode="decimal"
                aria-label="Custom GST rate"
                value={tax.gstRateBp / 100}
                onChange={(e) => setTax({ ...tax, gstRateBp: Math.round((Number.parseFloat(e.target.value) || 0) * 100) })}
                className={cx(inputClass, "h-11 pr-8")}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">%</span>
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between rounded-xl bg-surface-low p-4">
          <div>
            <div className="text-label-lg">Menu prices include GST</div>
            <div className="text-body-md text-muted">
              When on, the menu price is what the customer pays and GST is calculated backwards from it.
            </div>
          </div>
          <Toggle checked={tax.pricesIncludeTax} onChange={(v) => setTax({ ...tax, pricesIncludeTax: v })} label="Menu prices include GST" />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-5">
          <Field label="SAC code" hint="996331 = restaurant services">
            <input value={hsn} onChange={(e) => setHsn(e.target.value.replace(/\D/g, "").slice(0, 8))} className={`${inputClass} font-mono`} />
          </Field>
          <div className="rounded-xl bg-surface-low p-4 text-body-md">
            <div className="mb-1 text-label-md uppercase text-muted">Example: ₹1,000 of food</div>
            <div className="tnum flex justify-between"><span>CGST + SGST</span><span>{formatINR(example.cgst + example.sgst)}</span></div>
            {example.serviceCharge > 0 && (
              <div className="tnum flex justify-between"><span>Service charge</span><span>{formatINR(example.serviceCharge)}</span></div>
            )}
            <div className="tnum flex justify-between font-bold"><span>Customer pays</span><span>{formatINR(example.total)}</span></div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection icon="room_service" title="Service charge" subtitle="Optional charge added before GST">
        <div className="flex items-center justify-between rounded-xl bg-surface-low p-4">
          <div>
            <div className="text-label-lg">Add a service charge to bills</div>
            <div className="text-body-md text-muted">Off by default. Shown as its own line on the bill.</div>
          </div>
          <Toggle checked={tax.serviceChargeEnabled} onChange={(v) => setTax({ ...tax, serviceChargeEnabled: v })} label="Service charge" />
        </div>
        <div className={cx("mt-4 flex items-center gap-3", !tax.serviceChargeEnabled && "opacity-40")}>
          <span className="text-label-lg">Rate</span>
          <div className="relative w-28">
            <input
              inputMode="decimal"
              aria-label="Service charge rate"
              disabled={!tax.serviceChargeEnabled}
              value={tax.serviceChargeBp / 100}
              onChange={(e) => setTax({ ...tax, serviceChargeBp: Math.round((Number.parseFloat(e.target.value) || 0) * 100) })}
              className={cx(inputClass, "h-11 pr-8")}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">%</span>
          </div>
        </div>
        <div className="mt-4 flex gap-3 rounded-xl bg-hold-surface p-4 text-body-md text-hold-ink">
          <Icon name="gavel" />
          <div>
            <b>Consumer protection rule:</b> under CCPA guidelines (2022) a service charge must be voluntary. It can&apos;t be added by default,
            and staff must remove it if the customer asks. Check the current rules before turning this on.
          </div>
        </div>
      </SettingsSection>

      <SaveBar
        dirty={dirty}
        onSave={() => {
          dispatch({ type: "setTax", tax });
          dispatch({ type: "setProfile", profile: { ...state.profile, hsnSac: hsn } });
        }}
        onDiscard={() => {
          setTax(state.tax);
          setHsn(state.profile.hsnSac);
        }}
      />
    </div>
  );
}
