"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Load data with `fn`; reload when `deps` change or `reload()` is called. Old data stays on screen
 * while new data loads (`loading` tells you), and a late answer to an old request is ignored.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]) {
  const [result, setResult] = useState<{ key: string; data?: T; error?: string }>({ key: "" });
  const [bump, setBump] = useState(0);
  const key = JSON.stringify(deps) + ":" + bump;
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    let alive = true;
    fnRef.current().then(
      (data) => alive && setResult({ key, data }),
      (e: unknown) => alive && setResult({ key, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      alive = false;
    };
  }, [key]);

  const reload = useCallback(() => setBump((n) => n + 1), []);
  const loading = result.key !== key;
  return { data: result.data, error: result.key === key || result.data === undefined ? result.error : undefined, loading, reload };
}

/** The current time in milliseconds, fixed when the screen first appears (keeps rendering pure). */
export function useNowMs(): number {
  const [now] = useState(() => Date.now());
  return now;
}

/** Debounce a fast-changing value (search boxes). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(async (text: string, id = "x") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    } catch {
      /* clipboard blocked: the text is on screen to copy by hand */
    }
  }, []);
  return { copy, copied };
}
