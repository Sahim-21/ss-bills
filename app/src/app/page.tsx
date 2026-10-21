"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useState } from "react";
import { Logo, RoleBadge, StaffAvatar } from "@/components/shell";
import { Card, Icon, cx } from "@/components/ui";
import { fmtDateLong, fmtTime, isSameDay, useNow, useOnline } from "@/lib/hooks";
import { formatINRShort } from "@/lib/money";
import { usePos } from "@/lib/pos-store";

const PIN_LENGTH = 4;

export default function LoginPage() {
  const { state, dispatch, openBills, verifyPin, tables } = usePos();
  const router = useRouter();
  const now = useNow();
  const online = useOnline();
  const active = state.staff.filter((s) => s.active);
  const [selectedId, setSelectedId] = useState(active.find((s) => s.role === "cashier")?.id ?? active[0]?.id);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const selected = active.find((s) => s.id === selectedId);

  const todays = state.paid.filter((b) => b.status === "paid" && isSameDay(b.paidAt, now));
  const todaySales = todays.reduce((s, b) => s + b.totalPaise, 0);
  const occupied = new Set(openBills.map((b) => b.tableId).filter(Boolean)).size;

  const submit = async (value: string) => {
    if (!selected) return;
    const ok = await verifyPin(selected.id, value).catch(() => false);
    if (ok) {
      dispatch({ type: "login", userId: selected.id });
      router.push("/billing/");
    } else {
      setError(true);
      setPin("");
    }
  };

  const press = (d: string) => {
    setError(false);
    if (pin.length >= PIN_LENGTH) return;
    const next = pin + d;
    setPin(next);
    if (next.length === PIN_LENGTH) setTimeout(() => void submit(next), 120);
  };

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
    else if (e.key === "Escape") setPin("");
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="min-h-screen bg-surface">
      <header className="flex h-20 items-center justify-between px-8">
        <div className="flex items-center gap-3">
          <Logo size={44} />
          <div>
            <div className="text-headline-md leading-6">{state.profile.name}</div>
            <div className="text-label-sm uppercase text-primary">Powered by SS Bills</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="tnum flex items-center gap-2 rounded-full border border-line bg-surface-lowest px-4 py-2 text-label-lg">
            <Icon name="schedule" className="text-[20px]" />
            {fmtDateLong(now)} · {fmtTime(now)}
            <span className={cx("ml-2 flex items-center gap-1.5 text-label-md", online ? "text-tertiary" : "text-hold-ink")}>
              <span className={cx("h-2 w-2 rounded-full", online ? "bg-tertiary" : "bg-hold")} />
              {online ? "ONLINE" : "OFFLINE"}
            </span>
          </div>
          <Link
            href="/activate/"
            className="flex h-11 items-center gap-2 rounded-lg px-3 text-label-md text-muted hover:bg-surface-high"
            title="First-launch license activation (preview)"
          >
            <Icon name="key" className="text-[20px]" /> License
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-8 pb-8">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-primary-fixed px-4 py-1.5 text-label-md uppercase text-on-primary-fixed">
            <Icon name="lock" className="text-[16px]" /> Counter locked
          </span>
          <h1 className="mt-4 text-[40px] font-extrabold leading-tight tracking-tight">Welcome to {state.profile.name}</h1>
          <p className="mt-2 text-body-lg text-muted">Pick your profile and enter your {PIN_LENGTH}-digit PIN to start billing.</p>
        </div>

        <div className="mt-8 grid grid-cols-[1fr_440px] gap-10">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-headline-sm">
                <Icon name="badge" className="text-primary" /> Staff
              </h2>
              <span className="rounded-full bg-surface-container px-3 py-1 text-label-md text-muted">{active.length} active</span>
            </div>
            <div className="space-y-3">
              {active.map((s) => {
                const isSel = s.id === selectedId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(s.id);
                      setPin("");
                      setError(false);
                    }}
                    className={cx(
                      "flex w-full items-center gap-4 rounded-2xl border bg-surface-lowest p-4 text-left transition-all",
                      isSel ? "border-l-4 border-primary shadow-level2" : "border-line shadow-level1 hover:border-line-strong",
                    )}
                  >
                    <StaffAvatar name={s.name} size={52} className={isSel ? "" : "bg-surface-container text-ink"} />
                    <span className="flex-1">
                      <span className="block text-headline-sm">{s.name}</span>
                      <span className="mt-1 block">
                        <RoleBadge role={s.role} />
                      </span>
                    </span>
                    {isSel && (
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white">
                        <Icon name="check" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <Card className="flex items-center gap-4 p-4">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-fixed text-primary">
                  <Icon name="payments" />
                </span>
                <div>
                  <div className="text-label-sm uppercase text-muted">Today&apos;s sales</div>
                  <div className="tnum text-headline-md">{formatINRShort(todaySales)}</div>
                  <div className="text-body-sm text-muted">{todays.length} bills</div>
                </div>
              </Card>
              <Card className="flex items-center gap-4 p-4">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-container">
                  <Icon name="table_restaurant" />
                </span>
                <div>
                  <div className="text-label-sm uppercase text-muted">Tables occupied</div>
                  <div className="tnum text-headline-md">
                    {occupied} / {tables.length}
                  </div>
                  <div className="text-body-sm text-muted">{state.held.length} held bills</div>
                </div>
              </Card>
            </div>
          </section>

          <Card className="p-7">
            <div className="text-center">
              <span className="inline-flex items-center gap-2 rounded-full bg-surface-container px-4 py-1.5 text-label-md">
                <Icon name="person" className="text-[16px]" />
                Unlocking as <b className="text-primary">{selected?.name}</b>
              </span>
              <div className="mt-5 text-label-md uppercase tracking-wider text-ink-variant">Enter {PIN_LENGTH}-digit PIN</div>
              <div className={cx("mt-4 flex justify-center gap-4", error && "animate-[shake_0.3s]")}>
                {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                  <span
                    key={i}
                    className={cx(
                      "h-5 w-5 rounded-full border-2 transition-all",
                      i < pin.length ? "border-primary bg-primary" : error ? "border-error" : "border-line-strong",
                    )}
                  />
                ))}
              </div>
              <div className={cx("mt-3 h-5 text-body-md", error ? "text-error" : "text-muted")}>
                {error ? "Wrong PIN. Try again." : "Unlocks automatically after the last digit"}
              </div>
            </div>

            <div className="mx-auto mt-4 grid max-w-[320px] grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <PinKey key={d} onClick={() => press(d)}>
                  {d}
                </PinKey>
              ))}
              <PinKey onClick={() => setPin("")} small>
                Clear
              </PinKey>
              <PinKey onClick={() => press("0")}>0</PinKey>
              <PinKey onClick={() => setPin((p) => p.slice(0, -1))} small ariaLabel="Delete digit">
                <Icon name="backspace" className="text-[26px]" />
              </PinKey>
            </div>

            <p className="mt-6 rounded-xl bg-surface-low px-4 py-3 text-center text-body-sm text-muted">
              Forgot your PIN? Ask an Admin to reset it in Settings → Staff.
              <br />
              <span className="font-semibold text-ink-variant">Demo PINs:</span> Admin 1234 · Cashiers 1111 / 2222
            </p>
          </Card>
        </div>
      </div>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}`}</style>
    </div>
  );
}

function PinKey({
  children,
  onClick,
  small,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  small?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cx(
        "tnum flex h-16 items-center justify-center rounded-2xl bg-surface-low font-bold text-ink shadow-level1 transition-all hover:bg-surface-high active:scale-95",
        small ? "text-label-lg" : "text-[28px]",
      )}
    >
      {children}
    </button>
  );
}
