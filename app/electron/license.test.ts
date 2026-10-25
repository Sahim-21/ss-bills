// The licence service with a fake server: real signatures, fake network.
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

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

function setup(opts: { now?: () => number; enforce?: boolean; snapshot?: () => unknown } = {}) {
  const { store, meta } = makeMeta();
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const net: { respond: (url?: string, body?: Record<string, unknown>) => unknown; offline: boolean } = { respond: () => serverStatus(), offline: false };
  const fetchFn = async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (net.offline) throw new TypeError("fetch failed");
    const data = net.respond(url, JSON.parse(init.body));
    return { json: async () => data } as unknown as Response;
  };
  const sent: string[] = [];
  const svc = createLicenseService({
    meta, fetchFn, config: { publicKey, apiUrl: "https://x.supabase.co/" }, machineId: () => "PC-1", deviceName: () => "Counter", appVersion: "0.1.0",
    now: opts.now, enforce: opts.enforce, buildSnapshot: opts.snapshot,
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

describe("syncing at start-up and at login", () => {
  async function activated(opts: { now?: () => number } = {}) {
    const t = setup(opts);
    await t.svc.activate(KEY);
    t.calls.length = 0;
    return t;
  }
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it("requestSync starts a background sync and does not wait for it", async () => {
    let now = Date.now();
    const { svc, calls } = await activated({ now: () => now });
    now += 6 * 60_000; // activation itself counted as an attempt, so wait out the 5 minute throttle
    expect(svc.requestSync()).toBe(true);
    expect(calls).toHaveLength(1); // the request went out immediately, without being awaited
    await settle();
  });

  it("is throttled right after activation (activation already checked in)", async () => {
    const { svc, calls } = await activated();
    expect(svc.requestSync()).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("ignores requests made within 5 minutes of the last attempt", async () => {
    let now = Date.now();
    const { svc, calls } = await activated({ now: () => now });
    now += 6 * 60_000;
    expect(svc.requestSync()).toBe(true);
    await settle();
    now += 4 * 60_000;
    expect(svc.requestSync()).toBe(false); // 4 minutes later: too soon
    now += 61_000;
    expect(svc.requestSync()).toBe(true); // 5 minutes and a second later: allowed
    await settle();
    expect(calls).toHaveLength(2);
  });

  it("does not start a second sync while one is still running", async () => {
    const { svc, calls } = await activated();
    const first = svc.syncNow();
    expect(svc.requestSync()).toBe(false);
    await first;
    expect(calls).toHaveLength(1);
  });

  it("does nothing before activation, or when licence checks are switched off", async () => {
    const fresh = setup();
    expect(fresh.svc.requestSync()).toBe(false);
    expect(fresh.calls).toHaveLength(0);
    const off = setup({ enforce: false });
    expect(off.svc.requestSync()).toBe(false);
    expect(off.calls).toHaveLength(0);
  });

  it("a failed login-time sync never throws or blocks, and is simply remembered", async () => {
    let now = Date.now();
    const { svc, net } = await activated({ now: () => now });
    now += 6 * 60_000;
    net.offline = true;
    expect(() => svc.requestSync()).not.toThrow();
    await settle();
    expect(svc.getStatus()).toMatchObject({ mode: "ok" }); // still fine: the 7-day allowance is what limits offline use
    expect(String(svc.getStatus().lastError)).toMatch(/Could not reach/);
  });

  it("a suspension is picked up by the next login-time sync and locks billing", async () => {
    let now = Date.now();
    const { svc, net } = await activated({ now: () => now });
    now += 10 * 60_000;
    net.respond = () => serverStatus({ state: "suspended", suspended_reason: "unpaid" });
    expect(svc.requestSync()).toBe(true);
    await settle();
    expect(svc.getStatus()).toMatchObject({ mode: "locked", reason: "suspended" });
  });
});

describe("the start-up and routine background checks", () => {
  afterEach(() => vi.useRealTimers());

  it("syncs 10 seconds after start, then hourly (checked every 15 minutes), not every 15 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T10:00:00Z"));
    const { svc, calls } = setup({ now: () => Date.now() });
    // activate with the fake clock in place
    await svc.activate(KEY);
    calls.length = 0;
    // pretend the previous sync was long ago so the start-up sync is not throttled
    const stop = svc.start();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000); // 10 s: start-up sync
    // activation just happened (attempt time = now), so the 5 minute throttle suppresses a duplicate right away
    expect(calls.length).toBeLessThanOrEqual(1);
    const afterStart = calls.length;
    await vi.advanceTimersByTimeAsync(15 * 60_000); // first routine tick: only 15 minutes since the last good sync
    expect(calls).toHaveLength(afterStart);
    await vi.advanceTimersByTimeAsync(50 * 60_000); // now more than an hour since the last good sync
    expect(calls.length).toBeGreaterThan(afterStart);
    stop();
  });
});

