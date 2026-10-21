"use client";

import { useEffect, useState } from "react";
import { ActivationPanel } from "@/components/activation";
import { SettingsSection } from "@/components/settings-ui";
import { Button, Card, Icon, cx } from "@/components/ui";
import { fmtDateLong, fmtDateTime, useOnline } from "@/lib/hooks";
import { useLicense, type LicenseStatus } from "@/lib/license";
import { usePos } from "@/lib/pos-store";

// Licence status and daily summary sync (PRD L-2, L-3; TRD §7.4). The main process owns the rules
// (electron/license.cjs); this page only shows them.
interface AppInfo {
  version: string;
  update: { state: "disabled" | "idle" | "checking" | "downloading" | "ready" | "error"; version: string | null; message: string | null };
}

const UPDATE_TEXT = {
  disabled: "Automatic updates are off",
  idle: "Up to date",
  checking: "Checking for updates…",
  downloading: "Downloading an update…",
  ready: "Update ready. It installs when you close the app",
  error: "Could not check for updates",
} as const;

export default function LicenseSettingsPage() {
  const { state } = usePos();
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void window.ssbills?.app<AppInfo>("info").then(setAppInfo, () => {});
  }, []);
  const online = useOnline();
  const { status, syncNow, activate } = useLicense();
  const [revealed, setRevealed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (typeof window !== "undefined" && !window.ssbills) {
    return (
      <SettingsSection icon="verified_user" title="License" subtitle="Licensing runs in the desktop app">
        <p className="text-body-md text-muted">This browser preview has no licence. Open the SS Bills desktop app to see the real status.</p>
      </SettingsSection>
    );
  }
  if (!status) return null;
  if (!status.enforced) {
    return (
      <SettingsSection icon="verified_user" title="License" subtitle="Licence checks are switched off">
        <p className="text-body-md text-muted">This copy runs with SSBILLS_LICENSE=off (development). Nothing is checked or uploaded.</p>
      </SettingsSection>
    );
  }

  const key = status.key ?? "";
  const masked = revealed ? key : key.replace(/[A-Z0-9](?=.{5})/g, "•");
  const tone = TONE[status.mode];
  const reactivate = status.mode === "locked" && (status.reason === "device_not_bound" || status.reason === "invalid_key");

  async function doSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await syncNow();
      setSyncMsg(r?.ok ? { ok: true, text: `Synced. ${r.accepted ?? 0} day${r.accepted === 1 ? "" : "s"} sent.` } : { ok: false, text: r?.message ?? "Sync failed" });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      {status.mode !== "ok" && (
        <div className={cx("flex items-start gap-4 rounded-2xl border p-5", status.mode === "locked" ? "border-error bg-error-container" : "border-hold bg-hold-surface")}>
          <span className={cx("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white", status.mode === "locked" ? "bg-error" : "bg-hold")}>
            <Icon name={status.mode === "locked" ? "lock" : "wifi_off"} />
          </span>
          <div className="flex-1">
            <h2 className={cx("text-headline-sm", status.mode === "locked" ? "text-on-error-container" : "text-hold-ink")}>{status.message}</h2>
            <p className={cx("mt-1 text-body-md", status.mode === "locked" ? "text-on-error-container" : "text-hold-ink")}>
              History, reports and backups always stay available.
            </p>
          </div>
        </div>
      )}

      <SettingsSection icon="verified_user" title="License" subtitle={`Licensed to ${status.restaurantName ?? state.profile.name}`}>
        <div className="grid grid-cols-3 gap-3">
          <Card className="bg-surface-low p-4">
            <div className="text-label-sm uppercase text-muted">Status</div>
            <div className={cx("mt-1 flex items-center gap-2 text-headline-sm", tone.text)}>
              <span className={cx("h-2.5 w-2.5 rounded-full", tone.dot)} /> {statusLabel(status)}
            </div>
            <div className="text-body-sm text-muted">{status.plan} plan</div>
          </Card>
          <Card className="bg-surface-low p-4">
            <div className="text-label-sm uppercase text-muted">Valid until</div>
            <div className="mt-1 text-headline-sm">{status.expiresAt ? fmtDateLong(status.expiresAt) : "Lifetime"}</div>
            {status.daysLeft != null && (
              <div className={cx("text-body-sm", status.daysLeft < 30 ? "text-error" : "text-tertiary")}>
                {status.daysLeft >= 0 ? `${status.daysLeft} days left` : `Expired ${-status.daysLeft} days ago`}
              </div>
            )}
          </Card>
          <Card className="bg-surface-low p-4">
            <div className="text-label-sm uppercase text-muted">This PC</div>
            <div className="mt-1 font-mono text-headline-sm">{status.machineId}</div>
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

      {reactivate && (
        <SettingsSection icon="key" title="Activate again" subtitle="Enter your licence key to link this PC again">
          <ActivationPanel onActivate={activate} machineId={status.machineId} />
        </SettingsSection>
      )}

      <SettingsSection icon="sync" title="Daily summary sync" subtitle="Only daily totals are sent to SS Bills. Bills and items never leave this PC.">
        <div className="grid grid-cols-[1fr_280px] gap-4">
          <div className="divide-y divide-surface-low rounded-xl border border-line">
            <Row label="Connection" value={<span className={cx("flex items-center gap-1.5", online ? "text-tertiary" : "text-hold-ink")}><span className={cx("h-2 w-2 rounded-full", online ? "bg-tertiary" : "bg-hold")} />{online ? "Online" : "Offline"}</span>} />
            <Row label="Last successful check-in" value={status.lastCheckInAt ? fmtDateTime(status.lastCheckInAt) : "Never"} />
            <Row label="Totals sent up to" value={status.lastSyncedDate ? fmtDateLong(`${status.lastSyncedDate}T12:00:00`) : "Nothing sent yet"} />
            {status.lastError && <Row label="Last problem" value={<span className="text-error">{status.lastError}</span>} />}
            <Row label="What is sent" value="Sales total, bill count, payment split, GST, top item" />
            {appInfo && (
              <Row
                label="App version"
                value={
                  <span>
                    {appInfo.version}
                    <span className="ml-2 text-body-sm text-muted">
                      {UPDATE_TEXT[appInfo.update.state]}
                      {appInfo.update.state === "ready" && appInfo.update.version ? ` (${appInfo.update.version})` : ""}
                    </span>
                  </span>
                }
              />
            )}
          </div>
          <div className="flex flex-col justify-between gap-3 rounded-xl bg-surface-low p-4">
            <p className="text-body-sm text-muted">The app syncs automatically every few hours when online, and retries if it fails.</p>
            {syncMsg && <p className={cx("text-body-sm", syncMsg.ok ? "text-tertiary" : "text-error")}>{syncMsg.text}</p>}
            <Button variant="primary" size="lg" icon={syncing ? "progress_activity" : "sync"} disabled={syncing || !online || !status.activated} onClick={() => void doSync()}>
              {syncing ? "Syncing…" : online ? "Sync now" : "Offline"}
            </Button>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

const TONE = {
  ok: { text: "text-tertiary", dot: "bg-tertiary" },
  warning: { text: "text-hold-ink", dot: "bg-hold" },
  locked: { text: "text-error", dot: "bg-error" },
} as const;

function statusLabel(s: LicenseStatus) {
  if (s.mode === "locked") return s.reason === "suspended" ? "Suspended" : s.reason === "expired" ? "Expired" : "Billing paused";
  if (s.reason === "grace") return "Expired (grace)";
  if (s.reason === "offline") return "Active · not synced";
  if (s.reason === "expiring") return "Expiring soon";
  return "Active";
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 text-body-md">
      <span className="text-muted">{label}</span>
      <span className="text-right text-label-lg">{value}</span>
    </div>
  );
}
