"use client";

import { useState } from "react";
import { SaveBar, SettingsSection } from "@/components/settings-ui";
import { Field, inputClass } from "@/components/ui";
import { usePos } from "@/lib/pos-store";

// Restaurant profile (PRD S-1)
export default function ProfileSettingsPage() {
  const { state, dispatch } = usePos();
  const [p, setP] = useState(state.profile);
  const dirty = JSON.stringify(p) !== JSON.stringify(state.profile);
  const set = (k: keyof typeof p) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: e.target.value });

  return (
    <>
      <SettingsSection icon="storefront" title="Restaurant profile" subtitle="Printed on every bill and used for GST invoices">
        <div className="grid grid-cols-2 gap-5">
          <Field label="Restaurant name *">
            <input value={p.name} onChange={set("name")} className={inputClass} />
          </Field>
          <Field label="Tagline" hint="Optional">
            <input value={p.tagline} onChange={set("tagline")} className={inputClass} />
          </Field>
          <div className="col-span-2">
            <Field label="Address *">
              <input value={p.address} onChange={set("address")} className={inputClass} />
            </Field>
          </div>
          <Field label="Phone">
            <input value={p.phone} onChange={set("phone")} className={inputClass} />
          </Field>
          <Field label="GSTIN" hint="15 characters">
            <input value={p.gstin} onChange={(e) => setP({ ...p, gstin: e.target.value.toUpperCase().slice(0, 15) })} className={`${inputClass} font-mono`} />
          </Field>
          <Field label="FSSAI licence no." hint="14 digits">
            <input value={p.fssai} onChange={(e) => setP({ ...p, fssai: e.target.value.replace(/\D/g, "").slice(0, 14) })} className={`${inputClass} font-mono`} />
          </Field>
          <Field label="Logo" hint="Shown on receipts (monochrome)">
            <div className="flex h-12 items-center gap-3 rounded-xl border-2 border-dashed border-line px-4 text-body-md text-muted">
              Logo upload comes with the database phase
            </div>
          </Field>
        </div>
      </SettingsSection>
      <SaveBar dirty={dirty} onSave={() => dispatch({ type: "setProfile", profile: p })} onDiscard={() => setP(state.profile)} />
    </>
  );
}