describe("tampering with the saved licence", () => {
  it("editing the stored 'last check-in' time does not extend the offline allowance", async () => {
    let now = Date.now();
    const { svc, store } = setup({ now: () => now });
    await svc.activate(KEY);
    now += 9 * DAY; // nine days with no internet (more than the 7 allowed)
    expect(svc.getStatus()).toMatchObject({ mode: "locked", reason: "offline" });
    // the user edits the database so the last check-in looks like it was just now, and wipes the 'latest time seen'
    store.set("license_last_checkin", String(now));
    store.set("license_last_seen", "0");
    expect(svc.getStatus()).toMatchObject({ mode: "locked", reason: "offline" }); // still locked
  });

  it("moving the PC clock back does not buy time either", async () => {
    let now = Date.now();
    const { svc, store } = setup({ now: () => now });
    await svc.activate(KEY);
    now += 9 * DAY;
    store.set("license_last_seen", "0");
    now -= 8 * DAY; // clock set back to look like day 1
    expect(svc.getStatus().offlineDays).toBeLessThanOrEqual(1); // honest: a frozen clock can look recent...
    now += 8 * DAY; // ...but the moment real time shows again, the lock is back
    expect(svc.getStatus()).toMatchObject({ mode: "locked", reason: "offline" });
  });

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

// ------------------------------------------------------------------ the cloud copy of the menu (D-043)

const menuCopy = (over: Record<string, unknown> = {}) => ({
  version: 1,
  createdAt: "2026-10-25T10:00:00.000Z",
  profile: { name: "Spice Garden", tagline: "", address: "1 Main Rd", phone: "1", gstin: "", fssai: "", hsnSac: "996331", receiptHeader: "x", receiptFooter: "y", showLogo: true, paperWidthMm: 80 },
  tax: { gstRateBp: 500, pricesIncludeTax: false, serviceChargeEnabled: false, serviceChargeBp: 500 },
  categories: [{ id: "c1", name: "Mains", sortOrder: 1 }],
  menu: [{ id: "m1", categoryId: "c1", name: "Naan", shortCode: "NAN", pricePaise: 5000, veg: true, available: true }],
  tables: [{ id: "t1", label: "T1", seats: 4 }],
  ...over,
});

/** What the real menu function returns for a restore: the copy, signed with the real key, naming this key and PC. */
function signedMenu(snapshot: unknown, over: Record<string, unknown> = {}, signer = pair.privateKey) {
  const payload = JSON.stringify({ v: 1, kind: "menu", key: KEY, machine: "PC-1", saved_at: "2026-10-22T10:00:00+00:00", bytes: 400, snapshot, ...over });
  return { ok: true, found: true, payload, sig: crypto.sign(null, Buffer.from(payload), signer).toString("base64") };
}

describe("saving the menu copy to the cloud", () => {
  const menuCalls = (calls: { url: string; body: Record<string, unknown> }[]) => calls.filter((c) => c.url.endsWith("/functions/v1/menu"));
  async function ready(over: { snapshot?: () => unknown; now?: () => number } = {}) {
    const t = setup({ snapshot: () => menuCopy(), ...over });
    await t.svc.activate(KEY);
    t.calls.length = 0;
    // like the real server: the menu function answers saves with { ok, stored }, everything else with a signed status
    t.net.respond = (url) => (url?.endsWith("/menu") ? { ok: true, stored: true } : serverStatus());
    return t;
  }

  it("sends the key, this PC and the copy to the menu function", async () => {
    const { svc, calls } = await ready();
    expect(await svc.uploadMenu()).toMatchObject({ ok: true, stored: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://x.supabase.co/functions/v1/menu");
    expect(calls[0].body).toMatchObject({ action: "put", key: KEY, machineId: "PC-1" });
    expect(calls[0].body.snapshot).toEqual(menuCopy());
    expect(svc.getStatus()).toMatchObject({ menuError: null });
    expect(svc.getStatus().menuSavedAt).toBeTruthy();
  });

  it("sends nothing again while the menu has not changed, and sends again after a change", async () => {
    let current = menuCopy();
    const { svc, calls } = await ready({ snapshot: () => current });
    await svc.uploadMenu();
    expect(await svc.uploadMenu()).toEqual({ ok: true, unchanged: true });
    current = menuCopy({ createdAt: "2027-01-01T00:00:00.000Z" }); // only the time differs: still the same menu
    expect(await svc.uploadMenu()).toEqual({ ok: true, unchanged: true });
    expect(menuCalls(calls)).toHaveLength(1);
    current = menuCopy({ tables: [{ id: "t1", label: "T1", seats: 6 }] });
    expect(await svc.uploadMenu()).toMatchObject({ ok: true, stored: true });
    expect(menuCalls(calls)).toHaveLength(2);
  });

  it("does nothing before activation, with licence checks off, for an unset-up PC, or with no way to read the menu", async () => {
    const fresh = setup({ snapshot: () => menuCopy() });
    expect(await fresh.svc.uploadMenu()).toMatchObject({ ok: false });
    const off = setup({ enforce: false, snapshot: () => menuCopy() });
    expect(await off.svc.uploadMenu()).toMatchObject({ skipped: true });
    const empty = await ready({ snapshot: () => null });
    expect(await empty.svc.uploadMenu()).toMatchObject({ skipped: true });
    const noReader = setup();
    await noReader.svc.activate(KEY);
    noReader.calls.length = 0;
    expect(await noReader.svc.uploadMenu()).toMatchObject({ skipped: true });
    for (const t of [fresh, off, empty, noReader]) expect(menuCalls(t.calls)).toHaveLength(0);
  });

  it("never sends a copy that fails its own check (for example a price that is not whole paise)", async () => {
    const { svc, calls } = await ready({ snapshot: () => menuCopy({ menu: [{ id: "m1", categoryId: "c1", name: "Naan", shortCode: "N", pricePaise: 12.5, veg: true, available: true }] }) });
    const r = await svc.uploadMenu();
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toMatch(/could not be saved.*Item 1/);
    expect(calls).toHaveLength(0);
    expect(svc.getStatus().menuError).toMatch(/could not be saved/);
  });

  it("a failure never throws, is remembered, and is cleared by the next success", async () => {
    const { svc, net } = await ready();
    net.offline = true;
    expect(await svc.uploadMenu()).toMatchObject({ ok: false, message: expect.stringMatching(/Could not reach/) });
    expect(svc.getStatus()).toMatchObject({ menuSavedAt: null, menuError: expect.stringMatching(/Could not reach/) });
    net.offline = false;
    expect(await svc.uploadMenu()).toMatchObject({ ok: true, stored: true });
    expect(svc.getStatus()).toMatchObject({ menuError: null });
    expect(svc.getStatus().menuSavedAt).toBeTruthy();
  });

  it("shows the server's reason when it refuses, but never a platform error page's text", async () => {
    const { svc, net } = await ready();
    net.respond = () => ({ ok: false, code: "suspended", message: "This license is suspended. Please contact SS Bills" });
    expect(await svc.uploadMenu()).toMatchObject({ ok: false, message: expect.stringMatching(/suspended/) });
    net.respond = () => ({ code: "NOT_FOUND", message: "Requested function was not found" });
    expect(await svc.uploadMenu()).toMatchObject({ ok: false, message: expect.stringMatching(/not available right now/) });
  });

  it("is sent after a good check-in, and a menu failure does not turn a good check-in into a failed one", async () => {
    const { svc, calls, net } = await ready();
    expect((await svc.syncNow()).ok).toBe(true);
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["sync", "menu"]);
    // change the menu, make only the menu endpoint fail
    const t2 = await ready({ snapshot: () => menuCopy({ createdAt: "x", tables: [] }) });
    t2.net.respond = (url) => (url?.endsWith("/menu") ? { ok: false, code: "bad_request", message: "The menu copy is not in the expected format" } : serverStatus());
    const r = await t2.svc.syncNow();
    expect(r).toMatchObject({ ok: true }); // the licence check-in itself still succeeded
    expect(t2.svc.getStatus().lastError).toBeNull();
    expect(t2.svc.getStatus().menuError).toMatch(/expected format/);
    void net;
  });

  it("uploads again after a fresh activation (a replaced key or a new PC)", async () => {
    const { svc, calls } = await ready();
    await svc.uploadMenu();
    await svc.activate(KEY); // activating again forgets what was uploaded
    calls.length = 0;
    expect(await svc.uploadMenu()).toMatchObject({ ok: true, stored: true });
    expect(menuCalls(calls)).toHaveLength(1);
  });
});

describe("restoring the menu copy on a new PC", () => {
  async function ready(over: { enforce?: boolean } = {}) {
    const t = setup(over);
    await t.svc.activate(KEY);
    t.calls.length = 0;
    return t;
  }

  it("says plainly when nothing was ever saved", async () => {
    const { svc, net, calls } = await ready();
    net.respond = () => ({ ok: true, found: false });
    expect(await svc.fetchMenu()).toEqual({ found: false });
    expect(calls[0].body).toEqual({ action: "get", key: KEY, machineId: "PC-1" });
  });

  it("returns a signed, checked copy with a summary", async () => {
    const { svc, net } = await ready();
    net.respond = () => signedMenu(menuCopy());
    const r = await svc.fetchMenu();
    expect(r.found).toBe(true);
    expect(r.snapshot.menu).toHaveLength(1);
    expect(r.summary).toEqual({ restaurantName: "Spice Garden", items: 1, categories: 1, tables: 1, savedAt: "2026-10-22T10:00:00+00:00" });
  });

  it("refuses a copy whose contents were changed after signing", async () => {
    const { svc, net } = await ready();
    net.respond = () => {
      const r = signedMenu(menuCopy());
      return { ...r, payload: r.payload.replace("Naan", "Evil") };
    };
    await expect(svc.fetchMenu()).rejects.toThrow(/could not be verified/);
  });

  it("refuses a copy signed by anyone but SS Bills, an unsigned one, and one meant for another key or PC", async () => {
    const { svc, net } = await ready();
    const other = crypto.generateKeyPairSync("ed25519");
    net.respond = () => signedMenu(menuCopy(), {}, other.privateKey);
    await expect(svc.fetchMenu()).rejects.toThrow(/could not be verified/);
    net.respond = () => ({ ok: true, found: true, payload: "{}" });
    await expect(svc.fetchMenu()).rejects.toThrow(/not signed/);
    net.respond = () => signedMenu(menuCopy(), { machine: "PC-OTHER" });
    await expect(svc.fetchMenu()).rejects.toThrow(/another licence or PC/);
    net.respond = () => signedMenu(menuCopy(), { key: "ZZZZ-BBBB-CCCC-DDDD" });
    await expect(svc.fetchMenu()).rejects.toThrow(/another licence or PC/);
  });

  it("refuses a licence-status answer passed off as a menu", async () => {
    const { svc, net } = await ready();
    net.respond = () => { const r = signedMenu(menuCopy(), { kind: "status" }); return r; };
    await expect(svc.fetchMenu()).rejects.toThrow(/not a menu copy/);
  });

  it("refuses a correctly signed copy whose contents are not valid (a damaged or hostile copy)", async () => {
    const { svc, net } = await ready();
    net.respond = () => signedMenu(menuCopy({ menu: [{ id: "m1", categoryId: "nowhere", name: "Naan", shortCode: "N", pricePaise: 1, veg: true, available: true }] }));
    await expect(svc.fetchMenu()).rejects.toThrow(/category that is not in the copy/);
    net.respond = () => signedMenu(menuCopy({ staff: [{ name: "x", pin: "1234" }] }));
    await expect(svc.fetchMenu()).rejects.toThrow(/unexpected field "staff"/);
    net.respond = () => signedMenu(menuCopy({ version: 9 }));
    await expect(svc.fetchMenu()).rejects.toThrow(/newer version.*Update/);
  });

  it("passes on the server's refusal in plain words, and handles no connection", async () => {
    const { svc, net } = await ready();
    net.respond = () => ({ ok: false, code: "device_not_bound", message: "This PC is not linked to the license. Activate it again" });
    await expect(svc.fetchMenu()).rejects.toThrow(/not linked/);
    net.offline = true;
    await expect(svc.fetchMenu()).rejects.toThrow(/Could not reach SS Bills/);
  });

  it("needs an activated PC, and is off when licence checks are off", async () => {
    await expect(setup().svc.fetchMenu()).rejects.toThrow(/Activate SS Bills/);
    const off = setup({ enforce: false });
    await expect(off.svc.fetchMenu()).rejects.toThrow(/switched off/);
  });
});
