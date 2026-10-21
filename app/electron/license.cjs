// Licence activation, status and daily summary sync (docs/TRD.md §7.4). Runs in the Electron main process.
// The UI can only ask for the status, activate with a key, or ask for a sync now. It never sees the network.
// Billing must keep working offline: every network failure here is caught, remembered, and retried later.
const { evaluate, shouldSync, verifySigned } = require("./license-logic.cjs");

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
    return { key, status, damaged, lastCheckInMs: num("license_last_checkin"), lastSeenMs: num("license_last_seen"), problem: json("license_problem") };
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
    return getStatus();
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

  /** Background check: first one shortly after start, then every 15 minutes it asks whether a sync is due. */
  function start() {
    const tick = () => {
      if (getStatus().activated && shouldSync(now(), num("license_last_attempt"), num("license_last_checkin"))) void syncNow();
    };
    const first = setTimeout(tick, 10_000);
    const every = setInterval(tick, 15 * 60_000);
    first.unref?.();
    every.unref?.();
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }

  return { getStatus, activate, syncNow, assertCanBill, start };
}

module.exports = { createLicenseService, normalizeKey };
