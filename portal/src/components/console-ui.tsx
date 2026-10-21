"use client";

import { useState, type ReactNode } from "react";
import { fmtDate, initials, STATE_LABEL, STATE_TONE } from "@/lib/format";
import { formatINR, formatINRShort, rupeesToPaise } from "@/lib/money";
import { useApi, usePortal } from "@/lib/portal";
import { useAsync, useNowMs } from "@/lib/hooks";
import { PAYMENT_METHODS, type ClientDetail, type LicenseState } from "@/lib/types";
import { Badge, Button, Field, Icon, Modal, cx, inputClass } from "./ui";

export function StateBadge({ state }: { state: LicenseState }) {
  return (
    <Badge tone={STATE_TONE[state]}>
      <span className={cx("h-1.5 w-1.5 rounded-full", state === "active" ? "bg-tertiary" : state === "expiring" || state === "grace" ? "bg-hold" : "bg-error")} />
      {STATE_LABEL[state]}
    </Badge>
  );
}

export function PlanBadge({ name, kind }: { name: string; kind?: string }) {
  return <Badge tone={kind === "lifetime" || name.toLowerCase().includes("lifetime") ? "charcoal" : "neutral"}>{name}</Badge>;
}

export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-xl bg-primary-fixed font-bold text-primary" style={{ width: size, height: size, fontSize: size * 0.34 }}>
      {initials(name)}
    </span>
  );
}

export function ErrorNote({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container">
      {message}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted">
      <Icon name="progress_activity" className="animate-spin text-[22px] text-primary" /> {label}
    </div>
  );
}

