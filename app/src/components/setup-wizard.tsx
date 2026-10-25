"use client";

// First-run setup (replaces the old demo seeding, D-021). Shown only when the database has no staff yet.
// Creates the restaurant, its first Admin, GST settings, starter categories and tables in one transaction.
import { useState } from "react";
import { bpToPercentLabel } from "@/lib/billing";
import type { SsbillsApi } from "@/lib/desktop";
import { CloudRestore } from "./cloud-restore";
import { Button, Field, Icon, Toggle, cx, inputClass } from "./ui";

const STEPS = [
  { title: "Your restaurant", icon: "storefront" },
  { title: "GST", icon: "account_balance" },
  { title: "Admin account", icon: "admin_panel_settings" },
  { title: "Menu & tables", icon: "restaurant_menu" },
] as const;

const RATES = [0, 500, 1200, 1800];
const STARTER_CATEGORIES = ["Starters", "Main Course", "Breads", "Rice & Biryani", "South Indian", "Chinese", "Beverages", "Desserts"];
const DEFAULT_ON = new Set(["Starters", "Main Course", "Breads", "Rice & Biryani", "Beverages", "Desserts"]);
const WEAK_PINS = new Set(["0000", "1111", "1234", "4321", "2222", "9999"]);
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function SetupWizard({
  api,
  onDone,
  onSampleData,
}: {
  api: SsbillsApi;
  onDone: () => void;
  onSampleData: () => Promise<unknown>;
}) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [gstin, setGstin] = useState("");
  const [fssai, setFssai] = useState("");

  const [gstRateBp, setGstRateBp] = useState(500);
  const [pricesIncludeTax, setPricesIncludeTax] = useState(false);

  const [adminName, setAdminName] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");

  const [cats, setCats] = useState<string[]>(STARTER_CATEGORIES.filter((c) => DEFAULT_ON.has(c)));
  const [extra, setExtra] = useState("");
  const [tableCount, setTableCount] = useState(8);

  const gstinOk = !gstin || GSTIN.test(gstin);
  const fssaiOk = !fssai || /^\d{14}$/.test(fssai);
  const valid = [
    name.trim() && address.trim() && gstinOk && fssaiOk,
    true,
    adminName.trim() && /^\d{4}$/.test(pin) && pin === pin2,
    tableCount >= 0 && tableCount <= 100,
  ];

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const nm = name.trim();
      await api.call("completeSetup", {
        profile: {
          name: nm,
          tagline: tagline.trim(),
          address: address.trim(),
          phone: phone.trim(),
          gstin,
          fssai,
          hsnSac: "996331",
          receiptHeader: [nm, tagline.trim(), address.trim(), phone.trim() && `Tel: ${phone.trim()}`].filter(Boolean).join("\n"),
          receiptFooter: "Thank you!\nVisit again",
          showLogo: true,
          paperWidthMm: 80,
        },
        tax: { gstRateBp, pricesIncludeTax, serviceChargeEnabled: false, serviceChargeBp: 500 },
        admin: { id: uid("u"), name: adminName.trim(), pin },
        categories: cats.map((c) => ({ id: uid("c"), name: c })),
        tableCount,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup failed");
      setBusy(false);
    }
  }

  async function sample() {
    setBusy(true);
    setError(null);
    try {
      await onSampleData();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the sample restaurant");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="flex h-20 items-center px-8">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary-container to-primary text-white shadow-level2">
            <Icon name="receipt_long" className="icon-fill" />
          </span>
          <div>
            <div className="text-headline-md leading-6">SS Bills</div>
            <div className="text-body-sm text-muted">Restaurant billing</div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 pb-10">
        <h1 className="text-center text-[34px] font-extrabold tracking-tight">Let&apos;s set up your restaurant</h1>
        <p className="mt-1 text-center text-body-lg text-muted">Four quick steps. You can change everything later in Settings.</p>

        {step === 0 && <CloudRestore api={api} onDone={onDone} />}

        <ol className="mt-7 flex items-center justify-center gap-2" aria-label="Setup progress">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex items-center gap-2" aria-current={i === step ? "step" : undefined}>
              <span
                className={cx(
                  "flex h-10 items-center gap-2 rounded-full px-4 text-label-md",
                  i === step ? "bg-primary text-white shadow-level2" : i < step ? "bg-[#dcfce7] text-tertiary" : "bg-surface-container text-muted",
                )}
              >
                <Icon name={i < step ? "check" : s.icon} className="text-[18px]" />
                <span className="hidden sm:inline">{s.title}</span>
                <span className="sm:hidden">{i + 1}</span>
              </span>
              {i < STEPS.length - 1 && <span className="h-px w-5 bg-line-strong" />}
            </li>
          ))}
        </ol>

        <div className="mt-6 overflow-hidden rounded-3xl bg-surface-lowest shadow-level3">
          <div className="h-1.5 bg-gradient-to-r from-primary via-primary-container to-tertiary-container" />
          <div className="p-8">
            {step === 0 && (
              <div className="grid grid-cols-2 gap-5">
                <div className="col-span-2">
                  <Field label="Restaurant name *" hint="Printed at the top of every bill">
                    <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. Spice Garden" />
                  </Field>
                </div>
                <div className="col-span-2">
                  <Field label="Tagline" hint="Optional">
                    <input value={tagline} onChange={(e) => setTagline(e.target.value)} className={inputClass} placeholder="e.g. Authentic Indian Cuisine" />
                  </Field>
                </div>
                <div className="col-span-2">
                  <Field label="Address *">
                    <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} placeholder="Street, area, city, PIN" />
                  </Field>
                </div>
                <Field label="Phone" hint="Optional">
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} inputMode="tel" />
                </Field>
                <Field label="GSTIN" hint={gstinOk ? "15 characters. Skip if not registered" : <span className="text-error">Doesn&apos;t look like a valid GSTIN</span>}>
                  <input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase().slice(0, 15))} className={cx(inputClass, "font-mono", !gstinOk && "ring-2 ring-error")} placeholder="29AAAAA0000A1Z5" />
                </Field>
                <Field label="FSSAI licence no." hint={fssaiOk ? "14 digits, optional" : <span className="text-error">Must be 14 digits</span>}>
                  <input value={fssai} onChange={(e) => setFssai(e.target.value.replace(/\D/g, "").slice(0, 14))} className={cx(inputClass, "font-mono", !fssaiOk && "ring-2 ring-error")} inputMode="numeric" />
                </Field>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-label-lg">GST rate on your bills</span>
                    <span className="text-label-md text-primary">
                      CGST {bpToPercentLabel(gstRateBp / 2)} + SGST {bpToPercentLabel(gstRateBp / 2)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="GST rate">
                    {RATES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        role="radio"
                        aria-checked={gstRateBp === r}
                        onClick={() => setGstRateBp(r)}
                        className={cx(
                          "flex h-12 items-center gap-2 rounded-full px-6 text-label-lg transition-colors",
                          gstRateBp === r ? "bg-primary text-white shadow-level2" : "bg-surface-low text-ink-variant hover:bg-surface-high",
                        )}
                      >
                        {gstRateBp === r && <Icon name="check_circle" className="text-[18px]" />}
                        {bpToPercentLabel(r)}
                        {r === 500 && <span className="text-label-md opacity-80">· most restaurants</span>}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-body-sm text-muted">Not sure? Ask your accountant. You can change this any time in Settings → GST & tax.</p>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-surface-low p-4">
                  <div className="pr-6">
                    <div className="text-label-lg">Menu prices already include GST</div>
                    <div className="text-body-md text-muted">
                      Off: GST is added on top of your menu prices. On: the menu price is what the customer pays.
                    </div>
                  </div>
                  <Toggle checked={pricesIncludeTax} onChange={setPricesIncludeTax} label="Menu prices include GST" />
                </div>
                <p className="flex items-start gap-2 text-body-sm text-muted">
                  <Icon name="info" className="text-[18px]" /> A service charge is off by default. You can turn it on later in Settings.
                </p>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <p className="text-body-md text-muted">
                  The Admin can edit the menu and prices, cancel bills, see reports, and add staff. You can add cashiers afterwards.
                </p>
                <Field label="Your name *">
                  <input autoFocus value={adminName} onChange={(e) => setAdminName(e.target.value)} className={inputClass} placeholder="e.g. Ananya Sharma" />
                </Field>
                <div className="grid grid-cols-2 gap-5">
                  <Field label="4-digit PIN *" hint="Used to log in">
                    <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} className={cx(inputClass, "font-mono tracking-[0.6em]")} />
                  </Field>
                  <Field
                    label="Confirm PIN *"
                    hint={pin2.length === 4 && pin2 !== pin ? <span className="text-error">PINs don&apos;t match</span> : undefined}
                  >
                    <input type="password" inputMode="numeric" autoComplete="off" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 4))} className={cx(inputClass, "font-mono tracking-[0.6em]", pin2.length === 4 && pin2 !== pin && "ring-2 ring-error")} />
                  </Field>
                </div>
                {WEAK_PINS.has(pin) && (
                  <p className="flex items-center gap-2 rounded-xl bg-hold-surface px-4 py-3 text-body-md text-hold-ink">
                    <Icon name="warning" /> That PIN is easy to guess. Pick something harder.
                  </p>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <div className="mb-2 text-label-lg">Menu categories</div>
                  <div className="flex flex-wrap gap-2">
                    {[...STARTER_CATEGORIES, ...cats.filter((c) => !STARTER_CATEGORIES.includes(c))].map((c) => {
                      const on = cats.includes(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setCats((cur) => (on ? cur.filter((x) => x !== c) : [...cur, c]))}
                          className={cx(
                            "flex h-11 items-center gap-2 rounded-full px-5 text-label-md transition-colors",
                            on ? "bg-charcoal text-white" : "border border-line bg-surface-lowest text-muted hover:bg-surface-low",
                          )}
                        >
                          {on && <Icon name="check" className="text-[16px]" />} {c}
                        </button>
                      );
                    })}
                  </div>
                  <form
                    className="mt-3 flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const v = extra.trim();
                      if (v && !cats.some((c) => c.toLowerCase() === v.toLowerCase())) setCats([...cats, v]);
                      setExtra("");
                    }}
                  >
                    <input value={extra} onChange={(e) => setExtra(e.target.value)} className={cx(inputClass, "h-11 max-w-xs")} placeholder="Add your own category" />
                    <Button type="submit" variant="soft" icon="add" disabled={!extra.trim()}>
                      Add
                    </Button>
                  </form>
                  <p className="mt-2 text-body-sm text-muted">You&apos;ll add your dishes and prices in Menu after setup.</p>
                </div>

                <div className="flex items-center justify-between gap-6 rounded-xl bg-surface-low p-4">
                  <div>
                    <div className="text-label-lg">Dining tables</div>
                    <div className="text-body-md text-muted">0 is fine for a takeaway-only counter. You can rename or add tables later.</div>
                  </div>
                  <div className="flex h-12 items-center rounded-xl bg-surface-lowest shadow-level1">
                    <button type="button" aria-label="Fewer tables" onClick={() => setTableCount((n) => Math.max(0, n - 1))} className="flex h-12 w-12 items-center justify-center rounded-xl hover:bg-surface-high">
                      <Icon name="remove" />
                    </button>
                    <span className="tnum w-12 text-center text-headline-md" aria-live="polite">{tableCount}</span>
                    <button type="button" aria-label="More tables" onClick={() => setTableCount((n) => Math.min(100, n + 1))} className="flex h-12 w-12 items-center justify-center rounded-xl hover:bg-surface-high">
                      <Icon name="add" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div role="alert" className="mt-5 rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container">
                {error}
              </div>
            )}

            <div className="mt-8 flex items-center justify-between">
              <Button variant="ghost" icon="arrow_back" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>
                Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button variant="primary" size="lg" disabled={!valid[step]} onClick={() => setStep(step + 1)}>
                  Continue <Icon name="arrow_forward" className="text-[22px]" />
                </Button>
              ) : (
                <Button variant="primary" size="lg" icon={busy ? "progress_activity" : "check_circle"} disabled={!valid[step] || busy} onClick={finish}>
                  {busy ? "Setting up…" : "Finish setup"}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 text-center text-body-md text-muted">
          Just want to look around?{" "}
          <button type="button" onClick={sample} disabled={busy} className="font-semibold text-primary hover:underline disabled:opacity-40">
            Try with a sample restaurant
          </button>
        </div>
      </div>
    </div>
  );
}
