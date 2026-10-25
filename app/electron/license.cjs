// Licence activation, status and daily summary sync (docs/TRD.md §7.4). Runs in the Electron main process.
// The UI can only ask for the status, activate with a key, or ask for a sync now. It never sees the network.
// Billing must keep working offline: every network failure here is caught, remembered, and retried later.
const { evaluate, shouldSync, verifySigned } = require("./license-logic.cjs");
const { snapshotHash, validateSnapshot, summarize } = require("./snapshot.cjs");

const KEY_RE = /^[0-9A-F]{16}$/;
const NEEDS_ACTIVATION = new Set(["unactivated", "damaged"]);
const PROBLEMS = {
  device_not_bound: "This PC is no longer linked to the licence. Activate again with your key, or contact SS Bills.",
  invalid_key: "This licence key has been replaced or removed. Enter the new key you received from SS Bills.",
};

const UNAVAILABLE = "SS Bills is not available right now. Please try again later";
/** The message to show for a refusal. Only our own functions send `ok: false` with a `code` (Supabase's own error pages also have a code, so that alone is not enough); any other reply (a platform error page) is not shown. */
const refusal = (reply, fallback) => (reply && reply.ok === false && typeof reply.code === "string" && reply.message ? String(reply.message) : fallback ?? UNAVAILABLE);

/** "abcd 1234-..." -> "ABCD-1234-...", or null if it is not a 16-character key. */
function normalizeKey(raw) {
  const clean = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!KEY_RE.test(clean)) return null;
  return clean.match(/.{4}/g).join("-");
}

/** When SS Bills last answered, by SS Bills' own clock (inside the signed answer), not this PC's clock. */
const answeredAt = (status, fallbackMs) => {
  const t = Date.parse(status?.server_time);
  return Number.isFinite(t) ? t : fallbackMs;
};

