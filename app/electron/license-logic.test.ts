import crypto from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { evaluate, shouldSync, verifySigned, DAY_MS } = require("./license-logic.cjs");

const T0 = Date.parse("2026-10-21T10:00:00Z");
const status = (over: Record<string, unknown> = {}) => ({
  v: 1, key: "AAAA-BBBB-CCCC-DDDD", machine: "PC-1", plan: "Yearly Pro", plan_id: "yearly", restaurant_name: "Spice Garden",
  restaurant_code: "CL-HYD-0001", state: "active", expires_at: new Date(T0 + 200 * DAY_MS).toISOString(), max_devices: 3,
  devices_used: 1, grace_days: 7, suspended_reason: null, server_time: new Date(T0).toISOString(), ...over,
});
const at = (stored: Record<string, unknown>, daysLater = 0) => evaluate({ lastCheckInMs: T0, lastSeenMs: 0, problem: null, ...stored }, T0 + daysLater * DAY_MS);

describe("evaluate", () => {
  it("is locked until activated", () => {
    expect(evaluate({ status: null }, T0)).toMatchObject({ mode: "locked", reason: "unactivated", activated: false });
  });

  it("is fine right after a check-in", () => {
    expect(at({ status: status() })).toMatchObject({ mode: "ok", offlineDays: 0, daysLeft: 200, plan: "Yearly Pro" });
  });

  it("warns, then locks, as days pass with no check-in (grace 7 days)", () => {
    expect(at({ status: status() }, 0.9).mode).toBe("ok");
    expect(at({ status: status() }, 3)).toMatchObject({ mode: "warning", reason: "offline", offlineDays: 3, graceLeft: 4 });
    expect(at({ status: status() }, 7).mode).toBe("warning");
    expect(at({ status: status() }, 8)).toMatchObject({ mode: "locked", reason: "offline" });
  });

  it("locks when suspended, whatever the dates say", () => {
    expect(at({ status: status({ state: "suspended", suspended_reason: "unpaid" }) })).toMatchObject({ mode: "locked", reason: "suspended" });
  });

  it("an expired licence gets the grace period, then locks (worked out on this PC, offline)", () => {
    const s = status({ expires_at: new Date(T0 - 2 * DAY_MS).toISOString(), state: "grace" });
    expect(at({ status: s })).toMatchObject({ mode: "warning", reason: "grace" });
    expect(at({ status: s }).message).toMatch(/within 5 days/);
    expect(at({ status: s, lastCheckInMs: T0 + 4.9 * DAY_MS }, 4.95)).toMatchObject({ mode: "warning", reason: "grace" });
    expect(at({ status: s, lastCheckInMs: T0 + 5.1 * DAY_MS }, 5.2)).toMatchObject({ mode: "locked", reason: "expired" });
  });

  it("a licence that runs out while the PC is offline still locks", () => {
    const s = status({ expires_at: new Date(T0 + 1 * DAY_MS).toISOString() });
    expect(at({ status: s, lastCheckInMs: T0 + 5 * DAY_MS }, 5)).toMatchObject({ mode: "warning" });
    expect(at({ status: s, lastCheckInMs: T0 + 9 * DAY_MS }, 9)).toMatchObject({ mode: "locked", reason: "expired" });
  });

  it("lifetime licences never expire", () => {
    expect(at({ status: status({ expires_at: null }) })).toMatchObject({ mode: "ok", daysLeft: null });
  });

  it("warns when the server says the licence is about to expire", () => {
    const r = at({ status: status({ state: "expiring", expires_at: new Date(T0 + 10 * DAY_MS).toISOString() }) });
    expect(r).toMatchObject({ mode: "warning", reason: "expiring", daysLeft: 10 });
  });

  it("a server-side problem (PC reset, key removed) locks billing", () => {
    const r = at({ status: status(), problem: { code: "device_not_bound", message: "Activate again" } });
    expect(r).toMatchObject({ mode: "locked", reason: "device_not_bound", message: "Activate again" });
  });

  it("setting the PC clock back does not buy time", () => {
    const s = status();
    // last seen 10 days after the check-in, but the clock now says day 1
    expect(evaluate({ status: s, lastCheckInMs: T0, lastSeenMs: T0 + 10 * DAY_MS, problem: null }, T0 + 1 * DAY_MS)).toMatchObject({ mode: "locked", reason: "offline" });
  });

  it("treats a missing check-in time as 'never reached the server'", () => {
    expect(evaluate({ status: status(), lastCheckInMs: 0, lastSeenMs: 0, problem: null }, T0)).toMatchObject({ mode: "locked", reason: "offline" });
  });
});

describe("shouldSync", () => {
  it("syncs when never done, every 6 hours after a good one, every 15 minutes after a failure", () => {
    expect(shouldSync(T0, 0, 0)).toBe(true);
    expect(shouldSync(T0, T0 - 3600_000, T0 - 3600_000)).toBe(false); // synced an hour ago
    expect(shouldSync(T0, T0 - 6 * 3600_000, T0 - 6 * 3600_000)).toBe(true);
    expect(shouldSync(T0, T0 - 10 * 60_000, T0 - 7 * 3600_000)).toBe(false); // failed 10 minutes ago
    expect(shouldSync(T0, T0 - 16 * 60_000, T0 - 7 * 3600_000)).toBe(true);
  });
});

describe("verifySigned", () => {
  const pair = crypto.generateKeyPairSync("ed25519");
  const pub = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const sign = (payload: string, key = pair.privateKey) => crypto.sign(null, Buffer.from(payload), key).toString("base64");
  const reply = (s = status()) => {
    const payload = JSON.stringify(s);
    return { payload, sig: sign(payload) };
  };
  const expected = { key: "AAAA-BBBB-CCCC-DDDD", machine: "PC-1" };

  it("accepts a genuine answer", () => {
    expect(verifySigned(reply(), pub, expected).restaurant_name).toBe("Spice Garden");
  });

  it("rejects a changed payload, a wrong signer, and unsigned answers", () => {
    const r = reply();
    expect(() => verifySigned({ ...r, payload: r.payload.replace("active", "grace") }, pub, expected)).toThrow(/verified/);
    const other = crypto.generateKeyPairSync("ed25519");
    const payload = JSON.stringify(status());
    expect(() => verifySigned({ payload, sig: sign(payload, other.privateKey) }, pub, expected)).toThrow(/verified/);
    expect(() => verifySigned({ payload }, pub, expected)).toThrow(/not signed/);
    expect(() => verifySigned(null, pub, expected)).toThrow(/not signed/);
  });

  it("rejects an answer meant for another key or PC (replay)", () => {
    expect(() => verifySigned(reply(), pub, { ...expected, machine: "PC-2" })).toThrow(/another/);
    expect(() => verifySigned(reply(), pub, { ...expected, key: "ZZZZ-BBBB-CCCC-DDDD" })).toThrow(/another/);
  });

  it("explains a bad public key instead of crashing", () => {
    expect(() => verifySigned(reply(), "not-a-key", expected)).toThrow(/server key/);
  });
});
