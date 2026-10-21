"use client";

import { useState } from "react";
import { SettingsSection } from "@/components/settings-ui";
import { Button, Card, Icon, Modal, Segmented, Toggle } from "@/components/ui";
import { fmtDateTime } from "@/lib/hooks";
import { MOCK_BACKUPS } from "@/lib/mock-data";

type Backup = (typeof MOCK_BACKUPS)[number];

// Backup & restore of the local SQLite file (PRD S-5, TRD §8). UI only for now.
export default function BackupSettingsPage() {
  const [backups, setBackups] = useState<Backup[]>(MOCK_BACKUPS);
  const [dest, setDest] = useState<"folder" | "usb">("folder");
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<Backup | null>(null);
  const last = backups[0];

  return (
    <div className="space-y-4">
      <SettingsSection icon="settings_backup_restore" title="Backup & restore" subtitle="Your bills live on this PC. Keep regular copies in case the PC fails.">
        <div className="grid grid-cols-[1.2fr_1fr] gap-4">
          <Card className="flex items-center gap-4 bg-surface-low p-5">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-tertiary-fixed text-tertiary">
              <Icon name="cloud_done" className="text-[30px]" />
            </span>
            <div className="flex-1">
              <div className="text-label-sm uppercase text-muted">Last backup</div>
              <div className="text-headline-sm">{last ? fmtDateTime(last.at) : "Never"}</div>
              <div className="text-body-sm text-muted">{last ? `${last.dest} · ${last.sizeMb} MB` : "Back up now to protect your data"}</div>
            </div>
          </Card>
          <Button
            variant="primary"
            size="lg"
            icon={busy ? "progress_activity" : "backup"}
            className="h-auto"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setTimeout(() => {
                const now = new Date();
                const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
                setBackups((b) => [{ file: `ssbills_${stamp}.db`, at: now.toISOString(), sizeMb: 35.1, dest: dest === "usb" ? "USB drive" : "Local folder", auto: false }, ...b]);
                setBusy(false);
              }, 900);
            }}
          >
            {busy ? "Backing up…" : "Back up now"}
          </Button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4">
          <div>
            <div className="mb-2 text-label-lg">Save backups to</div>
            <Segmented
              value={dest}
              onChange={setDest}
              options={[
                { value: "folder", label: "Folder on this PC", icon: "folder" },
                { value: "usb", label: "USB drive", icon: "usb" },
              ]}
            />
          </div>
          <div className="flex items-center justify-between rounded-xl bg-surface-low p-4">
            <div>
              <div className="text-label-lg">Automatic daily backup</div>
              <div className="text-body-sm text-muted">At closing time · keeps the last 30</div>
            </div>
            <Toggle checked={auto} onChange={setAuto} label="Automatic daily backup" />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection icon="history" title="Recent backups" subtitle="Restore replaces everything on this PC with the backup">
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-left">
            <thead className="bg-surface-low text-label-md uppercase text-muted">
              <tr>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Saved to</th>
                <th className="px-4 py-3 text-right">Size</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-low">
              {backups.map((b) => (
                <tr key={b.file} className="hover:bg-surface-low">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-mono text-label-md">
                      <Icon name="description" className="text-[18px] text-muted" /> {b.file}
                    </div>
                    <div className="text-body-sm text-muted">{b.auto ? "Automatic" : "Manual"}</div>
                  </td>
                  <td className="tnum px-4 py-3 text-body-md">{fmtDateTime(b.at)}</td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5 rounded-full bg-surface-container px-2.5 py-1 text-label-md w-fit">
                      <Icon name={b.dest === "USB drive" ? "usb" : "folder"} className="text-[16px]" /> {b.dest}
                    </span>
                  </td>
                  <td className="tnum px-4 py-3 text-right text-body-md">{b.sizeMb} MB</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="soft" icon="restore" onClick={() => setRestoring(b)}>
                      Restore
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsSection>

      <Modal open={!!restoring} onClose={() => setRestoring(null)} className="max-w-lg" labelledBy="restore-title">
        <div className="bg-error px-6 py-2 text-label-sm uppercase tracking-wider text-white">Restore from backup</div>
        <div className="space-y-4 p-6">
          <h2 id="restore-title" className="text-headline-md">
            Restore this backup?
          </h2>
          <div className="rounded-xl bg-error-container/60 p-4 text-body-md text-on-error-container">
            <b>Everything on this PC will be replaced</b> with the backup, including held bills. Bills made after{" "}
            {restoring && fmtDateTime(restoring.at)} are saved to a separate file first, so nothing is lost. The app restarts afterwards.
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-surface-low px-4 py-3 font-mono text-label-md">
            <Icon name="description" className="text-[18px]" /> {restoring?.file}
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setRestoring(null)} kbd="Esc">
              Cancel
            </Button>
            <Button variant="danger" icon="restore" onClick={() => setRestoring(null)}>
              Restore & restart
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