/** Wrap a page's data states: error, first load, then the content. */
export function Async({ error, loading, hasData, children, onRetry }: { error?: string; loading: boolean; hasData: boolean; children: ReactNode; onRetry?: () => void }) {
  if (error && !hasData)
    return (
      <div className="mx-auto max-w-lg py-16">
        <ErrorNote message={error} />
        {onRetry && (
          <div className="mt-4 text-center">
            <Button variant="secondary" icon="refresh" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
      </div>
    );
  if (!hasData && loading) return <Loading />;
  return <>{children}</>;
}

/** Run an action, track busy/error, and call `then` when it works. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (job: () => Promise<unknown>, then?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await job();
      then?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

export function DialogShell({ open, onClose, title, subtitle, children, width = "max-w-lg" }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; width?: string }) {
  return (
    <Modal open={open} onClose={onClose} className={width} labelledBy="dlg-title">
      <div className="flex items-start justify-between border-b border-line px-6 py-4">
        <div>
          <h2 id="dlg-title" className="text-headline-md">{title}</h2>
          {subtitle && <p className="text-body-md text-muted">{subtitle}</p>}
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-surface-high">
          <Icon name="close" />
        </button>
      </div>
      <div className="p-6">{children}</div>
    </Modal>
  );
}

// ------------------------------------------------------------------ money preview
/** Mirrors calc_charge() in the database so the preview matches what is recorded. */
export function charge(pricePaise: number, periods: number, gstBp: number, overridePaise: number | null) {
  if (overridePaise !== null) {
    const gst = overridePaise - Math.round((overridePaise * 10000) / (10000 + gstBp));
    return { subtotal: overridePaise - gst, gst, total: overridePaise };
  }
  const subtotal = pricePaise * periods;
  const gst = Math.round((subtotal * gstBp) / 10000);
  return { subtotal, gst, total: subtotal + gst };
}

export function Breakdown({ rows, total }: { rows: [string, string][]; total: number }) {
  return (
    <div className="rounded-xl bg-surface-low p-4 text-body-md">
      {rows.map(([k, v]) => (
        <div key={k} className="tnum flex justify-between py-0.5 text-ink-variant">
          <span>{k}</span>
          <span>{v}</span>
        </div>
      ))}
      <div className="mt-2 flex items-end justify-between border-t border-line pt-2">
        <span className="text-label-lg">Total payable</span>
        <span className="tnum text-price-lg text-primary">{formatINR(total)}</span>
      </div>
    </div>
  );
}

export function PaymentFields({
  method, setMethod, reference, setReference,
}: { method: string; setMethod: (m: string) => void; reference: string; setReference: (r: string) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-2 text-label-lg">How was it paid?</div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Payment method">
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={method === m.id}
              onClick={() => setMethod(m.id)}
              className={cx("h-10 rounded-full px-4 text-label-md transition-colors", method === m.id ? "bg-charcoal text-white" : "border border-line bg-surface-lowest text-muted hover:bg-surface-low")}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <Field label="Reference" hint="UTR, cheque number, note (optional)">
        <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} placeholder="e.g. UTR 4000123456" />
      </Field>
    </div>
  );
}

// ------------------------------------------------------------------ renew
export function RenewForm({
  restaurantId, name, currentPlanId, expiresAt, suspended, onDone, onCancel,
}: {
  restaurantId: string; name: string; currentPlanId: string; expiresAt: string | null; suspended: boolean;
  onDone: () => void; onCancel: () => void;
}) {
  const api = useApi();
  const { data: plans } = useAsync(() => api.plans(), [api]);
  const { data: config } = useAsync(() => api.config(), [api]);
  const [planId, setPlanId] = useState(currentPlanId === "lifetime" ? "yearly" : currentPlanId);
  const [periods, setPeriods] = useState(1);
  const [method, setMethod] = useState("upi");
  const [reference, setReference] = useState("");
  const [override, setOverride] = useState(false);
  const [amount, setAmount] = useState("");
  const [reactivate, setReactivate] = useState(true);
  const { busy, error, run } = useAction();

  const sellable = (plans ?? []).filter((p) => p.active);
  const plan = sellable.find((p) => p.id === planId);
  const lifetime = plan?.kind === "lifetime";
  const n = lifetime ? 1 : periods;
  const overridePaise = override && amount !== "" ? rupeesToPaise(amount) : null;
  const gstBp = config?.gst_bp ?? 1800;
  const c = plan ? charge(plan.price_paise, n, gstBp, overridePaise) : null;
  const now = useNowMs();
  const base = expiresAt ? Math.max(new Date(expiresAt).getTime(), now) : now;
  const newExpiry = plan && !lifetime && plan.duration_days ? new Date(base + plan.duration_days * n * 86_400_000) : null;

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-label-lg">Plan</div>
        <div className="space-y-2" role="radiogroup" aria-label="Plan">
          {sellable.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={planId === p.id}
              onClick={() => setPlanId(p.id)}
              className={cx("flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-colors", planId === p.id ? "border-primary bg-[#fdf3ee]" : "border-line bg-surface-lowest hover:border-line-strong")}
            >
              <Icon name={planId === p.id ? "radio_button_checked" : "radio_button_unchecked"} className={cx("text-[22px]", planId === p.id ? "text-primary" : "text-muted")} />
              <span className="flex-1">
                <span className="block text-label-lg">{p.name}{p.id === currentPlanId && <span className="ml-2 text-label-sm text-muted">current</span>}</span>
                <span className="block text-body-sm text-muted">
                  {p.kind === "lifetime" ? "One-time, never expires" : `${p.duration_days} days`} · up to {p.max_devices} terminal{p.max_devices === 1 ? "" : "s"}
                </span>
              </span>
              <span className="tnum text-price-md">{formatINRShort(p.price_paise)}</span>
            </button>
          ))}
        </div>
      </div>

      {!lifetime && (
        <div className="flex items-center justify-between rounded-xl bg-surface-low p-4">
          <div>
            <div className="text-label-lg">How many {plan?.kind === "yearly" ? "years" : "periods"}?</div>
            <div className="text-body-sm text-muted">{newExpiry ? `New expiry: ${fmtDate(newExpiry)}` : ""}</div>
          </div>
          <div className="flex h-11 items-center rounded-lg bg-surface-lowest shadow-level1">
            <button type="button" aria-label="Fewer" onClick={() => setPeriods((x) => Math.max(1, x - 1))} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-surface-high"><Icon name="remove" /></button>
            <span className="tnum w-10 text-center text-headline-sm">{periods}</span>
            <button type="button" aria-label="More" onClick={() => setPeriods((x) => Math.min(12, x + 1))} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-surface-high"><Icon name="add" /></button>
          </div>
        </div>
      )}
      {lifetime && <p className="rounded-xl bg-surface-low p-4 text-body-md text-muted">Moving to a lifetime plan removes the expiry date.</p>}

      {c && (
        <Breakdown
          rows={[
            [`${plan!.name}${n > 1 ? ` × ${n}` : ""}`, formatINR(c.subtotal)],
            [`GST ${(gstBp / 100).toFixed(0)}%`, formatINR(c.gst)],
          ]}
          total={c.total}
        />
      )}

      <div className="rounded-xl border border-line p-3">
        <label className="flex cursor-pointer items-center gap-3 text-label-lg">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="h-5 w-5 accent-[var(--color-primary)]" />
          The agreed amount is different
        </label>
        {override && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-body-lg text-muted">₹</span>
            <input aria-label="Agreed total including GST" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className={cx(inputClass, "tnum")} placeholder="Final amount received, GST included" />
          </div>
        )}
      </div>

      <PaymentFields method={method} setMethod={setMethod} reference={reference} setReference={setReference} />

      {suspended && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-hold-surface p-3 text-body-md text-hold-ink">
          <input type="checkbox" checked={reactivate} onChange={(e) => setReactivate(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[var(--color-primary)]" />
          <span><b>{name} is suspended.</b> Reactivate it as part of this renewal.</span>
        </label>
      )}

      {error && <ErrorNote message={error} />}

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          icon={busy ? "progress_activity" : "check_circle"}
          disabled={busy || !plan || (override && amount === "") || (suspended && !reactivate)}
          onClick={() =>
            run(
              () => api.renew({ restaurant: restaurantId, plan: planId, periods: n, method, reference, amount_paise: overridePaise, reactivate: suspended && reactivate }),
              onDone,
            )
          }
        >
          {busy ? "Saving…" : "Record payment & extend"}
        </Button>
      </div>
    </div>
  );
}

