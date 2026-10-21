"use client";

import { useCallback, useEffect, useState } from "react";

const CHANGED = "ssbills-license-changed";

/** What the main process (electron/license.cjs) reports about the licence. */
export interface LicenseStatus {
  mode: "ok" | "warning" | "locked";
  reason: string | null;
  message: string;
  activated: boolean;
  enforced: boolean;
  needsActivation: boolean;
  plan?: string;
  restaurantName?: string;
  restaurantCode?: string;
  expiresAt?: string | null;
  daysLeft?: number | null;
  offlineDays?: number;
  graceDays?: number;
  graceLeft?: number;
  maxDevices?: number;
  lastCheckInAt?: string | null;
  lastAttemptAt?: string | null;
  lastError?: string | null;
  lastSyncedDate?: string | null;
  key?: string | null;
  machineId?: string;
}

export interface SyncResult {
  ok: boolean;
  message?: string;
  accepted?: number;
  skipped?: boolean;
  status: LicenseStatus;
}

/**
 * The licence status in the desktop app, refreshed every minute. `null` in a plain browser (no licensing there)
 * and until the first answer arrives.
 */
export function useLicense() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);

  const refresh = useCallback(async () => {
    const api = window.ssbills;
    if (!api) return;
    try {
      setStatus(await api.license<LicenseStatus>("status"));
    } catch {
      /* keep the last known status */
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const every = setInterval(() => void refresh(), 60_000);
    // Other parts of the screen (the top-bar chip, the Licence page) learn about a sync or activation at once.
    const onChange = () => void refresh();
    window.addEventListener(CHANGED, onChange);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      window.removeEventListener(CHANGED, onChange);
    };
  }, [refresh]);

  const syncNow = useCallback(async (): Promise<SyncResult | null> => {
    const api = window.ssbills;
    if (!api) return null;
    const r = await api.license<SyncResult>("syncNow");
    setStatus(r.status);
    window.dispatchEvent(new Event(CHANGED));
    return r;
  }, []);

  const activate = useCallback(async (key: string) => {
    const api = window.ssbills;
    if (!api) throw new Error("Activation is only available in the desktop app");
    setStatus(await api.license<LicenseStatus>("activate", { key }));
    window.dispatchEvent(new Event(CHANGED));
  }, []);

  return { status, refresh, syncNow, activate };
}
