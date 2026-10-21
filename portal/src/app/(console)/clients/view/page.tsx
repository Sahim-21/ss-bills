"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { LineChart } from "@/components/charts";
import { Async, Avatar, EditClientDialog, PlanBadge, ReasonDialog, RenewDialog, StateBadge } from "@/components/console-ui";
import { Badge, Button, Card, EmptyState, Icon, Segmented, cx } from "@/components/ui";
import { ago, daysLabel, describeEvent, EVENT_ICON, EVENT_LABEL, EVENT_TONE, fmtDate, fmtDateTime, fmtYmd, istDate } from "@/lib/format";
import { useAsync, useCopy, useNowMs } from "@/lib/hooks";
import { formatINR, formatINRCompact, formatINRShort } from "@/lib/money";
import { useApi, usePortal } from "@/lib/portal";
import type { ClientDetail, Device } from "@/lib/types";

const METHOD_LABEL: Record<string, string> = { upi: "UPI", bank: "Bank", cash: "Cash", cheque: "Cheque", card: "Card", other: "Other", waived: "Waived" };

function ClientView() {
  const id = useSearchParams().get("id") ?? "";
  const api = useApi();
  const { me } = usePortal();
  const { data, error, loading, reload } = useAsync(() => api.client(id), [api, id]);
  const [range, setRange] = useState<"7" | "30">("30");
  const [dialog, setDialog] = useState<null | "renew" | "edit" | "suspend" | "reactivate" | "regenerate">(null);
  const [resetting, setResetting] = useState<Device | null>(null);
  const [reveal, setReveal] = useState(false);
  const { copy, copied } = useCopy();
  const [showAllLedger, setShowAllLedger] = useState(false);

  return (
    <Async error={error} loading={loading} hasData={!!data} onRetry={reload}>
      {data && (
        <Body
          d={data}
          isSuper={me?.role === "super_admin"}
          range={range}
          setRange={setRange}
          reveal={reveal}
          setReveal={setReveal}
          copy={copy}
          copied={copied}
          showAllLedger={showAllLedger}
          setShowAllLedger={setShowAllLedger}
          open={setDialog}
          onReset={setResetting}
        />
      )}
      {data && (
        <>
          <RenewDialog
            open={dialog === "renew"}
            onClose={() => setDialog(null)}
            onDone={reload}
            target={{ id: data.restaurant.id, name: data.restaurant.name, plan_id: data.license.plan_id, expires_at: data.license.expires_at, suspended: data.license.status === "suspended" }}
          />
          {dialog === "edit" && <EditClientDialog open onClose={() => setDialog(null)} detail={data} onDone={reload} />}
          <ReasonDialog
            open={dialog === "suspend"}
            onClose={() => setDialog(null)}
            title={`Suspend ${data.restaurant.name}?`}
            danger
            confirmLabel="Suspend license"
            warning={<>Their app stops creating new bills at its <b>next sync</b>. Everything already on their PC stays there, and they can still view history and back up.</>}
            placeholder="e.g. Payment bounced twice"
            onConfirm={async (reason) => {
              await api.suspend(data.restaurant.id, reason);
              reload();
            }}
          />
          <ReasonDialog
            open={dialog === "regenerate"}
            onClose={() => setDialog(null)}
            title={`Replace the license key for ${data.restaurant.name}?`}
            danger
            confirmLabel="Replace key"
            warning={<>The <b>old key stops working immediately</b>. Each of their PCs then shows &ldquo;Activate again&rdquo; and cannot create new bills until someone types the new key in (Settings → License &amp; sync). Their data and terminal slots are not affected. The new key is shown on this page afterwards.</>}
            placeholder="e.g. Key was shared outside the restaurant"
            onConfirm={async (reason) => {
              await api.regenerateKey(data.restaurant.id, reason);
              setReveal(true);
              reload();
            }}
          />
          <ReasonDialog
            open={dialog === "reactivate"}
            onClose={() => setDialog(null)}
            title={`Reactivate ${data.restaurant.name}`}
            subtitle="Billing works again at their next sync"
            confirmLabel="Reactivate"
            requireReason={false}
            placeholder="e.g. Payment received by UPI"
            onConfirm={async (note) => {
              await api.reactivate(data.restaurant.id, note);
              reload();
            }}
          />
          <ReasonDialog
            open={!!resetting}
            onClose={() => setResetting(null)}
            title="Reset terminal binding?"
            subtitle={resetting ? `${resetting.device_name || "Terminal"} · ${resetting.machine_id}` : undefined}
            confirmLabel="Unlink this PC"
            danger
            warning={<>The PC is unlinked and stops syncing straight away. Use this when the restaurant changes or repairs a PC. The freed slot can be used by another PC.</>}
            placeholder="e.g. Motherboard replaced at the counter"
            onConfirm={async (reason) => {
              await api.resetDevice(resetting!.id, reason);
              reload();
            }}
          />
        </>
      )}
    </Async>
  );
}

