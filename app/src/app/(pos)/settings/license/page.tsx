"use client";

import { useState } from "react";
import { SettingsSection } from "@/components/settings-ui";
import { Button, Card, Icon, cx } from "@/components/ui";
import { fmtDateLong, fmtDateTime, useNow, useOnline } from "@/lib/hooks";
import { MOCK_LICENSE } from "@/lib/mock-data";
import { usePos } from "@/lib/pos-store";

// License status & summary sync (PRD L-2, L-3; TRD §7.2). UI only: no network calls yet.
export default function LicenseSettingsPage() {
  const { state } = usePos();
  const now = useNow(60_000);
  const online = useOnline();
  const [revealed, setRevealed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lic, setLic] = useState(MOCK_LICENSE);
  const daysLeft = Math.ceil((new Date(lic.validUntil).getTime() - now.getTime()) / 86_400_000);
  const graceLeft = lic.graceDays - lic.offlineDays;
  const masked = revealed ? lic.key : lic.key.replace(/[A-Z0-9](?=.{5})/g, "•");

  return (
    <div className="space-y-4">
      {lic.offlineDays > 0 && (
        <div className="flex items-start gap-4 rounded-2xl border border-hold bg-hold-surface p-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-hold text-white">
            <Icon name="wifi_off" />
          </span>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-headline-sm text-hold-ink">
                Not synced for {lic.offlineDays} days. Please connect within {graceLeft} days
              </h2>
              <span className="rounded bg-hold px-2 py-0.5 text-label-sm uppercase text-white">Grace period</span>
            </div>
            <p className="mt-1 text-body-md text-hold-ink">
              Billing keeps working offline. If the app can&apos;t reach SS Bills for {lic.graceDays} days, new bills are paused until it reconnects.
              History, reports and backups always stay available.
            </p>
          </div>
        </div>
      )}

      <SettingsSection icon="verified_user" title="License" subtitle={`Licensed to ${state.profile.name}`}>
        <div className="grid grid-cols-3 gap-3">
          <Card className="bg-surface-low p-4">
            <div className="text-label-sm uppercase text-muted">Status</div>
            <div className="mt-1 flex items-center gap-2 text-headline-sm text-tertiary">
              <span className="h-2.5 w-2.5 rounded-full bg-tertiary" /> Active
            </div>
            <div className="text-body-sm text-muted">{lic.plan} plan</div>
          </Card>
          <Card className="bg-surface-low p-4">
            <div className="text-label-sm uppercase text-muted">Valid until</div>
            <div className="mt-1 text-headline-sm">{fmtDateLong(lic.validUntil)}</div>
            <div className={cx("text-body-sm", daysLeft < 30 ? "text-error" : "text-tertiary")}>{daysLeft} days left</div>
          </Card>
          <Card className="bg-surface-low p-4">
            <div className="text-label-sm uppercase text-muted">This PC</div>
            <div className="mt-1 font-mono text-headline-sm">PC-8921-99A0</div>
            <div className="text-body-sm text-muted">License is tied to this PC</div>
          </Card>
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-surface-low p-3">
          <span className="px-2 text-label-md uppercase text-muted">License key</span>
          <code className="flex-1 rounded-lg bg-surface-lowest px-4 py-3 font-mono text-headline-sm tracking-[0.2em]">{masked}</code>
          <Button variant="secondary" icon={revealed ? "visibility_off" : "visibility"} onClick={() => setRevealed((r) => !r)}>
            {revealed ? "Hide" : "Show"}
          </Button>
        </div>
        <p className="mt-3 text-body-sm text-muted">Changing PC or renewing? Contact SS Bills support. They can move the license to a new PC.</p>
      </SettingsSection>

      <SettingsSection icon="sync" title="Daily summary sync" subtitle="Only daily totals are sent to SS Bills. Bills and items never leave this PC.">
        <div className="grid grid-cols-[1fr_280px] gap-4">
          <div className="divide-y divide-surface-low rounded-xl border border-line">
            <Row label="Connection" value={<span className={cx("flex items-center gap-1.5", online ? "text-tertiary" : "text-hold-ink")}><span className={cx("h-2 w-2 rounded-full", online ? "bg-tertiary" : "bg-hold")} />{online ? "Online" : "Offline"}</span>} />
            <Row label="Last successful sync" value={fmtDateTime(lic.lastSyncAt)} />
            <Row label="Summaries waiting to send" value={<span className={lic.pendingSummaries ? "text-primary" : ""}>{lic.pendingSummaries} days</span>} />
            <Row label="What is sent" value="Sales total, bill count, payment split, GST, top item" />
          </div>
          <div className="flex flex-col justify-between gap-3 rounded-xl bg-surface-low p-4">
            <p className="text-body-sm text-muted">The app syncs automatically once a day when online, and retries if it fails.</p>
            <Button
              variant="primary"
              size="lg"
              icon={syncing ? "progress_activity" : "sync"}
              disabled={syncing || !online}
              onClick={() => {
                setSyncing(true);
                setTimeout(() => {
                  setLic({ ...lic, lastSyncAt: new Date().toISOString(), pendingSummaries: 0, offlineDays: 0 });
                  setSyncing(false);
                }, 1200);
              }}
            >
              {syncing ? "Syncing…" : online ? "Sync now" : "Offline"}
            </Button>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 text-body-md">
      <span className="text-muted">{label}</span>
      <span className="text-right text-label-lg">{value}</span>
    </div>
  );
}
