// Licence rules for the restaurant app (docs/TRD.md §7.4). Pure functions only (no network, no database),
// so every rule can be tested by moving the clock.
//
// What the app knows: the last answer SS Bills signed (plan, state, expiry, grace days), and when the app last
// reached SS Bills. From that it decides, offline, whether new bills are allowed:
//   - never activated, or SS Bills says this PC/key is no longer valid  -> locked
//   - suspended                                                        -> locked (at the next successful check-in)
//   - expired and past the grace period                                -> locked
//   - no successful check-in for more than `grace_days`                -> locked
//   - otherwise                                                        -> ok, with a warning when something needs attention
// History, reports and backup are never locked.
const crypto = require("node:crypto");

const DAY_MS = 86_400_000;

/**
 * Checks a signed answer from the server and returns the status inside it.
 * Throws if the signature is wrong or the answer was meant for another key or PC (a replayed answer).
 */
function verifySigned(reply, publicKeyB64, expected) {
  if (!reply || typeof reply.payload !== "string" || typeof reply.sig !== "string") throw new Error("The server's answer was not signed");
  let publicKey;
  try {
    publicKey = crypto.createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
  } catch {
    throw new Error("This build of SS Bills has no valid licence server key");
  }
  const ok = crypto.verify(null, Buffer.from(reply.payload), publicKey, Buffer.from(reply.sig, "base64"));
  if (!ok) throw new Error("The server's answer could not be verified");
  const status = JSON.parse(reply.payload);
  if (status.v !== 1) throw new Error("Unsupported licence answer");
  if (status.key !== expected.key || status.machine !== expected.machine) throw new Error("The server's answer was for another licence or PC");
  return status;
}

/**
 * Decides what the app may do right now.
 * @param stored { status, lastCheckInMs, lastSeenMs, problem } as kept in app_meta (status is the verified payload)
 * @param nowMs  the current time
 * @returns { mode: 'ok'|'warning'|'locked', reason, message, ...details for the Licence screen }
 */
function evaluate(stored, nowMs) {
  const { status, problem } = stored;
  // The time SS Bills last answered comes from INSIDE the signed answer (SS Bills' own clock), so editing the local database
  // cannot make a check-in look more recent. A separately stored time is only a fallback for an answer without one.
  const signedMs = status ? Date.parse(status.server_time) : NaN;
  const lastCheckInMs = Number.isFinite(signedMs) ? signedMs : stored.lastCheckInMs;
  // A PC clock set back to extend a licence is ignored: time never runs backwards past the latest time seen, and never
  // before the last signed answer.
  const now = Math.max(nowMs, stored.lastSeenMs ?? 0, Number.isFinite(signedMs) ? signedMs : 0);

  if (!status) return { mode: "locked", reason: "unactivated", message: "Activate SS Bills with your licence key to start billing.", activated: false };
  const base = {
    activated: true,
    plan: status.plan,
    restaurantName: status.restaurant_name,
    restaurantCode: status.restaurant_code,
    expiresAt: status.expires_at,
    graceDays: status.grace_days,
    maxDevices: status.max_devices,
    lastCheckInAt: lastCheckInMs ? new Date(lastCheckInMs).toISOString() : null,
  };

  if (problem) {
    return { ...base, mode: "locked", reason: problem.code, message: problem.message };
  }

  const graceMs = status.grace_days * DAY_MS;
  const expiresMs = status.expires_at ? Date.parse(status.expires_at) : null;
  const daysLeft = expiresMs === null ? null : Math.ceil((expiresMs - now) / DAY_MS);
  const offlineDays = lastCheckInMs ? Math.max(0, Math.floor((now - lastCheckInMs) / DAY_MS)) : status.grace_days + 1;
  const graceLeft = status.grace_days - offlineDays;
  const details = { ...base, daysLeft, offlineDays, graceLeft };

  if (status.state === "suspended") {
    return { ...details, mode: "locked", reason: "suspended", message: "This licence is suspended. New bills are paused. Contact SS Bills to restore it." };
  }
  if (expiresMs !== null && now > expiresMs + graceMs) {
    return { ...details, mode: "locked", reason: "expired", message: "This licence has expired. New bills are paused. Renew with SS Bills to continue." };
  }
  if (offlineDays > status.grace_days) {
    return {
      ...details, mode: "locked", reason: "offline",
      message: `SS Bills has not been able to check in for ${offlineDays} days. Connect to the internet to continue billing.`,
    };
  }
  if (expiresMs !== null && now > expiresMs) {
    const left = Math.max(0, Math.ceil((expiresMs + graceMs - now) / DAY_MS));
    return { ...details, mode: "warning", reason: "grace", message: `Your licence has expired. Renew within ${left} day${left === 1 ? "" : "s"} or billing will pause.` };
  }
  if (offlineDays >= 1) {
    return {
      ...details, mode: "warning", reason: "offline",
      message: `Not synced for ${offlineDays} day${offlineDays === 1 ? "" : "s"}. Connect to the internet within ${graceLeft} day${graceLeft === 1 ? "" : "s"}.`,
    };
  }
  if (status.state === "expiring") {
    return { ...details, mode: "warning", reason: "expiring", message: `Your licence expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Contact SS Bills to renew.` };
  }
  return { ...details, mode: "ok", reason: null, message: "" };
}

/**
 * Is it time for the routine background sync? Hourly after a good one, 15 minutes after a failed one.
 * (Separately, the app also syncs at start-up and at every login: see requestSync in license.cjs.)
 */
function shouldSync(nowMs, lastAttemptMs, lastOkMs, lastFailed = false) {
  if (!lastAttemptMs && !lastOkMs) return true;
  if (lastFailed) return !lastAttemptMs || nowMs - lastAttemptMs >= 15 * 60_000;
  return !lastOkMs || nowMs - lastOkMs >= 3600_000;
}

module.exports = { verifySigned, evaluate, shouldSync, DAY_MS };
