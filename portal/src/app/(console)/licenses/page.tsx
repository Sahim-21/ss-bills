"use client";

import Link from "next/link";
import { useState } from "react";
import { Async, PlanBadge, ReasonDialog, RenewForm, StateBadge } from "@/components/console-ui";
import { Badge, Button, Card, Chip, EmptyState, Icon, PageHeader, SearchInput, cx } from "@/components/ui";
import { daysLabel, fmtDate } from "@/lib/format";
import { useAsync, useDebounced } from "@/lib/hooks";
import { formatINRCompact, formatINRShort } from "@/lib/money";
import { useApi, usePortal } from "@/lib/portal";
import type { LicenseList, LicenseTab } from "@/lib/types";

type Row = LicenseList["rows"][number];
const TABS: { id: LicenseTab; label: string }[] = [
  { id: "expiring", label: "Expiring soon" },
  { id: "expired", label: "Expired / grace" },
  { id: "suspended", label: "Suspended" },
  { id: "all", label: "All licenses" },
];

export default function LicensesPage() {
  const api = useApi();
  const { me } = usePortal();
  const [tab, setTab] = useState<LicenseTab>("expiring");
  const [horizon, setHorizon] = useState<number | null>(null);
  const [plan, setPlan] = useState("");
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [selected, setSelected] = useState<Row | null>(null);
  const [suspend, setSuspend] = useState<Row | null>(null);
  const [reactivate, setReactivate] = useState<Row | null>(null);

  const { data, error, loading, reload } = useAsync(
    () => api.licenses({ tab, horizon_days: tab === "expiring" && horizon ? horizon : undefined, plan: plan || undefined, search: debounced }),
    [api, tab, horizon, plan, debounced],
  );
  const { data: plans } = useAsync(() => api.plans(), [api]);
  const isSuper = me?.role === "super_admin";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Renewals"
        title="Licenses & renewals"
        subtitle="Active licenses, upcoming renewals and grace periods. Record a payment to extend a license."
        actions={
          isSuper && (
            <Link href="/clients/new/">
              <Button variant="primary" icon="add">
                Issue new license
              </Button>
            </Link>
          )
        }
      />

      <Async error={error} loading={loading} hasData={!!data} onRetry={reload}>
        {data && (
          <>
            <div className="grid grid-cols-4 gap-3">
              <Stat label="Due this month" value={String(data.strip.due_this_month)} sub="licenses ending by month end" icon="event" />
              <Stat label="Renewal pipeline" value={formatINRCompact(data.strip.pipeline_paise)} sub="expiring soon, at plan prices, before GST" icon="payments" />
              <Stat label="In grace period" value={String(data.strip.in_grace)} sub="still billing, until the grace ends" icon="timer" tone={data.strip.in_grace ? "warn" : undefined} />
              <Stat label="Suspended" value={String(data.strip.suspended)} sub="billing locked" icon="block" tone={data.strip.suspended ? "bad" : undefined} />
            </div>

            <Card className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                {TABS.map((t) => (
                  <Chip key={t.id} active={tab === t.id} count={data.counts[t.id]} onClick={() => { setTab(t.id); setSelected(null); }}>
                    {t.label}
                  </Chip>
                ))}
                <SearchInput className="ml-auto w-[280px]" value={search} onChange={setSearch} placeholder="License key, name, city…" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {tab === "expiring" && (
                  <>
                    <span className="text-label-md uppercase tracking-wider text-muted">Horizon</span>
                    {[null, 7, 15, 30].map((h) => (
                      <Chip key={String(h)} active={horizon === h} onClick={() => setHorizon(h)}>
                        {h ? `Next ${h} days` : "All upcoming"}
                      </Chip>
                    ))}
                    <span className="mx-1 h-6 w-px bg-line" />
                  </>
                )}
                <span className="text-label-md uppercase tracking-wider text-muted">Plan</span>
                <Chip active={plan === ""} onClick={() => setPlan("")}>All</Chip>
                {(plans ?? []).map((p) => (
                  <Chip key={p.id} active={plan === p.id} onClick={() => setPlan(p.id)}>{p.name}</Chip>
                ))}
              </div>
            </Card>

            <div className="grid grid-cols-[1fr_440px] items-start gap-5">
              <div className={cx("space-y-3 transition-opacity", loading && "opacity-60")}>
                {data.rows.length === 0 && (
                  <Card>
                    <EmptyState icon="task_alt" title="Nothing here">No licenses match this view.</EmptyState>
                  </Card>
                )}
                {data.rows.map((r) => {
                  const isSel = selected?.restaurant_id === r.restaurant_id;
                  return (
                    <Card key={r.restaurant_id} className={cx("p-5 transition-shadow", isSel && "ring-2 ring-primary")}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <Link href={`/clients/view/?id=${r.restaurant_id}`} className="text-headline-sm hover:underline">{r.name}</Link>
                          <div className="text-body-sm text-muted">{r.city} · {r.code} · {r.devices_used}/{r.max_devices} terminals</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StateBadge state={r.state} />
                          {r.expires_at && r.state !== "suspended" && <Badge tone="neutral">{daysLabel(r.days_left)}</Badge>}
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-4 gap-3 rounded-xl bg-surface-low p-3 text-body-md">
                        <Field label="License key"><code className="font-mono text-body-sm font-bold">{r.license_key}</code></Field>
                        <Field label="Plan"><PlanBadge name={r.plan_name} kind={r.kind} /></Field>
                        <Field label="Expires">{r.expires_at ? <span className="tnum">{fmtDate(r.expires_at)}</span> : "Lifetime"}</Field>
                        <Field label={r.state === "suspended" ? "Reason" : "Renewal price"}>
                          {r.state === "suspended" ? <span className="text-error">{r.suspended_reason}</span> : r.kind === "lifetime" ? "—" : <span className="tnum">{formatINRShort(r.price_paise)} <span className="text-muted">+ GST</span></span>}
                        </Field>
                      </div>
                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        {r.state === "suspended" ? (
                          <>
                            <Button size="sm" variant="secondary" icon="lock_open" onClick={() => setReactivate(r)}>Reactivate only</Button>
                            <Button size="sm" variant="primary" icon="autorenew" onClick={() => setSelected(r)}>Reactivate & renew</Button>
                          </>
                        ) : (
                          <>
                            {isSuper && <Button size="sm" variant="ghost" icon="block" className="text-error! hover:bg-error-container!" onClick={() => setSuspend(r)}>Suspend</Button>}
                            {r.kind !== "lifetime" && <Button size="sm" variant="primary" icon="autorenew" onClick={() => setSelected(r)}>Renew</Button>}
                          </>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>

              <div className="sticky top-20">
                {selected ? (
                  <Card className="p-5">
                    <div className="mb-4 flex items-start justify-between">
                      <div>
                        <div className="text-label-sm uppercase tracking-wider text-primary">Renew license</div>
                        <h2 className="text-headline-md">{selected.name}</h2>
                        <p className="text-body-sm text-muted">{selected.license_key} · {selected.expires_at ? `valid until ${fmtDate(selected.expires_at)}` : "lifetime"}</p>
                      </div>
                      <button type="button" aria-label="Close" onClick={() => setSelected(null)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface-high"><Icon name="close" /></button>
                    </div>
                    <RenewForm
                      key={selected.restaurant_id}
                      restaurantId={selected.restaurant_id}
                      name={selected.name}
                      currentPlanId={selected.plan_id}
                      expiresAt={selected.expires_at}
                      suspended={selected.state === "suspended"}
                      onCancel={() => setSelected(null)}
                      onDone={() => { setSelected(null); reload(); }}
                    />
                  </Card>
                ) : (
                  <Card className="p-6 text-center text-muted">
                    <Icon name="autorenew" className="text-[32px] text-primary" />
                    <p className="mt-2 text-body-md">Choose <b>Renew</b> on a license to record a payment and extend it. The new period starts when the old one ends, so paying early never loses days.</p>
                  </Card>
                )}
              </div>
            </div>
          </>
        )}
      </Async>

      <ReasonDialog
        open={!!suspend}
        onClose={() => setSuspend(null)}
        title={`Suspend ${suspend?.name ?? ""}?`}
        danger
        confirmLabel="Suspend license"
        warning={<>Their app stops creating new bills at its <b>next sync</b>. Everything on their PC stays there.</>}
        placeholder="e.g. Payment bounced twice"
        onConfirm={async (reason) => {
          await api.suspend(suspend!.restaurant_id, reason);
          reload();
        }}
      />
      <ReasonDialog
        open={!!reactivate}
        onClose={() => setReactivate(null)}
        title={`Reactivate ${reactivate?.name ?? ""}`}
        subtitle="Billing works again at their next sync"
        confirmLabel="Reactivate"
        requireReason={false}
        placeholder="e.g. Payment received by UPI"
        onConfirm={async (note) => {
          await api.reactivate(reactivate!.restaurant_id, note);
          reload();
        }}
      />
    </div>
  );
}

function Stat({ label, value, sub, icon, tone }: { label: string; value: string; sub: string; icon: string; tone?: "warn" | "bad" }) {
  const color = tone === "bad" ? "text-error" : tone === "warn" ? "text-hold-ink" : "text-ink";
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="text-label-sm uppercase tracking-wider text-muted">{label}</div>
        <Icon name={icon} className={cx("text-[20px]", color)} />
      </div>
      <div className="tnum mt-2 text-[30px] font-extrabold leading-9 tracking-tight">{value}</div>
      <div className="mt-1 text-body-sm text-muted">{sub}</div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-label-sm uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
