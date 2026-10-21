"use client";

// Chooses the backend (real Supabase when configured, otherwise the browser demo), tracks who is signed in,
// and makes the API available to every screen.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PortalApi } from "./api";
import type { Me } from "./types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type Ctx = {
  api: PortalApi;
  me: Me | null;
  /** Set after sign-in or sign-out so screens re-check who is signed in. */
  refreshMe: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Demo mode only: wipe the browser copy and rebuild the sample data. */
  resetDemo: (() => Promise<void>) | null;
  /** False until the first "who am I" check finishes (avoids flashing the login page). */
  checked: boolean;
};

const PortalContext = createContext<Ctx | null>(null);

type Boot = { api: PortalApi; reset: (() => Promise<void>) | null } | { error: string };

export function PortalProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (SUPABASE_URL && SUPABASE_KEY) {
          const { createSupabaseApi } = await import("./supabase-api");
          return { api: createSupabaseApi(SUPABASE_URL, SUPABASE_KEY), reset: null };
        }
        const { createDemoApi } = await import("./demo/demo-api");
        const demo = await createDemoApi();
        return { api: demo.api, reset: demo.reset };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    })().then((b) => alive && setBoot(b));
    return () => {
      alive = false;
    };
  }, []);

  const api = boot && "api" in boot ? boot.api : null;

  useEffect(() => {
    if (!api) return;
    let alive = true;
    api.auth
      .me()
      .catch(() => null)
      .then((m) => {
        if (!alive) return;
        setMe(m);
        setChecked(true);
      });
    return () => {
      alive = false;
    };
  }, [api]);

  const refreshMe = useCallback(async () => {
    if (!api) return;
    setMe(await api.auth.me().catch(() => null));
    setChecked(true);
  }, [api]);

  const signOut = useCallback(async () => {
    await api?.auth.signOut();
    setMe(null);
  }, [api]);

  const value = useMemo<Ctx | null>(
    () =>
      boot && "api" in boot
        ? {
            api: boot.api,
            me,
            refreshMe,
            signOut,
            checked,
            resetDemo: boot.reset
              ? async () => {
                  await boot.reset!();
                  await boot.api.auth.signOut();
                  setMe(null);
                }
              : null,
          }
        : null,
    [boot, me, refreshMe, signOut, checked],
  );

  if (!boot) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="text-center text-muted">
          <div className="material-symbols-outlined animate-spin text-[32px] text-primary">progress_activity</div>
          <p className="mt-3 text-body-md">{SUPABASE_URL ? "Connecting…" : "Preparing demo data…"}</p>
        </div>
      </div>
    );
  }
  if ("error" in boot || !value) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface p-8">
        <div role="alert" className="max-w-lg rounded-2xl border border-error bg-error-container p-6 text-on-error-container">
          <h1 className="text-headline-md">The console could not start</h1>
          <p className="mt-2 text-body-md">{"error" in boot ? boot.error : "Unknown error"}</p>
        </div>
      </div>
    );
  }
  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortal(): Ctx {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error("usePortal must be used inside <PortalProvider>");
  return ctx;
}

export const useApi = () => usePortal().api;
export const isDemo = () => !(SUPABASE_URL && SUPABASE_KEY);
