"use client";

import { useRef, useState } from "react";
import { Logo } from "@/components/shell";
import { Button, Icon } from "@/components/ui";

/** Four boxes for the 16-character licence key. A pasted key is spread across the boxes. */
export function ActivationPanel({ onActivate, machineId }: { onActivate: (key: string) => Promise<void>; machineId?: string }) {
  const [groups, setGroups] = useState(["", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const complete = groups.every((g) => g.length === 4);

  function setGroup(i: number, raw: string) {
    setError(null);
    const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length > 4) {
      const all = clean.slice(0, 16).padEnd(16, "");
      setGroups([0, 1, 2, 3].map((k) => all.slice(k * 4, k * 4 + 4)));
      refs.current[Math.min(3, Math.floor(clean.length / 4))]?.focus();
      return;
    }
    setGroups((g) => g.map((v, k) => (k === i ? clean : v)));
    if (clean.length === 4) refs.current[i + 1]?.focus();
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onActivate(groups.join("-"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="rounded-2xl bg-surface-low p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2 text-label-md uppercase text-ink-variant">
            <Icon name="key" className="text-[18px] text-primary" /> License key
          </span>
          <span className="text-body-sm text-muted">Paste the full key into any box</span>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {groups.map((g, i) => (
            <input
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              value={g}
              onChange={(e) => setGroup(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && g === "" && i > 0) refs.current[i - 1]?.focus();
                if (e.key === "Enter" && complete && !busy) void submit();
              }}
              aria-label={`License key part ${i + 1}`}
              placeholder="XXXX"
              className="h-16 rounded-xl bg-surface-lowest text-center font-mono text-[26px] font-bold tracking-[0.25em] text-ink shadow-level1 outline-none placeholder:text-surface-highest focus:ring-2 focus:ring-primary"
            />
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container">
          <Icon name="error" className="icon-fill text-[20px]" /> {error}
        </div>
      )}

      <Button variant="primary" size="lg" className="mt-6 w-full" icon={busy ? "progress_activity" : "verified"} disabled={!complete || busy} onClick={() => void submit()}>
        {busy ? "Activating…" : "Activate & start billing"}
      </Button>

      <div className="mt-5 flex items-center justify-between rounded-xl bg-surface-low px-4 py-3 text-body-sm text-muted">
        <span className="flex items-center gap-2">
          <Icon name="memory" className="text-[18px]" /> This PC: <code className="rounded bg-surface-lowest px-2 py-0.5 font-mono text-ink">{machineId ?? "…"}</code>
        </span>
        <span className="flex items-center gap-1">
          <Icon name="wifi_off" className="text-[18px]" /> After activation, billing works offline
        </span>
      </div>
    </div>
  );
}

/** Shown before anything else on a PC that has not been activated (PRD L-1). */
export function ActivationScreen({ onActivate, machineId, message }: { onActivate: (key: string) => Promise<void>; machineId?: string; message?: string }) {
  return (
    <div className="min-h-screen bg-surface">
      <header className="flex h-20 items-center px-8">
        <div className="flex items-center gap-3">
          <Logo size={44} />
          <div>
            <div className="text-headline-md leading-6">SS Bills</div>
            <div className="text-body-sm text-muted">Restaurant billing</div>
          </div>
        </div>
      </header>
      <div className="mx-auto mt-6 max-w-3xl px-6 pb-12">
        <div className="overflow-hidden rounded-3xl bg-surface-lowest shadow-level3">
          <div className="h-1.5 bg-gradient-to-r from-primary via-primary-container to-tertiary-container" />
          <div className="px-12 py-10">
            <h1 className="text-center text-[36px] font-extrabold tracking-tight">Activate your license</h1>
            <p className="mx-auto mt-2 max-w-lg text-center text-body-lg text-muted">
              Enter the 16-character license key you received from SS Bills. This is needed once, with an internet connection.
            </p>
            {message && <p className="mx-auto mt-3 max-w-lg text-center text-body-md text-hold-ink">{message}</p>}
            <div className="mt-8">
              <ActivationPanel onActivate={onActivate} machineId={machineId} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