const dateOnly = (ms, offsetDays = 0) => new Date(ms + 5.5 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

/**
 * @param o.meta            { get(key), set(key, value|null) } persistent storage (app_meta)
 * @param o.summariesSince  (date) => daily summaries to upload
 * @param o.config          { publicKey, apiUrl }
 * @param o.fetchFn         fetch (injectable for tests)
 * @param o.machineId       () => stable id of this PC
 * @param o.enforce         false = licence checks switched off (SSBILLS_LICENSE=off, for development)
 * @param o.buildSnapshot   () => the menu-and-settings copy to keep in the cloud, or null if the PC is not set up yet
 */
function createLicenseService(o) {
  const { meta, config } = o;
  const now = o.now ?? (() => Date.now());
  const fetchFn = o.fetchFn ?? fetch;
  const num = (k) => Number(meta.get(k)) || 0;
  const json = (k) => {
    try {
      const v = meta.get(k);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  };

  /** The saved signed answer, re-verified every time so editing the database file cannot fake a longer licence. */
  function load() {
    const key = meta.get("license_key");
    const signed = json("license_status");
    let status = null;
    let damaged = false;
    if (key && signed) {
      try {
        status = verifySigned(signed, config.publicKey, { key, machine: o.machineId() });
      } catch {
        damaged = true;
      }
    }
    // The time of the last check-in is taken from the signed answer (see evaluate in license-logic.cjs); the plain stored
    // value is only what is shown if an answer carries no time.
    return { key, status, damaged, lastCheckInMs: num("license_last_checkin"), lastSeenMs: num("license_last_seen"), problem: json("license_problem") };
  }

  /** When SS Bills last answered, as proven by the signed answer (0 if there is none). */
  function lastGoodCheckIn() {
    const s = load();
    const t = s.status ? Date.parse(s.status.server_time) : NaN;
    return Number.isFinite(t) ? t : s.status ? s.lastCheckInMs : 0;
  }

  function getStatus() {
    if (o.enforce === false) return { mode: "ok", reason: null, message: "", activated: true, enforced: false, needsActivation: false };
    const s = load();
    const t = now();
    const r = s.damaged
      ? { mode: "locked", reason: "damaged", message: "The licence data on this PC could not be verified. Activate again with your key.", activated: false }
      : evaluate(s, t);
    if (t - s.lastSeenMs > 60_000) meta.set("license_last_seen", String(Math.max(t, s.lastSeenMs)));
    return {
      ...r,
      enforced: true,
      needsActivation: NEEDS_ACTIVATION.has(r.reason),
      key: s.key ?? null,
      machineId: o.machineId(),
      lastAttemptAt: num("license_last_attempt") ? new Date(num("license_last_attempt")).toISOString() : null,
      lastError: meta.get("license_last_error") || null,
      lastSyncedDate: meta.get("license_synced_date") || null,
      menuSavedAt: num("menu_uploaded_at") ? new Date(num("menu_uploaded_at")).toISOString() : null,
      menuError: meta.get("menu_last_error") || null,
    };
  }

  async function post(path, body) {
    let res;
    try {
      res = await fetchFn(`${config.apiUrl.replace(/\/+$/, "")}/functions/v1/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error("Could not reach SS Bills. Check the internet connection and try again");
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* not JSON: handled below */
    }
    if (!data || typeof data !== "object") throw new Error(UNAVAILABLE);
    return data;
  }

  async function activate(rawKey) {
    if (o.enforce === false) return getStatus();
    const key = normalizeKey(rawKey);
    if (!key) throw new Error("Enter the full 16-character licence key");
    const machine = o.machineId();
    const reply = await post("activate", { key, machineId: machine, deviceName: o.deviceName?.() ?? "", appVersion: o.appVersion ?? "" });
    if (reply.ok !== true) throw new Error(refusal(reply));
    const status = verifySigned(reply, config.publicKey, { key, machine }); // throws if the answer is not genuinely from SS Bills
    meta.set("license_key", key);
    meta.set("license_status", JSON.stringify({ payload: reply.payload, sig: reply.sig }));
    meta.set("license_last_checkin", String(answeredAt(status, now())));
    meta.set("license_last_attempt", String(now()));
    meta.set("license_problem", null);
    meta.set("license_last_error", null);
    meta.set("license_synced_date", null); // a fresh activation uploads the whole history once
    meta.set("menu_uploaded_hash", null); // ...and the menu copy
    return getStatus();
  }

  /**
   * Keep the cloud copy of the menu and settings up to date. Runs after each good check-in, and a minute after the menu is
   * changed (main.cjs). Sends nothing when the menu has not changed since the last successful upload. Never throws: a failure is
   * remembered for the Backup screen and retried at the next check-in. Billing never waits for it.
   */
  async function uploadMenu() {
    if (o.enforce === false || !o.buildSnapshot) return { ok: true, skipped: true };
    const key = meta.get("license_key");
    if (!key) return { ok: false, message: "Not activated" };
    try {
      const snapshot = o.buildSnapshot();
      if (!snapshot) return { ok: true, skipped: true }; // not set up yet: nothing to save
      const checked = validateSnapshot(snapshot);
      if (!checked.ok) throw new Error(`The menu could not be saved: ${checked.error}`);
      const hash = snapshotHash(checked.snapshot);
      if (hash === meta.get("menu_uploaded_hash")) return { ok: true, unchanged: true };
      const reply = await post("menu", { action: "put", key, machineId: o.machineId(), snapshot: checked.snapshot });
      if (reply.ok !== true) throw new Error(refusal(reply));
      meta.set("menu_uploaded_hash", hash);
      meta.set("menu_uploaded_at", String(now()));
      meta.set("menu_last_error", null);
      return { ok: true, stored: reply.stored === true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      meta.set("menu_last_error", message);
      return { ok: false, message };
    }
  }

  /**
   * Download the saved menu copy for a restore on a new PC. The answer is signed by SS Bills (same check as a licence answer)
   * and the copy itself is checked field by field before anything is used. Throws a plain-language Error on any problem.
   * @returns { found: false } or { found: true, snapshot, savedAt, summary }
   */
  async function fetchMenu() {
    if (o.enforce === false) throw new Error("Licence checks are switched off on this copy");
    const key = meta.get("license_key");
    if (!key) throw new Error("Activate SS Bills with your licence key first");
    const machine = o.machineId();
    const reply = await post("menu", { action: "get", key, machineId: machine });
    if (reply.ok !== true) throw new Error(refusal(reply));
    if (reply.found === false) return { found: false };
    const payload = verifySigned(reply, config.publicKey, { key, machine });
    if (payload.kind !== "menu") throw new Error("The server's answer was not a menu copy");
    const checked = validateSnapshot(payload.snapshot);
    if (!checked.ok) throw new Error(checked.error);
    return { found: true, snapshot: checked.snapshot, savedAt: payload.saved_at ?? null, summary: summarize(checked.snapshot, payload.saved_at) };
  }

  let syncing = null;
  /** Upload daily totals and refresh the licence. Never throws: returns { ok, message }. */
  function syncNow() {
    if (o.enforce === false) return Promise.resolve({ ok: true, skipped: true });
    if (syncing) return syncing;
    syncing = (async () => {
      const key = meta.get("license_key");
      if (!key) return { ok: false, message: "Not activated" };
      meta.set("license_last_attempt", String(now()));
      const machine = o.machineId();
      const lastSynced = meta.get("license_synced_date");
      // Re-send the last 2 days too: a late payment or cancellation changes a day that was already uploaded.
      const since = lastSynced ? dateOnly(Date.parse(`${lastSynced}T00:00:00Z`) - 5.5 * 3600_000, -2) : "2000-01-01";
      const summaries = o.summariesSince(since);
      try {
        const reply = await post("sync", { key, machineId: machine, appVersion: o.appVersion ?? "", summaries });
        if (reply.ok !== true) {
          if (PROBLEMS[reply.code]) meta.set("license_problem", JSON.stringify({ code: reply.code, message: PROBLEMS[reply.code] }));
          throw new Error(refusal(reply));
        }
        const status = verifySigned(reply, config.publicKey, { key, machine });
        meta.set("license_status", JSON.stringify({ payload: reply.payload, sig: reply.sig }));
        meta.set("license_last_checkin", String(answeredAt(status, now())));
        meta.set("license_problem", null);
        meta.set("license_last_error", null);
        if (summaries.length > 0) meta.set("license_synced_date", summaries[summaries.length - 1].date);
        await uploadMenu(); // never throws, and never affects the result of the licence check-in
        return { ok: true, accepted: summaries.length };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        meta.set("license_last_error", message);
        return { ok: false, message };
      }
    })().finally(() => {
      syncing = null;
    });
    return syncing;
  }

  /** Throws (with a message for the cashier) when new bills are not allowed. */
  function assertCanBill() {
    const s = getStatus();
    if (s.mode === "locked") throw new Error(`Billing is paused. ${s.message}`);
  }

  /**
   * Sync in the background because something happened that is a good moment to check in (the app started, someone logged in).
   * It never waits and never blocks anything: billing must work with no internet. To avoid hammering the server, a request is
   * ignored when a sync is already running or the last attempt was less than 5 minutes ago. Returns true if one was started.
   */
  function requestSync() {
    if (o.enforce === false || !meta.get("license_key") || syncing) return false;
    if (now() - num("license_last_attempt") < 5 * 60_000) return false;
    void syncNow();
    return true;
  }

  /** Background checks: one shortly after start, then every 15 minutes it asks whether the routine (hourly) sync is due. */
  function start() {
    const tick = () => {
      if (getStatus().activated && shouldSync(now(), num("license_last_attempt"), lastGoodCheckIn(), !!meta.get("license_last_error"))) void syncNow();
    };
    const first = setTimeout(() => void requestSync(), 10_000);
    const every = setInterval(tick, 15 * 60_000);
    first.unref?.();
    every.unref?.();
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }

  return { getStatus, activate, syncNow, requestSync, uploadMenu, fetchMenu, assertCanBill, start };
}

module.exports = { createLicenseService, normalizeKey };
