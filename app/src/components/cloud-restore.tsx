"use client";

// Shown at the top of the first-run setup when this PC is activated and SS Bills holds a saved copy of the restaurant's menu and
// settings (D-043). Restoring needs only a new Admin name and PIN: PINs, staff and bills are never part of the copy.
import { useEffect, useState } from "react";
import type { SsbillsApi } from "@/lib/desktop";
import { fmtDateLong } from "@/lib/hooks";
import { Button, Field, Icon, inputClass } from "./ui";

interface Summary {
  restaurantName: string;
  items: number;
  categories: number;
  tables: number;
  savedAt: string | null;
}
type Found = { found: false; reason?: string } | { found: true; summary: Summary };

export function CloudRestore({ api, onDone }: { api: SsbillsApi; onDone: () => void }) {
  const [state, setState] = useState<"checking" | "none" | "found" | "error">("checking");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const [adminName, setAdminName] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .menu<Found>("findCloudCopy")
      .then((r) => {
        if (!alive) return;
        if (r.found) {
          setSummary(r.summary);
          setState("found");
        } else setState("none");
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const text = e instanceof Error ? e.message : String(e);
        // licence checks switched off (development) is not a problem worth showing
        if (/switched off/i.test(text)) setState("none");
        else {
          setMessage(text);
          setState("error");
        }
      });
    return () => {
      alive = false;
    };
  }, [api, attempt]);

  if (state === "none") return null;
  if (state === "checking") return <p className="mt-4 text-center text-body-sm text-muted">Checking whether SS Bills holds a saved copy of your menu…</p>;
  if (state === "error") {
    return (
      <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl bg-surface-low px-5 py-3 text-body-md text-muted">
        <span>Could not check for a saved menu ({message}). You can set up from scratch below, or try again.</span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setState("checking");
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  const valid = adminName.trim().length > 0 && /^\d{4}$/.test(pin) && pin === pin2;
  async function restore() {
    setBusy(true);
    setError(null);
    try {
      await api.menu("restoreCloudCopy", { adminName: adminName.trim(), pin });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-tertiary bg-[#f0fdf4] p-5" role="region" aria-label="Saved menu found">
      <div className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-tertiary text-white">
          <Icon name="cloud_download" />
        </span>
        <div className="flex-1">
          <h2 className="text-headline-sm text-tertiary">We found your saved menu</h2>
          <p className="mt-1 text-body-md text-ink">
            {summary?.restaurantName}: <b>{summary?.items}</b> menu items in <b>{summary?.categories}</b> categories, <b>{summary?.tables}</b> tables, with your GST and receipt settings
            {summary?.savedAt ? ` (saved ${fmtDateLong(summary.savedAt)})` : ""}.
          </p>
          <p className="mt-1 text-body-sm text-muted">
            Staff, PINs and past bills are not saved in the cloud, so you choose a new Admin PIN here. Add cashiers later in Settings → Staff. Bills stay on the PC they were made on.
          </p>
          {!open ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="primary" icon="restore" onClick={() => setOpen(true)}>
                Restore my menu
              </Button>
              <span className="text-body-sm text-muted">or fill in the steps below to start from scratch</span>
            </div>
          ) : (
            <div className="mt-4 space-y-3 rounded-xl bg-surface-lowest p-4">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Admin name *">
                  <input autoFocus value={adminName} onChange={(e) => setAdminName(e.target.value)} className={inputClass} placeholder="e.g. Manish" />
                </Field>
                <Field label="New 4-digit PIN *">
                  <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} className={inputClass} inputMode="numeric" type="password" autoComplete="off" />
                </Field>
                <Field label="Repeat PIN *" hint={pin2 && pin !== pin2 ? <span className="text-error">PINs do not match</span> : undefined}>
                  <input value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 4))} className={inputClass} inputMode="numeric" type="password" autoComplete="off" />
                </Field>
              </div>
              {error && (
                <div role="alert" className="flex items-start gap-2 rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container">
                  <Icon name="error" className="icon-fill text-[20px]" /> {error}
                </div>
              )}
              <div className="flex items-center gap-3">
                <Button variant="primary" icon={busy ? "progress_activity" : "restore"} disabled={!valid || busy} onClick={() => void restore()}>
                  {busy ? "Restoring…" : "Restore and start"}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