type Props = {
  d: ClientDetail; isSuper: boolean; range: "7" | "30"; setRange: (r: "7" | "30") => void; reveal: boolean; setReveal: (b: boolean) => void;
  copy: (t: string, id?: string) => void; copied: string | null; showAllLedger: boolean; setShowAllLedger: (b: boolean) => void;
  open: (d: "renew" | "edit" | "suspend" | "reactivate" | "regenerate") => void; onReset: (d: Device) => void;
};

function Body({ d, isSuper, range, setRange, reveal, setReveal, copy, copied, showAllLedger, setShowAllLedger, open, onReset }: Props) {
  const r = d.restaurant;
  const l = d.license;
  const suspended = l.status === "suspended";
  const now = useNowMs();
  const daysLeft = l.expires_at ? Math.ceil((new Date(l.expires_at).getTime() - now) / 86_400_000) : null;
  const activeDevices = d.devices.filter((x) => x.active);

  const n = Number(range);
  const dates = Array.from({ length: n }, (_, i) => istDate(-(n - 1 - i), new Date(now)));
  const byDate = new Map(d.summaries.map((s) => [s.date, s]));
  const rows = dates.map((date) => ({ date, s: byDate.get(date) }));
  const inRange = rows.flatMap((x) => (x.s ? [x.s] : []));
  const sum = (k: "sales_paise" | "bills" | "cash_paise" | "upi_paise" | "card_paise" | "cancelled" | "tax_paise") => inRange.reduce((t, s) => t + s[k], 0);
  const sales = sum("sales_paise");
  const bills = sum("bills");
  const pct = (v: number) => (sales ? Math.round((v / sales) * 100) : 0);
  const ledger = [...inRange].reverse();
  const key = l.license_key;
  const shown = reveal ? key : `${key.slice(0, 4)}-••••-••••-${key.slice(-4)}`;

  return (
    <div className="space-y-5">
      <nav className="text-body-sm text-muted">
        <Link href="/clients/" className="hover:underline">Clients</Link> / <span className="text-ink">{r.name}</span>
      </nav>

      <Card className="flex flex-wrap items-start justify-between gap-4 p-6">
        <div className="flex items-start gap-4">
          <Avatar name={r.name} size={60} />
          <div>
            <h1 className="text-headline-lg">{r.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StateBadge state={l.state} />
              <PlanBadge name={l.plan_name} kind={l.plan_id} />
              <Badge tone="neutral"><Icon name="computer" className="text-[14px]" /> {activeDevices.length} of {l.max_devices} terminals</Badge>
              <span className="text-body-sm text-muted">{r.city} · {r.code}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon="edit" onClick={() => open("edit")}>Edit details</Button>
          {suspended ? (
            <Button variant="secondary" icon="lock_open" onClick={() => open("reactivate")}>Reactivate</Button>
          ) : (
            isSuper && <Button variant="ghost" icon="block" className="text-error! hover:bg-error-container!" onClick={() => open("suspend")}>Suspend</Button>
          )}
          {l.expires_at !== null && <Button variant="primary" icon="autorenew" onClick={() => open("renew")}>Renew / extend</Button>}
        </div>
      </Card>

      {suspended && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl bg-error-container p-4 text-on-error-container">
          <Icon name="block" /> <div><b>Suspended</b>{l.suspended_reason ? `: ${l.suspended_reason}` : ""}{l.suspended_at ? ` (since ${fmtDate(l.suspended_at)})` : ""}. New bills are blocked at their next sync.</div>
        </div>
      )}
      {!suspended && (l.state === "grace" || l.state === "expired") && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl bg-hold-surface p-4 text-hold-ink">
          <Icon name="schedule" /> <div><b>{l.state === "grace" ? "In the grace period" : "Expired"}.</b> {daysLabel(daysLeft)}. Billing keeps working during the grace period, then stops at their next sync.</div>
        </div>
      )}
      {!suspended && l.offline && (
        <div className="flex items-start gap-3 rounded-2xl bg-surface-container p-4 text-ink-variant">
          <Icon name="wifi_off" /> <div><b>No check-in for a while.</b> Last seen {ago(l.last_check_in_at, new Date(now))}. Their PC may be off or without internet; billing is not affected.</div>
        </div>
      )}

      <div className="grid grid-cols-[360px_1fr] gap-5">
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="mb-3 text-headline-sm">Restaurant</h2>
            <dl className="space-y-3 text-body-md">
              <Item label="Owner" value={r.owner_name} />
              <Item label="Phone" value={<a href={`tel:${r.phone.replace(/\s/g, "")}`} className="text-primary hover:underline">{r.phone}</a>} />
              <Item label="Email" value={<a href={`mailto:${r.email}`} className="break-all text-primary hover:underline">{r.email}</a>} />
              <Item label="Address" value={r.address || "—"} />
              <Item label="GSTIN" value={<span className="font-mono">{r.gstin ?? "—"}</span>} />
              <Item label="Onboarded" value={fmtDate(r.created_at)} />
              {r.notes && <Item label="Notes" value={r.notes} />}
            </dl>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-headline-sm">License</h2>
            <div className="rounded-xl bg-surface-low p-3">
              <div className="text-label-sm uppercase tracking-wider text-muted">License key</div>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 font-mono text-[15px] font-bold tracking-wider">{shown}</code>
                <button type="button" aria-label={reveal ? "Hide key" : "Show key"} onClick={() => setReveal(!reveal)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface-high">
                  <Icon name={reveal ? "visibility_off" : "visibility"} className="text-[20px]" />
                </button>
                <button type="button" aria-label="Copy key" onClick={() => copy(key, "key")} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface-high">
                  <Icon name={copied === "key" ? "check" : "content_copy"} className={cx("text-[20px]", copied === "key" && "text-tertiary")} />
                </button>
              </div>
              {isSuper && (
                <button type="button" onClick={() => open("regenerate")} className="mt-2 flex items-center gap-1 text-label-md text-primary hover:underline">
                  <Icon name="key" className="text-[16px]" /> Replace this key
                </button>
              )}
            </div>
            <dl className="mt-4 space-y-3 text-body-md">
              <Item label="Plan" value={`${l.plan_name} · ${formatINRShort(l.plan_price_paise)}${l.plan_id === "lifetime" ? "" : l.plan_id === "monthly" ? "/month" : "/year"}`} />
              <Item label="Started" value={fmtDate(l.starts_at)} />
              <Item label="Expires" value={l.expires_at ? <>{fmtDate(l.expires_at)} <span className="text-muted">({daysLabel(daysLeft)})</span></> : "Never (lifetime)"} />
              <Item label="Last check-in" value={<>{ago(l.last_check_in_at, new Date(now))}{l.app_version && <span className="text-muted"> · app {l.app_version}</span>}</>} />
            </dl>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-headline-sm">Terminals</h2>
              <span className="text-body-sm text-muted">{activeDevices.length} of {l.max_devices} in use</span>
            </div>
            <ul className="space-y-2">
              {d.devices.length === 0 && <li className="rounded-xl bg-surface-low p-3 text-body-md text-muted">No PC has activated this license yet.</li>}
              {d.devices.map((x) => (
                <li key={x.id} className={cx("rounded-xl border border-line p-3", !x.active && "bg-surface-low opacity-70")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-label-lg"><Icon name="computer" className="text-[20px] text-muted" /> {x.device_name || "Terminal"}</span>
                    {x.active ? <Badge tone="success">Linked</Badge> : <Badge tone="neutral">Unlinked</Badge>}
                  </div>
                  <div className="mt-1 font-mono text-body-sm text-muted">{x.machine_id}</div>
                  <div className="mt-1 flex items-center justify-between text-body-sm text-muted">
                    <span>Seen {ago(x.last_seen_at, new Date(now))}{x.app_version ? ` · app ${x.app_version}` : ""}</span>
                    {x.active && <Button size="sm" variant="soft" icon="link_off" onClick={() => onReset(x)}>Reset</Button>}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-body-sm text-muted">Reset a terminal when the restaurant changes or repairs a PC, so another PC can take its place.</p>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-headline-md">Sales performance</h2>
                <p className="text-body-md text-muted">From the daily summaries their app uploads</p>
              </div>
              <Segmented<"7" | "30"> size="sm" className="w-[200px]" value={range} onChange={setRange} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }]} />
            </div>
            <div className="mt-4 grid grid-cols-4 gap-3">
              <Tile label="Total sales" value={formatINRCompact(sales)} />
              <Tile label="Bills" value={bills.toLocaleString("en-IN")} sub={inRange.length ? `${Math.round(bills / inRange.length)} a day` : undefined} />
              <Tile label="Average bill" value={bills ? formatINRShort(Math.round(sales / bills)) : "—"} />
              <Tile label="Payment mix" value={sales ? `${pct(sum("upi_paise"))}% UPI` : "—"} sub={sales ? `${pct(sum("cash_paise"))}% cash · ${pct(sum("card_paise"))}% card` : undefined} />
            </div>
            {inRange.length === 0 ? (
              <EmptyState icon="monitoring" title="No sales reported yet">Sales appear after their app first syncs.</EmptyState>
            ) : (
              <div className="mt-3">
                <LineChart ariaLabel="Daily sales" data={rows.map((x) => ({ label: fmtYmd(x.date), value: x.s?.sales_paise ?? 0, sub: x.s ? `${x.s.bills} bills` : "no sync" }))} height={220} />
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-6 pb-3 pt-5">
              <div>
                <h2 className="text-headline-md">Daily ledger</h2>
                <p className="text-body-md text-muted">Newest first · GST is the tax they collected</p>
              </div>
            </div>
            <table className="tnum w-full text-left text-body-md">
              <thead className="bg-surface-low text-label-md uppercase tracking-wider text-muted">
                <tr><th className="px-6 py-2">Date</th><th className="px-3 py-2 text-right">Sales</th><th className="px-3 py-2 text-right">Bills</th><th className="px-3 py-2 text-right">Cancelled</th><th className="px-3 py-2 text-right">GST</th><th className="px-3 py-2">Top item</th><th className="px-6 py-2">Synced</th></tr>
              </thead>
              <tbody className="divide-y divide-surface-low">
                {(showAllLedger ? ledger : ledger.slice(0, 7)).map((s) => (
                  <tr key={s.date}>
                    <td className="px-6 py-2.5">{fmtYmd(s.date)}</td>
                    <td className="px-3 py-2.5 text-right text-price-md">{formatINR(s.sales_paise)}</td>
                    <td className="px-3 py-2.5 text-right">{s.bills}</td>
                    <td className={cx("px-3 py-2.5 text-right", s.cancelled > 0 && "text-error")}>{s.cancelled}</td>
                    <td className="px-3 py-2.5 text-right">{formatINR(s.tax_paise)}</td>
                    <td className="px-3 py-2.5">{s.top_item_name ? <>{s.top_item_name} <span className="text-muted">({s.top_item_qty})</span></> : "—"}</td>
                    <td className="px-6 py-2.5 text-muted">{ago(s.synced_at, new Date(now))}</td>
                  </tr>
                ))}
                {ledger.length === 0 && <tr><td colSpan={7} className="px-6 py-6 text-center text-muted">Nothing synced in this period.</td></tr>}
              </tbody>
            </table>
            {ledger.length > 7 && (
              <div className="border-t border-line px-6 py-3 text-center">
                <button type="button" onClick={() => setShowAllLedger(!showAllLedger)} className="text-label-md text-primary hover:underline">
                  {showAllLedger ? "Show fewer days" : `Show all ${ledger.length} days`}
                </button>
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="px-6 pb-3 pt-5">
              <h2 className="text-headline-md">Payments</h2>
              <p className="text-body-md text-muted">What SS Bills has received from this client</p>
            </div>
            <table className="tnum w-full text-left text-body-md">
              <thead className="bg-surface-low text-label-md uppercase tracking-wider text-muted">
                <tr><th className="px-6 py-2">Recorded</th><th className="px-3 py-2">Plan</th><th className="px-3 py-2">Period</th><th className="px-3 py-2">Method</th><th className="px-3 py-2 text-right">GST</th><th className="px-6 py-2 text-right">Total</th></tr>
              </thead>
              <tbody className="divide-y divide-surface-low">
                {d.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-6 py-2.5">{fmtDate(p.created_at)}</td>
                    <td className="px-3 py-2.5">{p.plan_id}{p.periods > 1 ? ` × ${p.periods}` : ""}</td>
                    <td className="px-3 py-2.5 text-muted">{fmtDate(p.period_from)} → {p.period_to ? fmtDate(p.period_to) : "lifetime"}</td>
                    <td className="px-3 py-2.5">{METHOD_LABEL[p.method] ?? p.method}{p.reference ? <span className="text-muted"> · {p.reference}</span> : ""}</td>
                    <td className="px-3 py-2.5 text-right">{formatINR(p.gst_paise)}</td>
                    <td className="px-6 py-2.5 text-right text-price-md">{formatINR(p.total_paise)}</td>
                  </tr>
                ))}
                {d.payments.length === 0 && <tr><td colSpan={6} className="px-6 py-6 text-center text-muted">No payment recorded yet.</td></tr>}
              </tbody>
            </table>
          </Card>

          <Card className="p-6">
            <h2 className="text-headline-md">License activity</h2>
            <p className="mb-4 text-body-md text-muted">Every change to this account, newest first. Entries cannot be edited or deleted.</p>
            <ol className="relative space-y-5 border-l-2 border-line pl-6">
              {d.events.map((e) => (
                <li key={e.id} className="relative">
                  <span className={cx("absolute -left-[37px] top-0 flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-surface-lowest", e.event === "suspended" || e.event === "device_reset" ? "bg-error text-white" : "bg-primary text-white")}>
                    <Icon name={EVENT_ICON[e.event]} className="text-[16px]" />
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={EVENT_TONE[e.event]}>{EVENT_LABEL[e.event]}</Badge>
                    <span className="text-body-sm text-muted">{fmtDateTime(e.created_at)} · {e.actor_name}</span>
                  </div>
                  <p className="mt-1 text-body-md text-ink-variant">{describeEvent(e)}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-label-md uppercase tracking-wider text-muted">{label}</dt>
      <dd className="min-w-0 flex-1">{value}</dd>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-surface-low p-4">
      <div className="text-label-sm uppercase tracking-wider text-muted">{label}</div>
      <div className="tnum mt-1 text-headline-md">{value}</div>
      {sub && <div className="tnum text-body-sm text-muted">{sub}</div>}
    </div>
  );
}

export default function ClientViewPage() {
  return (
    <Suspense>
      <ClientView />
    </Suspense>
  );
}
