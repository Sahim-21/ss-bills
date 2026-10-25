"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar, Breakdown, ErrorNote, PaymentFields, charge, useAction } from "@/components/console-ui";
import { AdminOnly, Badge, Button, Card, Field, Icon, cx, inputClass } from "@/components/ui";
import { fmtDate, istDate } from "@/lib/format";
import { useAsync, useCopy, useNowMs } from "@/lib/hooks";
import { formatINR, formatINRShort, rupeesToPaise } from "@/lib/money";
import { useApi, usePortal } from "@/lib/portal";
import type { CreatedClient } from "@/lib/types";

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const STEPS = ["Restaurant details", "Plan & license", "Done"];

export default function NewClientPage() {
  const api = useApi();
  const { me } = usePortal();
  const { data: plans } = useAsync(() => api.plans(), [api]);
  const { data: config } = useAsync(() => api.config(), [api]);
  const { data: cityData } = useAsync(() => api.clients({ limit: 1 }), [api]);
  const now = useNowMs();
  const { busy, error, run } = useAction();
  const { copy, copied } = useCopy();

  const [step, setStep] = useState(0);
  const [f, setF] = useState({ name: "", owner_name: "", phone: "", email: "", city: "", address: "", gstin: "", notes: "" });
  const [planId, setPlanId] = useState("yearly");
  const [startsOn, setStartsOn] = useState(istDate(0, new Date(now)));
  const [devices, setDevices] = useState<number | null>(null);
  const [received, setReceived] = useState(false);
  const [method, setMethod] = useState("upi");
  const [reference, setReference] = useState("");
  const [override, setOverride] = useState(false);
  const [amount, setAmount] = useState("");
  const [created, setCreated] = useState<CreatedClient | null>(null);

  if (me && me.role !== "super_admin") return <AdminOnly />;

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const gstin = f.gstin.trim().toUpperCase();
  const valid1 = f.name.trim() && f.owner_name.trim() && f.phone.trim() && EMAIL.test(f.email.trim()) && f.city.trim() && (!gstin || GSTIN.test(gstin));
  const sellable = (plans ?? []).filter((p) => p.active);
  const plan = sellable.find((p) => p.id === planId);
  const terminals = devices ?? plan?.max_devices ?? 1;
  const overridePaise = override && amount !== "" ? rupeesToPaise(amount) : null;
  const gstBp = config?.gst_bp ?? 1800;
  const c = plan ? charge(plan.price_paise, 1, gstBp, overridePaise) : null;
  const expiry = plan?.duration_days ? new Date(new Date(`${startsOn}T00:00:00+05:30`).getTime() + plan.duration_days * 86_400_000) : null;

  const welcome = created
    ? `Welcome to SS Bills, ${f.owner_name.split(" ")[0]}!\n\nYour license key: ${created.license_key}\n\n1. Install SS Bills on your billing counter PC.\n2. Open it and enter the key above when asked.\n3. Connect to the internet once so it can activate. After that it works offline.\n\nRestaurant: ${f.name}\nValid until: ${created.expires_at ? fmtDate(created.expires_at) : "lifetime"}\nTerminals: ${created.max_devices}`
    : "";

  function create() {
    return run(async () => {
      const r = await api.createClient({
        name: f.name.trim(), owner_name: f.owner_name.trim(), phone: f.phone.trim(), email: f.email.trim(), city: f.city.trim(),
        address: f.address.trim(), gstin, notes: f.notes.trim(), plan_id: planId, starts_on: startsOn, max_devices: terminals,
        payment: received ? { received: true, method, reference, amount_paise: overridePaise ?? undefined } : { received: false },
      });
      setCreated(r);
      setStep(2);
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <nav className="text-body-sm text-muted">
        <Link href="/clients/" className="hover:underline">Clients</Link> / <span className="text-ink">Add client</span>
      </nav>
      <div>
        <h1 className="text-headline-xl">Onboard a new restaurant</h1>
        <p className="mt-1 text-body-lg text-muted">Create their license, record the first payment, and hand over the key.</p>
      </div>

      <ol className="grid grid-cols-3 gap-3" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={cx("flex items-center gap-3 rounded-2xl border px-4 py-3", i === step ? "border-primary bg-[#fdf3ee]" : i < step ? "border-line bg-[#dcfce7]" : "border-line bg-surface-lowest")}>
            <span className={cx("flex h-8 w-8 items-center justify-center rounded-full text-label-lg", i < step ? "bg-tertiary text-white" : i === step ? "bg-primary text-white" : "bg-surface-container text-muted")}>
              {i < step ? <Icon name="check" className="text-[18px]" /> : i + 1}
            </span>
            <span className="text-label-lg">{s}</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card className="space-y-5 p-6">
          <div className="grid grid-cols-2 gap-5">
            <Field label="Restaurant / brand name *"><input autoFocus value={f.name} onChange={set("name")} className={inputClass} /></Field>
            <Field label="Owner / managing partner *"><input value={f.owner_name} onChange={set("owner_name")} className={inputClass} /></Field>
            <Field label="Primary phone *"><input value={f.phone} onChange={set("phone")} inputMode="tel" className={inputClass} placeholder="+91 98xxx xxxxx" /></Field>
            <Field label="Billing email *" hint={f.email && !EMAIL.test(f.email.trim()) ? <span className="text-error">Not a valid email</span> : undefined}>
              <input type="email" value={f.email} onChange={set("email")} className={cx(inputClass, f.email && !EMAIL.test(f.email.trim()) && "ring-2 ring-error")} />
            </Field>
          </div>
          <div>
            <div className="mb-2 text-label-lg">City *</div>
            <div className="flex flex-wrap items-center gap-2">
              {(cityData?.cities ?? []).map((ct) => (
                <button key={ct.city} type="button" aria-pressed={f.city === ct.city} onClick={() => setF({ ...f, city: ct.city })} className={cx("h-10 rounded-full px-4 text-label-md transition-colors", f.city === ct.city ? "bg-charcoal text-white" : "border border-line bg-surface-lowest text-muted hover:bg-surface-low")}>
                  {ct.city}
                </button>
              ))}
              <input aria-label="Other city" value={(cityData?.cities ?? []).some((x) => x.city === f.city) ? "" : f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="Another city…" className={cx(inputClass, "h-10 w-48")} />
            </div>
          </div>
          <Field label="Registered address"><textarea rows={2} value={f.address} onChange={set("address")} className="w-full resize-none rounded-xl bg-surface-low px-4 py-3 text-body-lg outline-none focus:bg-surface-lowest focus:ring-2 focus:ring-primary" /></Field>
          <div className="grid grid-cols-2 gap-5">
            <Field label="GSTIN" hint={gstin && !GSTIN.test(gstin) ? <span className="text-error">Not a valid GSTIN</span> : "Optional"}>
              <input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase().slice(0, 15) })} className={cx(inputClass, "font-mono", gstin && !GSTIN.test(gstin) && "ring-2 ring-error")} placeholder="27AABCP8812K1Z9" />
            </Field>
            <Field label="Internal notes" hint="Not shown to the client"><input value={f.notes} onChange={set("notes")} className={inputClass} placeholder="Referred by…, printer model…" /></Field>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" size="lg" disabled={!valid1} onClick={() => setStep(1)}>Continue <Icon name="arrow_forward" className="text-[22px]" /></Button>
          </div>
        </Card>
      )}

      {step === 1 && (
        <div className="grid grid-cols-[1fr_340px] gap-5">
          <Card className="space-y-6 p-6">
            <div>
              <h2 className="mb-3 text-headline-md">Choose a plan</h2>
              <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Plan">
                {sellable.map((p) => (
                  <button key={p.id} type="button" role="radio" aria-checked={planId === p.id} onClick={() => { setPlanId(p.id); setDevices(null); }} className={cx("flex flex-col items-start gap-2 rounded-2xl border-2 p-4 text-left transition-colors", planId === p.id ? "border-primary bg-[#fdf3ee] shadow-level2" : "border-line bg-surface-lowest hover:border-line-strong")}>
                    <span className="flex w-full items-center justify-between">
                      <span className="text-label-lg">{p.name}</span>
                      {p.id === "yearly" && <Badge tone="primary">Popular</Badge>}
                    </span>
                    <span className="tnum text-headline-lg">{formatINRShort(p.price_paise)}</span>
                    <span className="text-body-sm text-muted">{p.kind === "lifetime" ? "one-time, never expires" : p.kind === "yearly" ? "per year" : "per month"} · {p.max_devices} terminal{p.max_devices === 1 ? "" : "s"}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <Field label="License starts"><input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className={inputClass} /></Field>
              <Field label="Terminals allowed" hint={terminals > 1 ? <span className="text-hold-ink">Each PC keeps its own separate data: the menu is not shared and bill numbers repeat across PCs. Sell more than one only if the restaurant accepts that.</span> : "One PC per licence"}>
                <div className="flex h-12 items-center rounded-xl bg-surface-low">
                  <button type="button" aria-label="Fewer terminals" onClick={() => setDevices(Math.max(1, terminals - 1))} className="flex h-12 w-12 items-center justify-center rounded-xl hover:bg-surface-high"><Icon name="remove" /></button>
                  <span className="tnum flex-1 text-center text-headline-sm">{terminals}</span>
                  <button type="button" aria-label="More terminals" onClick={() => setDevices(Math.min(50, terminals + 1))} className="flex h-12 w-12 items-center justify-center rounded-xl hover:bg-surface-high"><Icon name="add" /></button>
                </div>
              </Field>
              <div>
                <div className="mb-1.5 text-label-lg">Valid until</div>
                <div className="flex h-12 items-center rounded-xl bg-surface-low px-4 tnum text-label-lg">{plan?.kind === "lifetime" ? "Never (lifetime)" : expiry ? fmtDate(expiry) : "—"}</div>
              </div>
            </div>

            <div className="rounded-2xl border border-line p-4">
              <label className="flex cursor-pointer items-center gap-3 text-label-lg">
                <input type="checkbox" checked={received} onChange={(e) => setReceived(e.target.checked)} className="h-5 w-5 accent-[var(--color-primary)]" />
                Payment already received
              </label>
              {received && (
                <div className="mt-4 space-y-4">
                  <PaymentFields method={method} setMethod={setMethod} reference={reference} setReference={setReference} />
                  <label className="flex cursor-pointer items-center gap-3 text-label-lg">
                    <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="h-5 w-5 accent-[var(--color-primary)]" />
                    The agreed amount is different
                  </label>
                  {override && (
                    <div className="flex items-center gap-2">
                      <span className="text-body-lg text-muted">₹</span>
                      <input aria-label="Agreed total including GST" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className={cx(inputClass, "tnum")} placeholder="Final amount received, GST included" />
                    </div>
                  )}
                </div>
              )}
              {!received && <p className="mt-2 text-body-sm text-muted">Leave unticked to issue the key now and record the payment later (Renew).</p>}
            </div>

            {error && <ErrorNote message={error} />}
            <div className="flex items-center justify-between">
              <Button variant="ghost" icon="arrow_back" onClick={() => setStep(0)}>Back</Button>
              <Button variant="primary" size="lg" icon={busy ? "progress_activity" : "key"} disabled={busy || !plan || (received && override && amount === "")} onClick={create}>
                {busy ? "Creating…" : "Generate license & finish"}
              </Button>
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="p-5">
              <div className="mb-3 flex items-center gap-3">
                <Avatar name={f.name || "?"} size={40} />
                <div className="min-w-0"><div className="truncate text-label-lg">{f.name}</div><div className="text-body-sm text-muted">{f.city}</div></div>
              </div>
              {c && plan && (
                <Breakdown rows={[[plan.name, formatINR(c.subtotal)], [`GST ${(gstBp / 100).toFixed(0)}%`, formatINR(c.gst)]]} total={c.total} />
              )}
              <p className="mt-3 text-body-sm text-muted">{received ? "This will be recorded as received." : "Nothing is recorded until you mark it as paid."}</p>
            </Card>
          </div>
        </div>
      )}

      {step === 2 && created && (
        <div className="space-y-5">
          <Card className="p-8 text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#dcfce7] text-tertiary"><Icon name="verified" className="icon-fill text-[36px]" /></span>
            <h2 className="mt-4 text-headline-xl">{f.name} is ready</h2>
            <p className="mt-1 text-body-lg text-muted">{created.code} · {plans?.find((p) => p.id === created.plan)?.name} · {created.max_devices} terminal{created.max_devices === 1 ? "" : "s"} · {created.expires_at ? `valid until ${fmtDate(created.expires_at)}` : "lifetime"}</p>
            <div className="mx-auto mt-6 max-w-xl rounded-2xl bg-surface-low p-5">
              <div className="text-label-sm uppercase tracking-wider text-muted">License key</div>
              <div className="mt-2 flex items-center justify-center gap-3">
                <code className="font-mono text-[28px] font-extrabold tracking-[0.12em]">{created.license_key}</code>
                <Button variant="primary" icon={copied === "key" ? "check" : "content_copy"} onClick={() => copy(created.license_key, "key")}>{copied === "key" ? "Copied" : "Copy"}</Button>
              </div>
            </div>
            <div className="mt-4 flex justify-center gap-3">
              <Button variant="secondary" icon={copied === "msg" ? "check" : "chat"} onClick={() => copy(welcome, "msg")}>{copied === "msg" ? "Copied" : "Copy welcome message"}</Button>
              <a href={`mailto:${f.email}?subject=${encodeURIComponent("Your SS Bills license")}&body=${encodeURIComponent(welcome)}`}><Button variant="secondary" icon="mail">Email it</Button></a>
              <Link href={`/clients/view/?id=${created.restaurant_id}`}><Button variant="charcoal" icon="storefront">Open client</Button></Link>
            </div>
          </Card>
          <Card className="p-6">
            <h3 className="text-headline-md">What the restaurant does</h3>
            <ol className="mt-4 grid grid-cols-3 gap-4">
              {["Install SS Bills on the billing counter PC.", "Open it and type the license key above.", "Connect to the internet once so it can activate. After that it works offline."].map((t, i) => (
                <li key={t} className="flex gap-3 rounded-xl bg-surface-low p-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-fixed text-label-lg text-primary">{i + 1}</span>
                  <span className="text-body-md">{t}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}
    </div>
  );
}
