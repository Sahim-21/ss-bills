"use client";

import { useCallback, useEffect, useState } from "react";
import { SettingsSection } from "@/components/settings-ui";
import { Button, Card, Icon, Modal, Toggle } from "@/components/ui";
import { fmtDateTime } from "@/lib/hooks";

interface BackupFile {
  file: string;
  at: number;
  sizeBytes: number;
  kind: "auto" | "manual" | "pre-restore";
}
interface BackupStatus {
  dir: string;
  auto: boolean;
  backups: BackupFile[];
}

const KIND_LABEL = { auto: "Automatic", manual: "Manual", "pre-restore": "Saved before a restore" } as const;
const mb = (bytes: number) => (bytes / 1_048_576).toFixed(bytes < 1_048_576 ? 2 : 1);

// Backup and restore of the local database (PRD S-5, TRD §8). The main process does the work
// (electron/backup.cjs); folders and files are picked in system dialogs, never typed here.
export default function BackupSettingsPage() {
  const [data, setData] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<BackupFile | null>(null);
  const [restartMsg, setRestartMsg] = useState<string | null>(null);
  const desktop = typeof window !== "undefined" && !!window.ssbills;

  const run = useCallback(async (name: "status" | "now" | "setAuto" | "chooseFolder", arg?: unknown) => {
    setError(null);
    try {
      setData(await window.ssbills!.backup<BackupStatus>(name, arg));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (window.ssbills) {
      const t = setTimeout(() => void run("status"), 0);
      return () => clearTimeout(t);
    }
  }, [run]);

  async function restore(name: "restore" | "restoreFromFile", file?: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await window.ssbills!.backup<{ restarting?: boolean; cancelled?: boolean; savedAs?: string }>(name, { file });
      if (r.restarting) setRestartMsg(`Restoring… the app restarts in a moment. Your previous data was saved as ${r.savedAs}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setRestoring(null);
    }
  }

  if (!desktop) {
    return (
      <SettingsSection icon="settings_backup_restore" title="Backup & restore" subtitle="Backups run in the desktop app">
        <p className="text-body-md text-muted">This browser preview keeps no data on disk. Open the SS Bills desktop app to back up and restore.</p>
      </SettingsSection>
    );
  }
  if (!data) return null;
  const last = data.backups.find((b) => b.kind !== "pre-restore");

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container">
          <Icon name="error" className="icon-fill text-[20px]" /> {error}
        </div>
      )}
      {restartMsg && (
        <div role="status" className="flex items-start gap-2 rounded-xl bg-tertiary-fixed px-4 py-3 text-body-md text-tertiary">
          <Icon name="restart_alt" className="text-[20px]" /> {restartMsg}
        </div>
      )}

      <SettingsSection icon="settings_backup_restore" title="Backup & restore" subtitle="Your bills live on this PC. Keep regular copies in case the PC fails.">
        <div className="grid grid-cols-[1.2fr_1fr] gap-4">
          <Card className="flex items-center gap-4 bg-surface-low p-5">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-tertiary-fixed text-tertiary">
              <Icon name={last ? "cloud_done" : "cloud_off"} className="text-[30px]" />
            </span>
            <div className="flex-1">
              <div className="text-label-sm uppercase text-muted">Last backup</div>
              <div className="text-headline-sm">{last ? fmtDateTime(new Date(last.at).toISOString()) : "Never"}</div>
              <div className="text-body-sm text-muted">{last ? `${KIND_LABEL[last.kind]} · ${mb(last.sizeBytes)} MB` : "Back up now to protect your data"}</div>
            </div>
          </Card>
          <Button
            variant="primary"
            size="lg"
            icon={busy ? "progress_activity" : "backup"}
            className="h-auto"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await run("now");
              setBusy(false);
            }}
          >
            {busy ? "Backing up…" : "Back up now"}
          </Button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4">
          <div className="rounded-xl bg-surface-low p-4">
            <div className="text-label-lg">Save backups to</div>
            <div className="mt-1 flex items-center gap-2 break-all font-mono text-body-sm text-muted">
              <Icon name="folder" className="text-[18px]" /> {data.dir}
            </div>
            <Button size="sm" variant="secondary" icon="drive_file_move" className="mt-3" onClick={() => void run("chooseFolder")}>
              Change folder (USB drives work too)
            </Button>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-surface-low p-4">
            <div>
              <div className="text-label-lg">Automatic daily backup</div>
              <div className="text-body-sm text-muted">Once a day while the app is open · keeps the last 30</div>
            </div>
            <Toggle checked={data.auto} onChange={(v) => void run("setAuto", { auto: v })} label="Automatic daily backup" />
          </div>
        </div>
        <p className="mt-3 text-body-sm text-muted">
          A backup in the same PC does not protect you if the PC is lost or its disk fails. Choose a USB drive or a synced folder (for example Google Drive) and copy backups there regularly.
        </p>
      </SettingsSection>

      <SettingsSection icon="history" title="Recent backups" subtitle="Restore replaces everything on this PC with the backup">
        {data.backups.length === 0 ? (
          <p className="text-body-md text-muted">No backups in this folder yet.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-left">
              <thead className="bg-surface-low text-label-md uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">File</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Size</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-low">
                {data.backups.map((b) => (
                  <tr key={b.file} className="hover:bg-surface-low">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-mono text-label-md">
                        <Icon name="description" className="text-[18px] text-muted" /> {b.file}
                      </div>
                      <div className="text-body-sm text-muted">{KIND_LABEL[b.kind]}</div>
                    </td>
                    <td className="tnum px-4 py-3 text-body-md">{fmtDateTime(new Date(b.at).toISOString())}</td>
                    <td className="tnum px-4 py-3 text-right text-body-md">{mb(b.sizeBytes)} MB</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="soft" icon="restore" disabled={busy} onClick={() => setRestoring(b)}>
                        Restore
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Button variant="secondary" icon="folder_open" className="mt-4" disabled={busy} onClick={() => void restore("restoreFromFile")}>
          Restore from a file…
        </Button>
      </SettingsSection>

      <Modal open={!!restoring} onClose={() => setRestoring(null)} className="max-w-lg" labelledBy="restore-title">
        <div className="bg-error px-6 py-2 text-label-sm uppercase tracking-wider text-white">Restore from backup</div>
        <div className="space-y-4 p-6">
          <h2 id="restore-title" className="text-headline-md">
            Restore this backup?
          </h2>
          <div className="rounded-xl bg-error-container/60 p-4 text-body-md text-on-error-container">
            <b>Everything on this PC will be replaced</b> with the backup, including held bills. Bills made after{" "}
            {restoring && fmtDateTime(new Date(restoring.at).toISOString())} are saved to a separate file first, so nothing is lost. The app restarts afterwards.
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-surface-low px-4 py-3 font-mono text-label-md">
            <Icon name="description" className="text-[18px]" /> {restoring?.file}
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setRestoring(null)} kbd="Esc">
              Cancel
            </Button>
            <Button variant="danger" icon="restore" disabled={busy} onClick={() => restoring && void restore("restore", restoring.file)}>
              {busy ? "Restoring…" : "Restore & restart"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
