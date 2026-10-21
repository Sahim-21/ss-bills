"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Logo } from "@/components/shell";
import { Button, Field, Icon, inputClass, cx } from "@/components/ui";

// First-launch license activation (PRD L-1, TRD §7.2). UI only: the real flow calls the
// `activate` Edge Function with the key + machine ID. Licensing timing is still open (O-2).
export default function ActivatePage() {
  const router = useRouter();
  const [groups, setGroups] = useState(["", "", "", ""]);
  const [restaurant, setRestaurant] = useState("Spice Garden");
  const [busy, setBusy] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const complete = groups.every((g) => g.length === 4);

  function setGroup(i: number, raw: string) {
    const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length > 4) {
      // Pasted a full key: spread it across the boxes.
      const all = clean.slice(0, 16).padEnd(16, "");
      setGroups([0, 1, 2, 3].map((k) => all.slice(k * 4, k * 4 + 4)));
      refs.current[Math.min(3, Math.floor(clean.length / 4))]?.focus();
      return;
    }
    setGroups((g) => g.map((v, k) => (k === i ? clean : v)));
    if (clean.length === 4) refs.current[i + 1]?.focus();
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="flex h-20 items-center justify-between px-8">
        <div className="flex items-center gap-3">
          <Logo size={44} />
          <div>
            <div className="text-headline-md leading-6">SS Bills</div>
            <div className="text-body-sm text-muted">Restaurant billing</div>
          </div>
        </div>
        <Link href="/" className="flex h-11 items-center gap-2 rounded-lg px-3 text-label-md text-muted hover:bg-surface-high">
          <Icon name="arrow_back" className="text-[20px]" /> Back to login
        </Link>
      </header>

      <div className="mx-auto mt-6 max-w-3xl px-6 pb-12">
        <div className="overflow-hidden rounded-3xl bg-surface-lowest shadow-level3">
          <div className="h-1.5 bg-gradient-to-r from-primary via-primary-container to-tertiary-container" />
          <div className="px-12 py-10">
            <div className="flex items-center justify-center gap-4">
              <Logo size={64} />
              <div>
                <div className="text-headline-lg">SS Bills</div>
                <div className="text-body-md text-muted">Offline-first restaurant billing</div>
              </div>
            </div>
            <h1 className="mt-8 text-center text-[36px] font-extrabold tracking-tight">Activate your license</h1>
            <p className="mx-auto mt-2 max-w-lg text-center text-body-lg text-muted">
              Enter the 16-character license key you received from SS Bills. This is needed once, with an internet connection.
            </p>

            <div className="mt-8 rounded-2xl bg-surface-low p-5">
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
                    }}
                    aria-label={`License key part ${i + 1}`}
                    placeholder="XXXX"
                    className="h-16 rounded-xl bg-surface-lowest text-center font-mono text-[26px] font-bold tracking-[0.25em] text-ink shadow-level1 outline-none placeholder:text-surface-highest focus:ring-2 focus:ring-primary"
                  />
                ))}
              </div>
            </div>

            <div className="mt-5">
              <Field label="Restaurant name" hint="Must match your registration">
                <input value={restaurant} onChange={(e) => setRestaurant(e.target.value)} className={inputClass} />
              </Field>
            </div>

            <Button
              variant="primary"
              size="lg"
              className="mt-7 w-full"
              icon={busy ? "progress_activity" : "verified"}
              disabled={!complete || busy}
              onClick={() => {
                setBusy(true);
                setTimeout(() => router.push("/"), 900);
              }}
            >
              {busy ? "Activating…" : "Activate & start billing"}
            </Button>

            <div className="mt-6 flex items-center justify-between rounded-xl bg-surface-low px-4 py-3 text-body-sm text-muted">
              <span className="flex items-center gap-2">
                <Icon name="memory" className="text-[18px]" /> This PC: <code className="rounded bg-surface-lowest px-2 py-0.5 font-mono text-ink">PC-8921-99A0</code>
              </span>
              <span className={cx("flex items-center gap-1")}>
                <Icon name="wifi_off" className="text-[18px]" /> After activation, billing works offline
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
