// The licence service with a fake server: real signatures, fake network.
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createLicenseService, normalizeKey } = require("./license.cjs");

const DAY = 86_400_000;
const KEY = "AAAA-BBBB-CCCC-DDDD";
const pair = crypto.generateKeyPairSync("ed25519");
const publicKey = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64");

/** What the real Edge Function returns: a signed status for this key and PC. */
function serverStatus(over: Record<string, unknown> = {}, machine = "PC-1", key = KEY) {
  const payload = JSON.stringify({
    v: 1, key, machine, plan: "Yearly Pro", plan_id: "yearly", restaurant_name: "Spice Garden", restaurant_code: "CL-HYD-0001",
    state: "active", expires_at: new Date(Date.now() + 300 * DAY).toISOString(), max_devices: 3, devices_used: 1, grace_days: 7,
    suspended_reason: null, server_time: new Date().toISOString(), ...over,
  });
  return { ok: true, payload, sig: crypto.sign(null, Buffer.from(payload), pair.privateKey).toString("base64") };
}

function makeMeta() {
  const store = new Map<string, string>();
  const meta = { get: (k: string) => store.get(k) ?? null, set: (k: string, v: string | null) => void (v === null ? store.delete(k) : store.set(k, String(v))) };
  return { store, meta };
}

function setup(opts: { now?: () => number; enforce?: boolean } = {}) {
  const { store, meta } = makeMeta();
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const net = { respond: (): unknown => serverStatus(), offline: false };
  const fetchFn = async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (net.offline) throw new TypeError("fetch failed");
    const data = net.respond();
    return { json: async () => data } as unknown as Response;
  };
  const sent: string[] = [];
  const svc = createLicenseService({
    meta, fetchFn, config: { publicKey, apiUrl: "https://x.supabase.co/" }, machineId: () => "PC-1", deviceName: () => "Counter", appVersion: "0.1.0",
    now: opts.now, enforce: opts.enforce,
    summariesSince: (d: string) => {
      sent.push(d);
      return [{ date: "2026-10-20", salesPaise: 1000 }, { date: "2026-10-21", salesPaise: 2000 }];
    },
  });
  return { svc, store, meta, calls, net, sent };
}

describe("normalizeKey", () => {
  it("accepts any casing and separators, and rejects the wrong length", () => {
    expect(normalizeKey("aaaa bbbb-cccc dddd")).toBe(KEY);
    expect(normalizeKey("AAAABBBBCCCCDDDD")).toBe(KEY);
    expect(normalizeKey("AAAA-BBBB-CCCC")).toBeNull();
    expect(normalizeKey("")).toBeNull();
    expect(normalizeKey(undefined)).toBeNull();
  });
});

describe("activation", () => {
  it("starts unactivated and locked", () => {
    const { svc } = setup();
    expect(svc.getStatus()).toMatchObject({ mode: "locked", reason: "unactivated", needsActivation: true, activated: false });
    expect(() => svc.assertCanBill()).toThrow(/Activate/);
  });

  it("activates with the key, calls the activate function, and then allows billing", async () => {
    const { svc, calls } = setup();
    const s = await svc.activate("aaaa-bbbb-cccc-dddd");
    expect(s).toMatchObject({ mode: "ok", activated: true, restaurantName: "Spice Garden", key: KEY, needsActivation: false });
    expect(calls[0].url).toBe("https://x.supabase.co/functions/v1/activate");
    expect(calls[0].body).toEqual({ key: KEY, machineId: "PC-1", deviceName: "Counter", appVersion: "0.1.0" });
    expect(() => svc.assertCanBill()).not.toThrow();
  });

  it("shows the server's refusal message", async () => {
    const { svc, net } = setup();
    net.respond = () => ({ ok: false, code: "device_limit", message: "All 1 terminals for this license are in use." });
    await expect(svc.activate(KEY)).rejects.toThrow(/terminals/);
    expect(svc.getStatus().activated).toBe(false);
  });

  it("explains a missing connection and a bad key without calling the server", async () => {
    const { svc, net, calls } = setup();
    await expect(svc.activate("12")).rejects.toThrow(/16-character/);
    expect(calls).toHaveLength(0);
    net.offline = true;
    await expect(svc.activate(KEY)).rejects.toThrow(/Could not reach SS Bills/);
  });

  it("does not show a platform error page's text to the user", async () => {
    const { svc, net } = setup();
    net.respond = () => ({ code: 404, message: "Requested function was not found" }); // not one of our answers
    await expect(svc.activate(KEY)).rejects.toThrow(/not available right now/);
    net.respond = () => ({ code: "NOT_FOUND", message: "Requested function was not found" }); // what Supabase really sends
    await expect(svc.activate(KEY)).rejects.toThrow(/not available right now/);
    net.respond = () => ({ message: "Internal stack trace ..." });
    await expect(svc.activate(KEY)).rejects.toThrow(/not available right now/);
  });

  it("refuses an answer that was not really signed by SS Bills", async () => {
    const { svc, net } = setup();
    net.respond = () => ({ ok: true, payload: JSON.stringify({ v: 1, key: KEY, machine: "PC-1", state: "active", grace_days: 7 }), sig: "AAAA" });
    await expect(svc.activate(KEY)).rejects.toThrow(/verified/);
    expect(svc.getStatus().activated).toBe(false);
  });

  it("does nothing when licence checks are switched off", async () => {
    const { svc } = setup({ enforce: false });
    expect(svc.getStatus()).toMatchObject({ mode: "ok", enforced: false });
    expect(() => svc.assertCanBill()).not.toThrow();
    expect(await svc.syncNow()).toMatchObject({ skipped: true });
  });
});