export function RenewDialog({ open, onClose, onDone, target }: { open: boolean; onClose: () => void; onDone: () => void; target: { id: string; name: string; plan_id: string; expires_at: string | null; suspended: boolean } | null }) {
  if (!target) return null;
  return (
    <DialogShell open={open} onClose={onClose} title={`Renew ${target.name}`} subtitle={target.expires_at ? `Currently valid until ${fmtDate(target.expires_at)}` : "Lifetime license"} width="max-w-xl">
      <RenewForm restaurantId={target.id} name={target.name} currentPlanId={target.plan_id} expiresAt={target.expires_at} suspended={target.suspended} onCancel={onClose} onDone={() => { onDone(); onClose(); }} />
    </DialogShell>
  );
}

// ------------------------------------------------------------------ suspend / reactivate / reset
export function ReasonDialog({
  open, onClose, title, subtitle, warning, confirmLabel, danger, requireReason = true, placeholder, onConfirm,
}: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; warning?: ReactNode; confirmLabel: string; danger?: boolean;
  requireReason?: boolean; placeholder?: string; onConfirm: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState("");
  const { busy, error, run } = useAction();
  return (
    <DialogShell open={open} onClose={onClose} title={title} subtitle={subtitle}>
      <div className="space-y-4">
        {warning && <div className="rounded-xl bg-hold-surface p-3 text-body-md text-hold-ink">{warning}</div>}
        <Field label={requireReason ? "Reason *" : "Note"} hint="Saved in the activity log">
          <textarea autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} className="w-full resize-none rounded-xl bg-surface-low px-4 py-3 text-body-lg outline-none focus:bg-surface-lowest focus:ring-2 focus:ring-primary" />
        </Field>
        {error && <ErrorNote message={error} />}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} disabled={busy || (requireReason && !reason.trim())} onClick={() => run(() => onConfirm(reason.trim()), () => { setReason(""); onClose(); })}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}

// ------------------------------------------------------------------ edit client
export function EditClientDialog({ open, onClose, detail, onDone }: { open: boolean; onClose: () => void; detail: ClientDetail; onDone: () => void }) {
  const api = useApi();
  const { me } = usePortal();
  const r = detail.restaurant;
  const [f, setF] = useState({ name: r.name, owner_name: r.owner_name, phone: r.phone, email: r.email, city: r.city, address: r.address, gstin: r.gstin ?? "", notes: r.notes, max_devices: detail.license.max_devices });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <DialogShell open={open} onClose={onClose} title="Edit details" subtitle={`${r.name} · ${r.code}`} width="max-w-2xl">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Restaurant name *"><input value={f.name} onChange={set("name")} className={inputClass} /></Field>
        <Field label="Owner *"><input value={f.owner_name} onChange={set("owner_name")} className={inputClass} /></Field>
        <Field label="Phone *"><input value={f.phone} onChange={set("phone")} className={inputClass} /></Field>
        <Field label="Email *"><input type="email" value={f.email} onChange={set("email")} className={inputClass} /></Field>
        <Field label="City *"><input value={f.city} onChange={set("city")} className={inputClass} /></Field>
        <Field label="GSTIN" hint="Optional"><input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase().slice(0, 15) })} className={cx(inputClass, "font-mono")} /></Field>
        <div className="col-span-2"><Field label="Address"><input value={f.address} onChange={set("address")} className={inputClass} /></Field></div>
        <div className="col-span-2"><Field label="Internal notes" hint="Not shown to the restaurant"><textarea rows={2} value={f.notes} onChange={set("notes")} className="w-full resize-none rounded-xl bg-surface-low px-4 py-3 text-body-lg outline-none focus:bg-surface-lowest focus:ring-2 focus:ring-primary" /></Field></div>
        <Field label="Terminals allowed" hint={`${detail.devices.filter((d) => d.active).length} linked`}>
          <input type="number" min={1} max={50} value={f.max_devices} onChange={(e) => setF({ ...f, max_devices: Number(e.target.value) })} className={cx(inputClass, "tnum")} />
        </Field>
      </div>
      {error && <div className="mt-4"><ErrorNote message={error} /></div>}
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          icon="save"
          disabled={busy}
          onClick={() => run(() => api.updateClient(r.id, { ...f, ...(me?.role === "super_admin" ? {} : { max_devices: undefined }) }), () => { onDone(); onClose(); })}
        >
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </DialogShell>
  );
}

