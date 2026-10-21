"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Async, ErrorNote, ReasonDialog, useAction } from "@/components/console-ui";
import { Badge, Button, Card, Field, Icon, PageHeader, Toggle, cx, inputClass } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import { formatINRShort, rupeesToPaise } from "@/lib/money";
import { isDemo, usePortal } from "@/lib/portal";
import type { Plan, TeamMember } from "@/lib/types";

export default function SettingsPage() {
  const { api, me, resetDemo } = usePortal();
  const isSuper = me?.role === "super_admin";
  const plans = useAsync(() => api.plans(), [api]);
  const team = useAsync(() => api.team(), [api]);
  const config = useAsync(() => api.config(), [api]);
  const router = useRouter();
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Console" title="Settings" subtitle="Plans and prices, the vendor team, and security." />

      <Card className="p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-headline-md">Plans & prices</h2>
            <p className="text-body-md text-muted">Prices are before GST ({config.data ? `${config.data.gst_bp / 100}%` : "…"} is added on invoices). Changing a price affects new renewals only.</p>
          </div>
          {!isSuper && <Badge tone="neutral">Only a super admin can edit</Badge>}
        </div>
        <Async error={plans.error} loading={plans.loading} hasData={!!plans.data} onRetry={plans.reload}>
          <div className="space-y-3">
            {plans.data?.map((p) => (
              <PlanRow key={`${p.id}-${p.price_paise}-${p.max_devices}-${p.active}-${p.name}`} plan={p} editable={!!isSuper} onSaved={plans.reload} />
            ))}
          </div>
        </Async>
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-headline-md">Vendor team</h2>
            <p className="text-body-md text-muted">Who can sign in to this console. Super admins can onboard clients, suspend licenses, edit plans and manage the team. Support staff can view everything, renew licenses and reset terminals.</p>
          </div>
        </div>
        <Async error={team.error} loading={team.loading} hasData={!!team.data} onRetry={team.reload}>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {team.data?.map((t) => (
              <li key={t.user_id} className="flex items-center gap-4 px-4 py-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-fixed text-label-lg text-primary">{t.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
                <div className="flex-1">
                  <div className="text-label-lg">{t.name} {t.user_id === me?.user_id && <span className="text-body-sm text-muted">(you)</span>}</div>
                  <div className="text-body-sm text-muted">{t.email ?? "no email"} · added {fmtDate(t.created_at)}</div>
                </div>
                <Badge tone={t.role === "super_admin" ? "charcoal" : "neutral"}>{t.role === "super_admin" ? "Super admin" : "Support"}</Badge>
                {isSuper && t.user_id !== me?.user_id && <Button size="sm" variant="ghost" icon="person_remove" className="text-error! hover:bg-error-container!" onClick={() => setRemoving(t)}>Remove</Button>}
              </li>
            ))}
          </ul>
          {isSuper && <AddMember onAdded={team.reload} />}
        </Async>
      </Card>

      <Card className="p-6">
        <h2 className="text-headline-md">Security</h2>
        <ul className="mt-3 space-y-3 text-body-md text-ink-variant">
          <li className="flex gap-3"><Icon name="shield_lock" className="text-tertiary" /> <span>Every sign-in needs a code from an authenticator app. The database refuses all vendor actions without it, even if someone changes this page.</span></li>
          <li className="flex gap-3"><Icon name="history" className="text-tertiary" /> <span>Every change is written to the activity log with the person&apos;s name. The log cannot be edited or deleted.</span></li>
          <li className="flex gap-3"><Icon name="database" className="text-tertiary" /> <span>Only daily totals are stored here. Restaurants&apos; bills, items and customers stay on their own PCs.</span></li>
        </ul>
      </Card>

      {isDemo() && resetDemo && (
        <Card className="border-hold p-6">
          <h2 className="text-headline-md">Demo data</h2>
          <p className="mt-1 text-body-md text-muted">This console is running on sample data stored in this browser. Resetting rebuilds the sample restaurants and signs you out.</p>
          <div className="mt-4"><Button variant="secondary" icon="restart_alt" onClick={() => setConfirmReset(true)}>Reset demo data</Button></div>
          <ResetConfirm open={confirmReset} onClose={() => setConfirmReset(false)} onConfirm={async () => { await resetDemo(); router.replace("/login/"); }} />
        </Card>
      )}

      <ReasonDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.name ?? ""}?`}
        subtitle="They will no longer be able to use this console"
        danger
        confirmLabel="Remove from team"
        requireReason={false}
        placeholder="Optional note"
        onConfirm={async () => {
          await api.removeAdmin(removing!.user_id);
          team.reload();
        }}
      />
    </div>
  );
}

function PlanRow({ plan, editable, onSaved }: { plan: Plan; editable: boolean; onSaved: () => void }) {
  const { api } = usePortal();
  const [name, setName] = useState(plan.name);
  const [price, setPrice] = useState(String(plan.price_paise / 100));
  const [devices, setDevices] = useState(plan.max_devices);
  const [active, setActive] = useState(plan.active);
  const { busy, error, run } = useAction();
  const dirty = name !== plan.name || rupeesToPaise(price) !== plan.price_paise || devices !== plan.max_devices || active !== plan.active;
  return (
    <div className={cx("rounded-2xl border border-line p-4", !plan.active && "bg-surface-low")}>
      <div className="grid grid-cols-[1.4fr_1fr_1fr_auto_auto] items-end gap-4">
        <Field label="Name"><input disabled={!editable} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} /></Field>
        <Field label={plan.kind === "lifetime" ? "One-time price (₹)" : plan.kind === "yearly" ? "Price per year (₹)" : "Price per month (₹)"}>
          <input disabled={!editable} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} className={cx(inputClass, "tnum")} />
        </Field>
        <Field label="Terminals included">
          <input disabled={!editable} type="number" min={1} max={50} value={devices} onChange={(e) => setDevices(Number(e.target.value))} className={cx(inputClass, "tnum")} />
        </Field>
        <div className="flex h-12 items-center gap-2 text-label-md">
          <Toggle checked={active} onChange={setActive} label={`${plan.name} on sale`} disabled={!editable} /> {active ? "On sale" : "Off sale"}
        </div>
        <Button variant="primary" icon="save" disabled={!editable || !dirty || busy} onClick={() => run(() => api.updatePlan({ id: plan.id, name, price_paise: rupeesToPaise(price), max_devices: devices, active }), onSaved)}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
      <div className="mt-2 text-body-sm text-muted">
        {plan.kind === "lifetime" ? "Never expires" : `${plan.duration_days} days per period`} · currently {formatINRShort(plan.price_paise)} before GST
      </div>
      {error && <div className="mt-3"><ErrorNote message={error} /></div>}
    </div>
  );
}

function AddMember({ onAdded }: { onAdded: () => void }) {
  const { api } = usePortal();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"support" | "super_admin">("support");
  const { busy, error, run } = useAction();
  return (
    <div className="mt-4 rounded-2xl bg-surface-low p-4">
      <div className="mb-3 text-label-lg">Add a team member</div>
      <p className="mb-3 text-body-sm text-muted">
        {isDemo() ? "Demo: the person must already exist as a login. Try pooja.sharma@ssbills.in." : "First create their login in your Supabase dashboard (Authentication → Users → Invite), then add them here with the same email."}
      </p>
      <div className="grid grid-cols-[1.2fr_1fr_180px_auto] items-end gap-3">
        <Field label="Email"><input type="email" aria-label="New member email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} /></Field>
        <Field label="Name"><input aria-label="New member name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} /></Field>
        <Field label="Role">
          <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} className={inputClass}>
            <option value="support">Support</option>
            <option value="super_admin">Super admin</option>
          </select>
        </Field>
        <Button variant="primary" icon="person_add" disabled={busy || !email || !name} onClick={() => run(() => api.addAdmin(email, name, role), () => { setEmail(""); setName(""); onAdded(); })}>
          {busy ? "Adding…" : "Add"}
        </Button>
      </div>
      {error && <div className="mt-3"><ErrorNote message={error} /></div>}
    </div>
  );
}

function ResetConfirm({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  return (
    <ReasonDialog open={open} onClose={onClose} title="Reset demo data?" subtitle="All changes you made in the demo are lost" danger confirmLabel="Reset" requireReason={false} placeholder="" onConfirm={() => onConfirm()} />
  );
}