describe("sync", () => {
  async function activated(opts: { now?: () => number } = {}) {
    const t = setup(opts);
    await t.svc.activate(KEY);
    t.calls.length = 0;
    return t;
  }

  it("uploads everything on the first sync, then only the last 2 days onwards", async () => {
    const { svc, sent, calls } = await activated();
    expect(await svc.syncNow()).toMatchObject({ ok: true, accepted: 2 });
    expect(sent).toEqual(["2000-01-01"]);
    expect(calls[0].url).toBe("https://x.supabase.co/functions/v1/sync");
    expect(calls[0].body.summaries).toHaveLength(2);
    await svc.syncNow();
    expect(sent[1]).toBe("2026-10-19"); // 2026-10-21 (newest uploaded) minus 2 days
  });

  it("keeps working offline: a failed sync is remembered and does not throw", async () => {
    const { svc, net, store } = await activated();
    net.offline = true;
    const r = await svc.syncNow();
    expect(r.ok).toBe(false);
    expect(svc.getStatus().lastError).toMatch(/Could not reach/);
    expect(store.get("license_synced_date")).toBeUndefined(); // nothing marked as uploaded
    net.offline = false;
    expect((await svc.syncNow()).ok).toBe(true);
    expect(svc.getStatus().lastError).toBeNull();
  });

  it("locks billing when the server reports the licence suspended", async () => {
    const { svc, net } = await activated();
    net.respond = () => serverStatus({ state: "suspended", suspended_reason: "unpaid" });
    await svc.syncNow();
    expect(svc.getStatus()).toMatchObject({ mode: "locked", reason: "suspended" });
    expect(() => svc.assertCanBill()).toThrow(/Billing is paused.*suspended/);
  });

  it("billing returns when a later sync says active again", async () => {
    const { svc, net } = await activated();
    net.respond = () => serverStatus({ state: "suspended" });
    await svc.syncNow();
    net.respond = () => serverStatus();
    await svc.syncNow();
    expect(svc.getStatus().mode).toBe("ok");
  });

  it("locks when the server says this PC was reset, and clears when activated again", async () => {
    const { svc, net } = await activated();
    net.respond = () => ({ ok: false, code: "device_not_bound", message: "not linked" });
    await svc.syncNow();
    expect(svc.getStatus()).toMatchObject({ mode: "locked", reason: "device_not_bound", needsActivation: false });
    net.respond = () => serverStatus();
    await svc.activate(KEY);
    expect(svc.getStatus().mode).toBe("ok");
  });

  it("a replaced key locks billing with a clear message, and the new key unlocks it", async () => {
    const { svc, net, store } = await activated();
    net.respond = () => ({ ok: false, code: "invalid_key", message: "That license key was not found" });
    await svc.syncNow();
    expect(svc.getStatus()).toMatchObject({ mode: "locked", reason: "invalid_key", needsActivation: false });
    expect(svc.getStatus().message).toMatch(/replaced or removed.*new key/);
    expect(() => svc.assertCanBill()).toThrow(/Billing is paused/);
    const NEW = "FFFF-EEEE-DDDD-CCCC";
    net.respond = () => serverStatus({}, "PC-1", NEW);
    await svc.activate(NEW);
    expect(svc.getStatus()).toMatchObject({ mode: "ok", key: NEW });
    expect(store.get("license_problem")).toBeUndefined();
    expect(() => svc.assertCanBill()).not.toThrow();
  });

  it("a temporary server error does not lock anyone", async () => {
    const { svc, net } = await activated();
    net.respond = () => ({ ok: false, code: "rate_limited", message: "Too many attempts" });
    expect((await svc.syncNow()).ok).toBe(false);
    expect(svc.getStatus().mode).toBe("ok");
  });

  it("ignores a forged answer: status and check-in time stay as they were", async () => {
    const { svc, net, store } = await activated();
    const before = store.get("license_last_checkin");
    net.respond = () => ({ ok: true, payload: "{}", sig: "AAAA" });
    expect((await svc.syncNow()).ok).toBe(false);
    expect(store.get("license_last_checkin")).toBe(before);
  });

  it("does not run two syncs at once", async () => {
    const { svc, calls } = await activated();
    await Promise.all([svc.syncNow(), svc.syncNow(), svc.syncNow()]);
    expect(calls).toHaveLength(1);
  });

  it("goes offline-locked after the grace period when sync keeps failing", async () => {
    let now = Date.now();
    const { svc, net } = await activated({ now: () => now });
    net.offline = true;
    now += 3 * DAY;
    await svc.syncNow();
    expect(svc.getStatus()).toMatchObject({ mode: "warning", reason: "offline" });
    now += 5 * DAY + 60_000; // a minute past 8 days (the check-in time is the server's clock, a few ms after `now` started)
    expect(svc.getStatus()).toMatchObject({ mode: "locked", reason: "offline" });
  });
});

describe("tampering with the saved licence", () => {
  it("editing the stored status invalidates it", async () => {
    const { svc, store } = setup();
    await svc.activate(KEY);
    const saved = JSON.parse(store.get("license_status")!);
    saved.payload = saved.payload.replace('"state":"active"', '"state":"active","x":1');
    store.set("license_status", JSON.stringify(saved));
    expect(svc.getStatus()).toMatchObject({ mode: "locked", reason: "damaged", needsActivation: true });
  });

  it("a licence copied to another PC does not work there", async () => {
    const a = setup();
    await a.svc.activate(KEY);
    const { store, meta } = makeMeta();
    for (const [k, v] of a.store) store.set(k, v);
    const other = createLicenseService({ meta, fetchFn: async () => ({}) as Response, config: { publicKey, apiUrl: "https://x" }, machineId: () => "PC-OTHER", summariesSince: () => [] });
    expect(other.getStatus()).toMatchObject({ mode: "locked", reason: "damaged" });
  });
});
