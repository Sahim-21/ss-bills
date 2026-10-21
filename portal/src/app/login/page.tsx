"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/shell";
import { Button, Field, Icon, cx, inputClass } from "@/components/ui";
import type { AuthStep } from "@/lib/api";
import { DEMO_CODE, DEMO_EMAIL } from "@/lib/demo/seed";
import { isDemo, usePortal } from "@/lib/portal";

export default function LoginPage() {
  const { api, me, checked, refreshMe } = usePortal();
  const router = useRouter();
  const [step, setStep] = useState<AuthStep | { next: "password" }>({ next: "password" });
  const [email, setEmail] = useState(isDemo() ? DEMO_EMAIL : "");
  const [password, setPassword] = useState(isDemo() ? "demo" : "");
  const [show, setShow] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (checked && me) router.replace("/");
  }, [checked, me, router]);

  async function run(job: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const finish = async () => {
    await refreshMe();
    router.replace("/");
  };

  const submitPassword = () =>
    run(async () => {
      const next = await api.auth.signIn(email, password);
      if (next.next === "done") return finish();
      setStep(next);
      setCode("");
    });

  const submitCode = () =>
    run(async () => {
      await api.auth.verifyMfa(code, step.next === "enroll" ? step.factorId : undefined);
      await finish();
    });

  const onStepTwo = step.next === "mfa" || step.next === "enroll";

  return (
    <div className="flex min-h-screen flex-col items-center bg-surface px-4 py-10">
      <div className="flex items-center gap-3">
        <Logo size={48} />
        <div>
          <div className="text-headline-lg leading-6">SS Bills</div>
          <div className="text-label-sm uppercase tracking-wider text-muted">Vendor Console</div>
        </div>
      </div>

      <div className="mt-12 w-full max-w-[520px] rounded-3xl bg-surface-lowest p-8 shadow-level3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 rounded-lg bg-surface-container px-3 py-1.5 text-label-md">
            <Icon name="lock" className="text-[16px]" /> Staff only
          </span>
          <span className={cx("text-label-md", isDemo() ? "text-hold-ink" : "text-tertiary")}>{isDemo() ? "Demo mode" : "Live"}</span>
        </div>

        <div className="mt-5 text-label-sm uppercase tracking-wider text-primary">Vendor admin console</div>
        <h1 className="mt-1 text-headline-xl">Sign in to your workspace</h1>
        <p className="mt-2 text-body-lg text-muted">Internal portal for SS Bills clients, licenses and sales.</p>

        <ol className="mt-6 flex gap-1 rounded-xl bg-surface-container p-1" aria-label="Sign-in steps">
          <li className={cx("flex h-11 flex-1 items-center justify-center gap-2 rounded-lg text-label-lg", !onStepTwo ? "bg-surface-lowest text-primary shadow-level1" : "text-muted")}>
            <Icon name="badge" className="text-[20px]" /> 1. Password
          </li>
          <li className={cx("flex h-11 flex-1 items-center justify-center gap-2 rounded-lg text-label-lg", onStepTwo ? "bg-surface-lowest text-primary shadow-level1" : "text-muted")}>
            <Icon name="shield_lock" className="text-[20px]" /> 2. Authenticator code
          </li>
        </ol>

        {!onStepTwo ? (
          <form
            className="mt-6 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void submitPassword();
            }}
          >
            <Field label="Email">
              <input type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="you@ssbills.in" />
            </Field>
            <Field label="Password">
              <div className="relative">
                <input
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={cx(inputClass, "pr-12")}
                />
                <button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:bg-surface-high">
                  <Icon name={show ? "visibility_off" : "visibility"} className="text-[20px]" />
                </button>
              </div>
            </Field>
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || !email || !password} icon={busy ? "progress_activity" : undefined}>
              {busy ? "Checking…" : "Continue"} {!busy && <Icon name="arrow_forward" className="text-[22px]" />}
            </Button>
          </form>
        ) : (
          <form
            className="mt-6 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void submitCode();
            }}
          >
            {step.next === "enroll" && (
              <div className="rounded-2xl bg-surface-low p-4">
                <p className="text-body-md">
                  <b>First sign-in:</b> scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy), then type the 6-digit code it shows.
                </p>
                <div className="mt-3 flex items-center gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={step.qr} alt="QR code to link your authenticator app" className="h-36 w-36 rounded-lg bg-white p-1" />
                  <div className="min-w-0 text-body-sm text-muted">
                    Can&apos;t scan? Type this key into the app:
                    <code className="mt-1 block break-all rounded bg-surface-lowest px-2 py-1 font-mono text-ink">{step.secret}</code>
                  </div>
                </div>
              </div>
            )}
            <Field label="6-digit code" hint={isDemo() ? `Demo code: ${DEMO_CODE}` : "From your authenticator app"}>
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className={cx(inputClass, "text-center font-mono text-[24px] tracking-[0.5em]")}
                placeholder="000000"
              />
            </Field>
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || code.length !== 6} icon={busy ? "progress_activity" : "verified_user"}>
              {busy ? "Verifying…" : "Verify and sign in"}
            </Button>
            <button type="button" onClick={() => { setStep({ next: "password" }); setError(null); }} className="w-full text-center text-label-md text-muted hover:text-ink">
              ← Back
            </button>
          </form>
        )}

        {error && (
          <div role="alert" className="mt-5 rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container">
            {error}
          </div>
        )}

        {isDemo() && (
          <div className="mt-6 rounded-xl bg-hold-surface px-4 py-3 text-body-sm text-hold-ink">
            <b>Demo mode.</b> No Supabase project is connected, so this runs on sample data kept in your browser. Everything is pre-filled: just press Continue, then use code <b>{DEMO_CODE}</b>.
          </div>
        )}
      </div>
    </div>
  );
}
