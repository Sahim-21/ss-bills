import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addUser, as, freshDb, rpc, type Who } from "./harness";

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: PGlite;
let boss: Who; // super admin
let help: Who; // support
let nobody: Who; // logged in, not a vendor admin
let bossId: string;
let helpId: string;
const anon: Who = { role: "anon" };
const service: Who = { role: "service_role" };

const KEY = /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

const client = (over: Record<string, unknown> = {}) => ({
  name: "Spice Garden", owner_name: "Manish Kapoor", phone: "+91 98105 77123", email: "owner@spicegarden.in",
  city: "Hyderabad", address: "Jubilee Hills", gstin: "36AABCS1429B1Z4", plan_id: "yearly", ...over,
});

const create = (over: Record<string, unknown> = {}, who: Who = boss) =>
  rpc<any>(db, who, "public.vendor_create_client($1::jsonb)", [JSON.stringify(client(over))]);

const q = async (sql: string, params: unknown[] = []) => (await db.query<any>(sql, params)).rows;

const activate = (key: string, machine = "PC-1", name = "Counter 1") =>
  rpc<any>(db, service, "public.license_activate($1, $2, $3, $4)", [key, machine, name, "0.1.0"]);

const checkin = (key: string, machine: string, summaries: unknown[] = []) =>
  rpc<any>(db, service, "public.license_checkin($1, $2, $3, $4::jsonb)", [key, machine, "0.1.0", JSON.stringify(summaries)]);

const day = (offset: number) => {
  const d = new Date(Date.now() + 5.5 * 3600_000);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const summary = (offset: number, sales: number, extra: Record<string, unknown> = {}) => ({
  date: day(offset), salesPaise: sales, bills: 10, cancelled: 1, cashPaise: Math.floor(sales / 2), upiPaise: sales - Math.floor(sales / 2), cardPaise: 0,
  taxPaise: Math.round(sales / 21), topItemName: "Butter Naan", topItemQty: 12, ...extra,
});

beforeAll(async () => {
  db = await freshDb();
  bossId = await addUser(db, "boss@ssbills.in", "super_admin", "Rajesh Verma");
  helpId = await addUser(db, "help@ssbills.in", "support", "Pooja Sharma");
  const strangerId = await addUser(db, "stranger@example.com");
  boss = { role: "authenticated", uid: bossId };
  help = { role: "authenticated", uid: helpId };
  nobody = { role: "authenticated", uid: strangerId };
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  // Start every test from an empty restaurant list (the activity log is append-only, so reset around it).
  await db.exec("alter table public.license_events disable trigger license_events_append_only");
  await db.exec("truncate public.license_events, public.payments, public.daily_summary, public.license_devices, public.licenses, public.restaurants restart identity cascade");
  await db.exec("alter table public.license_events enable trigger license_events_append_only");
  await db.exec("alter sequence public.restaurant_seq restart with 1");
});

describe("security: who can call what", () => {
  it("anonymous callers can do nothing", async () => {
    await expect(rpc(db, anon, "public.vendor_overview(30)")).rejects.toThrow(/permission denied/i);
    await expect(rpc(db, anon, "public.vendor_me()")).rejects.toThrow(/permission denied/i);
    await expect(as(db, anon, () => db.query("select * from public.restaurants"))).rejects.toThrow(/permission denied/i);
  });

  it("a logged-in user who is not on the vendor team is refused", async () => {
    await expect(rpc(db, nobody, "public.vendor_overview(30)")).rejects.toThrow(/Not allowed/);
    await expect(rpc(db, nobody, "public.vendor_list_clients('{}'::jsonb)")).rejects.toThrow(/Not allowed/);
    expect(await rpc(db, nobody, "public.vendor_me()")).toBeNull();
  });

  it("a password-only login (no two-factor) is refused, until two-factor is switched off", async () => {
    const weak: Who = { role: "authenticated", uid: bossId, aal: "aal1" };
    await expect(rpc(db, weak, "public.vendor_overview(30)")).rejects.toThrow(/Not allowed/);
    await expect(create({}, weak)).rejects.toThrow(/super admin/);
    expect(await rpc<any>(db, weak, "public.vendor_me()")).toMatchObject({ name: "Rajesh Verma" }); // so the app can ask for the code
    await db.query("update public.app_settings set value = '0' where key = 'require_mfa'");
    try {
      expect((await rpc<any>(db, weak, "public.vendor_overview(30)")).counts.total).toBe(0);
    } finally {
      await db.query("update public.app_settings set value = '1' where key = 'require_mfa'");
    }
  });

  it("vendor admins cannot read or write tables directly, only call the functions", async () => {
    await expect(as(db, boss, () => db.query("select * from public.licenses"))).rejects.toThrow(/permission denied/i);
    await expect(as(db, boss, () => db.query("delete from public.license_events"))).rejects.toThrow(/permission denied/i);
    await expect(as(db, boss, () => db.query("update public.plans set price_paise = 1"))).rejects.toThrow(/permission denied/i);
  });

  it("restaurant-app functions are reachable only by the service role", async () => {
    const c = await create();
    await expect(rpc(db, boss, "public.license_activate($1, 'x', 'x', 'x')", [c.license_key])).rejects.toThrow(/permission denied/i);
    await expect(rpc(db, anon, "public.license_checkin($1, 'x', 'x', '[]'::jsonb)", [c.license_key])).rejects.toThrow(/permission denied/i);
    expect((await activate(c.license_key)).ok).toBe(true);
  });

  it("internal helpers are not callable from outside", async () => {
    await expect(rpc(db, boss, "public.log_event(null, 'created')")).rejects.toThrow(/permission denied/i);
    await expect(rpc(db, boss, "public.generate_license_key()")).rejects.toThrow(/permission denied/i);
  });

  it("support staff can renew and reset devices but not create, suspend or edit plans", async () => {
    await expect(create({}, help)).rejects.toThrow(/super admin/);
    const c = await create();
    await expect(rpc(db, help, "public.vendor_suspend($1, 'x')", [c.restaurant_id])).rejects.toThrow(/super admin/);
    await expect(rpc(db, help, "public.vendor_update_plan($1::jsonb)", [JSON.stringify({ id: "monthly", price_paise: 1 })])).rejects.toThrow(/super admin/);
    await expect(rpc(db, help, "public.vendor_add_admin('a@b.c', 'A', 'support')")).rejects.toThrow(/super admin/);
    expect((await rpc<any>(db, help, "public.vendor_renew($1, 'yearly', 1, 'upi', 'ref')", [c.restaurant_id])).ok).toBe(true);
    expect(await rpc<any>(db, help, "public.vendor_me()")).toMatchObject({ name: "Pooja Sharma", role: "support" });
  });
});

describe("onboarding a client", () => {
  it("creates the restaurant, license, key and audit entry", async () => {
    const c = await create();
    expect(c.license_key).toMatch(KEY);
    expect(c.code).toBe("CL-HYD-0001");
    expect(c.max_devices).toBe(3); // from the yearly plan
    const exp = new Date(c.expires_at).getTime() - new Date(c.starts_at).getTime();
    expect(Math.round(exp / 86_400_000)).toBe(365);
    const ev = await q("select event, actor_name from public.license_events");
    expect(ev).toEqual([{ event: "created", actor_name: "Rajesh Verma" }]);
    expect((await create({ name: "Second", city: "Mumbai" })).code).toBe("CL-MUM-0002");
  });

  it("makes unique keys", async () => {
    const keys = new Set<string>();
    for (let i = 0; i < 8; i++) keys.add((await create({ name: `R${i}` })).license_key);
    expect(keys.size).toBe(8);
  });

  it("gives a lifetime license no expiry and honours a custom terminal count", async () => {
    const c = await create({ plan_id: "lifetime", max_devices: 2 });
    expect(c.expires_at).toBeNull();
    expect(c.max_devices).toBe(2);
  });

  it("records the first payment with GST when it was received", async () => {
    const c = await create({ payment: { received: true, method: "upi", reference: "UTR123" } });
    const [p] = await q("select * from public.payments where restaurant_id = $1", [c.restaurant_id]);
    expect(p).toMatchObject({ subtotal_paise: 2499900, gst_paise: 449982, total_paise: 2949882, method: "upi", reference: "UTR123" });
    expect(await q("select * from public.payments")).toHaveLength(1);
    const none = await create({ name: "Unpaid", payment: { received: false } });
    expect(await q("select * from public.payments where restaurant_id = $1", [none.restaurant_id])).toHaveLength(0);
  });

  it("rejects bad input and creates nothing", async () => {
    await expect(create({ name: " " })).rejects.toThrow(/Restaurant name is required/);
    await expect(create({ email: "nope" })).rejects.toThrow(/valid email/);
    await expect(create({ gstin: "123" })).rejects.toThrow(/GSTIN/);
    await expect(create({ plan_id: "gold" })).rejects.toThrow(/Choose a plan/);
    await expect(create({ max_devices: 0 })).rejects.toThrow(/between 1 and 50/);
    expect(await q("select * from public.restaurants")).toHaveLength(0);
    expect(await q("select * from public.license_events")).toHaveLength(0);
  });

  it("allows a blank GSTIN", async () => {
    expect((await create({ gstin: "" })).license_key).toMatch(KEY);
  });
});

describe("renewing", () => {
  const renew = (id: string, plan = "yearly", periods = 1, extra = "") =>
    rpc<any>(db, boss, `public.vendor_renew($1, $2, $3, 'upi', 'ref'${extra})`, [id, plan, periods]);

  it("extends from the current expiry when paying early, so no days are lost", async () => {
    const c = await create();
    const before = new Date(c.expires_at).getTime();
    const r = await renew(c.restaurant_id);
    expect(Math.round((new Date(r.expires_at).getTime() - before) / 86_400_000)).toBe(365);
  });

  it("starts from today when the license had already ended", async () => {
    const c = await create();
    await db.query("update public.licenses set expires_at = now() - interval '40 days' where restaurant_id = $1", [c.restaurant_id]);
    const r = await renew(c.restaurant_id);
    const days = (new Date(r.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(364.9);
    expect(days).toBeLessThan(365.1);
  });

  it("charges price x periods plus 18% GST, and records it", async () => {
    const c = await create();
    const r = await renew(c.restaurant_id, "monthly", 3);
    expect(r).toMatchObject({ subtotal_paise: 749700, gst_paise: 134946, total_paise: 884646 });
    const [p] = await q("select * from public.payments where restaurant_id = $1", [c.restaurant_id]);
    expect(p.periods).toBe(3);
    expect(p.plan_id).toBe("monthly");
  });

  it("takes an agreed final amount (GST inside) and allows a waived renewal", async () => {
    const c = await create();
    const r = await rpc<any>(db, boss, "public.vendor_renew($1, 'yearly', 1, 'bank', 'NEFT', 2000000)", [c.restaurant_id]);
    expect(r.total_paise).toBe(2000000);
    expect(r.subtotal_paise + r.gst_paise).toBe(2000000);
    const w = await rpc<any>(db, boss, "public.vendor_renew($1, 'yearly', 1, 'waived', 'goodwill', 0)", [c.restaurant_id]);
    expect(w.total_paise).toBe(0);
  });

  it("raises the terminal limit when moving to a bigger plan, never lowers it", async () => {
    const c = await create({ plan_id: "monthly" });
    await renew(c.restaurant_id, "yearly");
    expect((await q("select max_devices from public.licenses"))[0].max_devices).toBe(3);
    await renew(c.restaurant_id, "monthly");
    expect((await q("select max_devices from public.licenses"))[0].max_devices).toBe(3);
  });

  it("can upgrade to lifetime, after which it cannot be renewed", async () => {
    const c = await create();
    const r = await renew(c.restaurant_id, "lifetime");
    expect(r.expires_at).toBeNull();
    await expect(renew(c.restaurant_id)).rejects.toThrow(/lifetime/);
  });

  it("refuses a suspended license unless reactivating, then reactivates it", async () => {
    const c = await create();
    await rpc(db, boss, "public.vendor_suspend($1, 'Overdue')", [c.restaurant_id]);
    await expect(renew(c.restaurant_id)).rejects.toThrow(/suspended/);
    await rpc(db, boss, "public.vendor_renew($1, 'yearly', 1, 'cash', '', null, true)", [c.restaurant_id]);
    expect((await q("select status from public.licenses"))[0].status).toBe("active");
    const ev = (await q("select event from public.license_events order by id")).map((e) => e.event);
    expect(ev).toEqual(["created", "suspended", "renewed", "reactivated"]);
  });

  it("validates input and changes nothing on failure", async () => {
    const c = await create();
    const [before] = await q("select expires_at from public.licenses");
    await expect(renew(c.restaurant_id, "yearly", 0)).rejects.toThrow(/Periods/);
    await expect(rpc(db, boss, "public.vendor_renew($1, 'yearly', 1, 'barter', '')", [c.restaurant_id])).rejects.toThrow(/payment was received/);
    await expect(rpc(db, boss, "public.vendor_renew($1, 'yearly', 1, 'upi', '', -5)", [c.restaurant_id])).rejects.toThrow(/negative/);
    await expect(renew(c.restaurant_id, "platinum")).rejects.toThrow(/Choose a plan/);
    expect((await q("select expires_at from public.licenses"))[0].expires_at).toEqual(before.expires_at);
    expect(await q("select * from public.payments")).toHaveLength(0);
  });
});

describe("suspending and reactivating", () => {
  it("needs a reason, is idempotent, and is logged", async () => {
    const c = await create();
    await expect(rpc(db, boss, "public.vendor_suspend($1, '  ')", [c.restaurant_id])).rejects.toThrow(/reason is required/i);
    await rpc(db, boss, "public.vendor_suspend($1, 'Payment bounced')", [c.restaurant_id]);
    const again = await rpc<any>(db, boss, "public.vendor_suspend($1, 'again')", [c.restaurant_id]);
    expect(again.already).toBe(true);
    expect((await q("select status, suspended_reason from public.licenses"))[0]).toEqual({ status: "suspended", suspended_reason: "Payment bounced" });
    await rpc(db, help, "public.vendor_reactivate($1, 'Paid by UPI')", [c.restaurant_id]);
    expect((await q("select status, suspended_reason from public.licenses"))[0]).toEqual({ status: "active", suspended_reason: null });
    const ev = await q("select event, reason, actor_name from public.license_events order by id");
    expect(ev.map((e) => e.event)).toEqual(["created", "suspended", "reactivated"]);
    expect(ev[2]).toMatchObject({ reason: "Paid by UPI", actor_name: "Pooja Sharma" });
  });
});

describe("terminals (devices)", () => {
  it("binds a PC on activation and logs 'activated' then 'device_bound'", async () => {
    const c = await create({ plan_id: "yearly" });
    const a = await activate(c.license_key, "PC-1", "Front counter");
    expect(a).toMatchObject({ ok: true, restaurant_name: "Spice Garden", state: "active", max_devices: 3, devices_used: 1, grace_days: 7 });
    expect(await activate(c.license_key, "PC-1")).toMatchObject({ ok: true, devices_used: 1 }); // same PC again
    await activate(c.license_key, "PC-2", "Kitchen");
    const ev = (await q("select event from public.license_events order by id")).map((e) => e.event);
    expect(ev).toEqual(["created", "activated", "device_bound"]);
  });

  it("accepts keys typed in lower case with spaces", async () => {
    const c = await create();
    expect((await activate(`  ${c.license_key.toLowerCase()} `)).ok).toBe(true);
  });

  it("refuses a PC beyond the terminal limit, and a reset frees the slot", async () => {
    const c = await create({ plan_id: "monthly" }); // 1 terminal
    await activate(c.license_key, "PC-1");
    const blocked = await activate(c.license_key, "PC-2");
    expect(blocked).toMatchObject({ ok: false, code: "device_limit" });
    const [d] = await q("select id from public.license_devices where machine_id = 'PC-1'");
    await expect(rpc(db, boss, "public.vendor_reset_device($1, '')", [d.id])).rejects.toThrow(/reason is required/i);
    await rpc(db, help, "public.vendor_reset_device($1, 'Motherboard replaced')", [d.id]);
    expect((await activate(c.license_key, "PC-2")).ok).toBe(true);
    // the old PC is now locked out
    expect(await checkin(c.license_key, "PC-1")).toMatchObject({ ok: false, code: "device_not_bound" });
    const [ev] = await q("select reason, payload from public.license_events where event = 'device_reset'");
    expect(ev.reason).toBe("Motherboard replaced");
    expect(ev.payload.machine_id).toBe("PC-1");
  });

  it("lets a reset PC come back when a slot is free", async () => {
    const c = await create({ plan_id: "yearly" });
    await activate(c.license_key, "PC-1");
    const [d] = await q("select id from public.license_devices");
    await rpc(db, boss, "public.vendor_reset_device($1, 'test')", [d.id]);
    expect((await activate(c.license_key, "PC-1")).ok).toBe(true);
    expect(await q("select * from public.license_devices")).toHaveLength(1);
  });

  it("will not lower the terminal limit below the PCs already bound", async () => {
    const c = await create({ plan_id: "yearly" });
    await activate(c.license_key, "PC-1");
    await activate(c.license_key, "PC-2");
    await expect(rpc(db, boss, "public.vendor_update_client($1, '{\"max_devices\": 1}'::jsonb)", [c.restaurant_id])).rejects.toThrow(/already bound/);
  });

  it("explains refusals for bad, suspended and expired licenses", async () => {
    expect(await activate("0000-0000-0000-0000")).toMatchObject({ ok: false, code: "invalid_key" });
    expect(await rpc<any>(db, service, "public.license_activate($1, '', '', '')", ["x"])).toMatchObject({ ok: false, code: "bad_request" });
    const c = await create();
    await rpc(db, boss, "public.vendor_suspend($1, 'Overdue')", [c.restaurant_id]);
    expect(await activate(c.license_key)).toMatchObject({ ok: false, code: "suspended" });
    await rpc(db, boss, "public.vendor_reactivate($1)", [c.restaurant_id]);
    await db.query("update public.licenses set expires_at = now() - interval '30 days'");
    expect(await activate(c.license_key)).toMatchObject({ ok: false, code: "expired" });
    await db.query("update public.licenses set expires_at = now() - interval '2 days'"); // inside the 7-day grace
    expect(await activate(c.license_key)).toMatchObject({ ok: true, state: "grace" });
  });
});

describe("check-in and daily summaries", () => {
  it("stores summaries, overwrites a day on re-sync, and refreshes the license", async () => {
    const c = await create();
    await activate(c.license_key, "PC-1");
    const r = await checkin(c.license_key, "PC-1", [summary(-1, 100000), summary(0, 50000)]);
    expect(r).toMatchObject({ ok: true, accepted: 2, state: "active" });
    await checkin(c.license_key, "PC-1", [summary(-1, 120000)]); // same day, corrected
    const rows = await q("select date::text d, sales_paise::int s from public.daily_summary order by date");
    expect(rows).toEqual([{ d: day(-1), s: 120000 }, { d: day(0), s: 50000 }]);
    expect((await q("select last_check_in_at from public.licenses"))[0].last_check_in_at).not.toBeNull();
  });

  it("reports suspension to the app while still accepting its data", async () => {
    const c = await create();
    await activate(c.license_key, "PC-1");
    await rpc(db, boss, "public.vendor_suspend($1, 'Overdue')", [c.restaurant_id]);
    const r = await checkin(c.license_key, "PC-1", [summary(0, 1000)]);
    expect(r).toMatchObject({ ok: true, state: "suspended", suspended_reason: "Overdue" });
    expect(await q("select * from public.daily_summary")).toHaveLength(1);
  });

  it("rejects bad uploads without storing any of the batch", async () => {
    const c = await create();
    await activate(c.license_key, "PC-1");
    expect(await checkin(c.license_key, "PC-1", [summary(0, 1000), summary(-1, -5)])).toMatchObject({ ok: false, code: "bad_request" });
    expect(await checkin(c.license_key, "PC-1", [{ ...summary(0, 1), date: "not-a-date" }])).toMatchObject({ ok: false, code: "bad_request" });
    expect(await checkin(c.license_key, "PC-1", [summary(30, 1)])).toMatchObject({ ok: false, code: "bad_request" });
    expect(await checkin(c.license_key, "PC-1", Array.from({ length: 401 }, (_, i) => summary(-i, 1)))).toMatchObject({ ok: false, code: "bad_request" });
    expect(await q("select * from public.daily_summary")).toHaveLength(0);
  });

  it("answers 'bad request' (not a database error) for fractions and text amounts", async () => {
    const c = await create();
    await activate(c.license_key, "PC-1");
    for (const bad of [{ salesPaise: 12.5 }, { bills: "ten" }, { cashPaise: -1 }, { upiPaise: 1e20 }, { topItemQty: 2.5 }]) {
      expect(await checkin(c.license_key, "PC-1", [{ ...summary(0, 1000), ...bad }])).toMatchObject({ ok: false, code: "bad_request" });
    }
    expect(await q("select * from public.daily_summary")).toHaveLength(0);
  });

  it("refuses unknown keys and PCs that were never activated", async () => {
    const c = await create();
    expect(await checkin("0000-0000-0000-0000", "PC-1")).toMatchObject({ ok: false, code: "invalid_key" });
    expect(await checkin(c.license_key, "PC-NEW")).toMatchObject({ ok: false, code: "device_not_bound" });
  });

  it("only ever writes to its own restaurant", async () => {
    const a = await create({ name: "A" });
    const b = await create({ name: "B", city: "Pune" });
    await activate(a.license_key, "PC-A");
    await checkin(a.license_key, "PC-A", [summary(0, 777)]);
    const rows = await q("select restaurant_id from public.daily_summary");
    expect(rows.every((r) => r.restaurant_id === a.restaurant_id)).toBe(true);
    expect(rows.some((r) => r.restaurant_id === b.restaurant_id)).toBe(false);
  });
});

describe("license states", () => {
  it("warns about a monthly license only in its last week, not its whole life", async () => {
    const m = await create({ plan_id: "monthly" });
    const stateOf = async (sql: string) => {
      await db.query(`update public.licenses set ${sql} where restaurant_id = $1`, [m.restaurant_id]);
      const d = await rpc<any>(db, boss, "public.vendor_client($1)", [m.restaurant_id]);
      return d.license.state;
    };
    expect(await stateOf("expires_at = now() + interval '29 days'")).toBe("active"); // a fresh monthly license
    expect(await stateOf("expires_at = now() + interval '10 days'")).toBe("active");
    expect(await stateOf("expires_at = now() + interval '6 days'")).toBe("expiring");
    // the same dates on a yearly license are already in its 30-day warning window
    const y = await create({ name: "Yearly One", email: "y@x.in", plan_id: "yearly" });
    await db.query("update public.licenses set expires_at = now() + interval '10 days' where restaurant_id = $1", [y.restaurant_id]);
    expect((await rpc<any>(db, boss, "public.vendor_client($1)", [y.restaurant_id])).license.state).toBe("expiring");
  });

  it("buckets by expiry: active, expiring, grace, expired, suspended", async () => {
    const c = await create();
    const state = async (sql: string) => {
      await db.query(`update public.licenses set ${sql}`);
      return (await q("select public.license_state(status, expires_at) s from public.licenses"))[0].s;
    };
    expect(await state("expires_at = now() + interval '90 days', status = 'active'")).toBe("active");
    expect(await state("expires_at = now() + interval '10 days'")).toBe("expiring");
    expect(await state("expires_at = now() - interval '1 day'")).toBe("grace");
    expect(await state("expires_at = now() - interval '8 days'")).toBe("expired");
    expect(await state("expires_at = null")).toBe("active"); // lifetime
    expect(await state("status = 'suspended'")).toBe("suspended");
    expect(c.license_key).toMatch(KEY);
  });
});

describe("lists and reports", () => {
  async function seedFleet() {
    const a = await create({ name: "Alpha Grill", city: "Hyderabad", plan_id: "yearly" });
    const b = await create({ name: "Bravo Cafe", city: "Mumbai", plan_id: "monthly", email: "b@x.in" });
    const c = await create({ name: "Charlie Dhaba", city: "Mumbai", plan_id: "yearly", email: "c@x.in" });
    const d = await create({ name: "Delta Diner", city: "Pune", plan_id: "lifetime", email: "d@x.in" });
    await db.query("update public.licenses set expires_at = now() + interval '6 days' where restaurant_id = $1", [b.restaurant_id]);
    await rpc(db, boss, "public.vendor_suspend($1, 'Overdue')", [c.restaurant_id]);
    await activate(a.license_key, "PC-A");
    await checkin(a.license_key, "PC-A", [summary(-1, 200000), summary(0, 300000)]);
    await activate(d.license_key, "PC-D");
    await checkin(d.license_key, "PC-D", [summary(0, 100000)]);
    // Charlie has gone quiet: last check-in long ago
    await db.query("update public.licenses set last_check_in_at = now() - interval '20 days' where restaurant_id = $1", [c.restaurant_id]);
    return { a, b, c, d };
  }

  it("lists clients with counts, filters and search", async () => {
    await seedFleet();
    const all = await rpc<any>(db, boss, "public.vendor_list_clients('{}'::jsonb)");
    expect(all.total).toBe(4);
    expect(all.counts).toMatchObject({ all: 4, active: 2, expiring: 1, suspended: 1 });
    expect(all.rows.map((r: any) => r.name)).toEqual(["Alpha Grill", "Bravo Cafe", "Charlie Dhaba", "Delta Diner"]);
    const alpha = all.rows[0];
    expect(alpha).toMatchObject({ today_sales_paise: 300000, today_bills: 10, devices_used: 1, max_devices: 3, state: "active" });

    const f = (o: object) => rpc<any>(db, boss, "public.vendor_list_clients($1::jsonb)", [JSON.stringify(o)]);
    expect((await f({ status: "expiring" })).rows.map((r: any) => r.name)).toEqual(["Bravo Cafe"]);
    expect((await f({ status: "suspended" })).rows.map((r: any) => r.name)).toEqual(["Charlie Dhaba"]);
    expect((await f({ city: "mumbai" })).total).toBe(2);
    expect((await f({ plan: "lifetime" })).rows.map((r: any) => r.name)).toEqual(["Delta Diner"]);
    expect((await f({ search: "dhaba" })).total).toBe(1);
    expect((await f({ search: "100%" })).total).toBe(0); // wildcards are not special
    expect((await f({ limit: 2, offset: 2 })).rows.map((r: any) => r.name)).toEqual(["Charlie Dhaba", "Delta Diner"]);
    expect(all.cities[0]).toEqual({ city: "Mumbai", n: 2 });
  });

  it("finds a client by license key", async () => {
    const { a } = await seedFleet();
    const r = await rpc<any>(db, boss, "public.vendor_list_clients($1::jsonb)", [JSON.stringify({ search: a.license_key.slice(0, 9) })]);
    expect(r.rows.map((x: any) => x.name)).toContain("Alpha Grill");
  });

  it("treats a quiet client as offline, but never a suspended one, and never a brand-new one", async () => {
    await seedFleet();
    const off = await rpc<any>(db, boss, "public.vendor_list_clients('{\"status\":\"offline\"}'::jsonb)");
    expect(off.total).toBe(0); // Charlie is quiet but suspended; the others are recent or new
    await db.query("update public.licenses set last_check_in_at = now() - interval '9 days' where restaurant_id = (select id from public.restaurants where name = 'Alpha Grill')");
    const off2 = await rpc<any>(db, boss, "public.vendor_list_clients('{\"status\":\"offline\"}'::jsonb)");
    expect(off2.rows.map((r: any) => r.name)).toEqual(["Alpha Grill"]);
  });

  it("gives the overview counts, a day-by-day total, top clients and what needs attention", async () => {
    await seedFleet();
    const o = await rpc<any>(db, boss, "public.vendor_overview(30)");
    expect(o.counts).toMatchObject({ total: 4, active: 2, expiring: 1, suspended: 1, enrolled_this_month: 4 });
    expect(o.gmv.series).toHaveLength(30);
    expect(o.gmv.total_paise).toBe(600000);
    expect(o.gmv.prev_total_paise).toBe(0);
    expect(o.top_clients[0]).toMatchObject({ name: "Alpha Grill", sales_paise: 500000 });
    expect(o.attention.map((a: any) => a.name)).toEqual(["Charlie Dhaba", "Bravo Cafe"]); // suspended first
    expect(o.attention[1]).toMatchObject({ state: "expiring" });
    expect(o.recent.length).toBeGreaterThan(0);
    const today = o.gmv.series[o.gmv.series.length - 1];
    expect(today).toMatchObject({ date: day(0), sales_paise: 400000, outlets: 2 });
  });

  it("shows one client's full detail", async () => {
    const { a } = await seedFleet();
    const d = await rpc<any>(db, boss, "public.vendor_client($1)", [a.restaurant_id]);
    expect(d.restaurant).toMatchObject({ name: "Alpha Grill", code: "CL-HYD-0001" });
    expect(d.license).toMatchObject({ license_key: a.license_key, plan_name: "Yearly Pro", state: "active", max_devices: 3, offline: false });
    expect(d.devices).toHaveLength(1);
    expect(d.summaries).toHaveLength(2);
    expect(d.totals).toMatchObject({ sales_paise: 500000, bills: 20 });
    expect(d.events.map((e: any) => e.event)).toEqual(["activated", "created"]); // newest first
    await expect(rpc(db, boss, "public.vendor_client('00000000-0000-0000-0000-000000000000')")).rejects.toThrow(/not found/);
  });

  it("lists licenses by tab with the renewal strip", async () => {
    const { b } = await seedFleet();
    await db.query("update public.licenses set expires_at = now() - interval '2 days' where restaurant_id = (select id from public.restaurants where name = 'Alpha Grill')");
    const f = (o: object) => rpc<any>(db, boss, "public.vendor_list_licenses($1::jsonb)", [JSON.stringify(o)]);
    const exp = await f({ tab: "expiring" });
    expect(exp.rows.map((r: any) => r.name)).toEqual(["Bravo Cafe"]);
    expect(exp.rows[0]).toMatchObject({ days_left: 6, price_paise: 249900, license_key: b.license_key });
    expect((await f({ tab: "expiring", horizon_days: 3 })).rows).toHaveLength(0);
    expect((await f({ tab: "expiring", horizon_days: 7 })).rows).toHaveLength(1);
    expect((await f({ tab: "expired" })).rows.map((r: any) => r.name)).toEqual(["Alpha Grill"]); // in grace
    expect((await f({ tab: "suspended" })).rows.map((r: any) => r.name)).toEqual(["Charlie Dhaba"]);
    const all = await f({ tab: "all" });
    expect(all.rows).toHaveLength(4);
    expect(all.rows[all.rows.length - 1].name).toBe("Delta Diner"); // lifetime sorts last
    expect(all.strip).toMatchObject({ pipeline_paise: 249900, in_grace: 1, suspended: 1 });
    expect(all.counts).toMatchObject({ expiring: 1, expired: 1, suspended: 1, all: 4 });
  });

  it("calculates growth against the previous period of the same length", async () => {
    const { a, d } = await seedFleet();
    await checkin(a.license_key, "PC-A", [summary(-7, 100000, { topItemName: "Dal Makhani", topItemQty: 50 })]);
    const r = await rpc<any>(db, boss, "public.vendor_sales_insights($1::date, $2::date)", [day(-3), day(0)]);
    // current = days -3..0 = Alpha 200000 + 300000, Delta 100000; previous = days -7..-4 = Alpha 100000
    expect(r.totals.sales_paise).toBe(600000);
    expect(r.prev.sales_paise).toBe(100000);
    const alpha = r.clients.find((c: any) => c.name === "Alpha Grill");
    expect(alpha).toMatchObject({ sales_paise: 500000, prev_sales_paise: 100000, growth_pct: 400, is_new: false });
    const delta = r.clients.find((c: any) => c.name === "Delta Diner");
    expect(delta).toMatchObject({ is_new: true, growth_pct: null });
    expect(r.clients[0].name).toBe("Alpha Grill"); // ranked by sales
    expect(r.series).toHaveLength(4);
    expect(r.prev_series).toHaveLength(4);
    expect(r.prev_series[3].date).toBe(day(0)); // previous period is lined up under the current dates
    expect(r.cities[0]).toMatchObject({ city: "Hyderabad", sales_paise: 500000 });
    expect(d.license_key).toMatch(KEY);
  });

  it("rejects an invalid or huge date range", async () => {
    await expect(rpc(db, boss, "public.vendor_sales_insights($1::date, $2::date)", [day(0), day(-3)])).rejects.toThrow(/valid date range/);
    await expect(rpc(db, boss, "public.vendor_sales_insights($1::date, $2::date)", [day(-500), day(0)])).rejects.toThrow(/400 days/);
  });

  it("filters the activity log by type, person, search and date, with counts", async () => {
    const { a, b } = await seedFleet();
    await rpc(db, help, "public.vendor_renew($1, 'monthly', 1, 'upi', 'ref')", [b.restaurant_id]);
    const f = (o: object) => rpc<any>(db, boss, "public.vendor_activity($1::jsonb)", [JSON.stringify(o)]);
    const all = await f({});
    expect(all.counts).toMatchObject({ created: 4, suspended: 1, renewed: 1, activated: 2 });
    expect(all.total).toBe(8);
    expect(all.rows[0].event).toBe("renewed"); // newest first
    expect((await f({ event: "created" })).total).toBe(4);
    expect((await f({ actor: helpId })).rows.map((r: any) => r.event)).toEqual(["renewed"]);
    expect((await f({ search: "alpha" })).rows.every((r: any) => r.restaurant_name === "Alpha Grill")).toBe(true);
    expect((await f({ from: day(1) })).total).toBe(0);
    expect((await f({ from: day(0), to: day(0) })).total).toBe(8);
    expect((await f({ limit: 3 })).rows).toHaveLength(3);
    expect(all.actors.map((x: any) => x.name)).toEqual(["Pooja Sharma", "Rajesh Verma"]);
    expect(a.license_key).toMatch(KEY);
  });

  it("keeps the activity log append-only, even for the database owner", async () => {
    await create();
    await expect(db.query("update public.license_events set reason = 'x'")).rejects.toThrow(/append-only/);
    await expect(db.query("delete from public.license_events")).rejects.toThrow(/append-only/);
  });
});

describe("editing clients, plans and the team", () => {
  it("updates only the fields sent, validates them, and logs what changed", async () => {
    const c = await create();
    const r = await rpc<any>(db, help, "public.vendor_update_client($1, $2::jsonb)", [c.restaurant_id, JSON.stringify({ phone: "+91 90000 00000", notes: "VIP" })]);
    expect(r.changed).toEqual(["phone", "notes"]);
    await expect(rpc(db, help, "public.vendor_update_client($1, '{\"max_devices\": 9}'::jsonb)", [c.restaurant_id])).rejects.toThrow(/super admin/);
    await rpc(db, boss, "public.vendor_update_client($1, '{\"max_devices\": 9}'::jsonb)", [c.restaurant_id]);
    expect((await q("select max_devices from public.licenses"))[0].max_devices).toBe(9);
    const [row] = await q("select name, phone, notes from public.restaurants");
    expect(row).toEqual({ name: "Spice Garden", phone: "+91 90000 00000", notes: "VIP" });
    await expect(rpc(db, boss, "public.vendor_update_client($1, '{\"email\":\"bad\"}'::jsonb)", [c.restaurant_id])).rejects.toThrow(/valid email/);
    await expect(rpc(db, boss, "public.vendor_update_client($1, '{\"name\":\"\"}'::jsonb)", [c.restaurant_id])).rejects.toThrow(/required/);
    const [ev] = await q("select payload from public.license_events where event = 'updated'");
    expect(ev.payload.changed).toEqual(["phone", "notes"]);
  });

  it("tells the screens the rates they need", async () => {
    expect(await rpc(db, help, "public.vendor_config()")).toEqual({ gst_bp: 1800, grace_days: 7, expiring_days: 30, expiring_days_monthly: 7, offline_days: 7 });
    await expect(rpc(db, nobody, "public.vendor_config()")).rejects.toThrow(/Not allowed/);
  });

  it("lets a super admin edit plans, within limits", async () => {
    await rpc(db, boss, "public.vendor_update_plan($1::jsonb)", [JSON.stringify({ id: "monthly", price_paise: 299900, name: "Monthly Plus" })]);
    const plans = await rpc<any[]>(db, boss, "public.vendor_plans()");
    expect(plans.find((p) => p.id === "monthly")).toMatchObject({ price_paise: 299900, name: "Monthly Plus" });
    expect(plans.map((p) => p.id)).toEqual(["monthly", "yearly", "lifetime"]); // sorted by price
    await expect(rpc(db, boss, "public.vendor_update_plan($1::jsonb)", [JSON.stringify({ id: "monthly", price_paise: -1 })])).rejects.toThrow(/negative/);
    await expect(rpc(db, boss, "public.vendor_update_plan($1::jsonb)", [JSON.stringify({ id: "ghost" })])).rejects.toThrow(/not found/);
    // a deactivated plan can't be chosen for new clients
    await rpc(db, boss, "public.vendor_update_plan($1::jsonb)", [JSON.stringify({ id: "monthly", active: false })]);
    await expect(create({ plan_id: "monthly" })).rejects.toThrow(/Choose a plan/);
  });

  it("adds and removes team members with safeguards", async () => {
    await addUser(db, "new@ssbills.in");
    await expect(rpc(db, boss, "public.vendor_add_admin('ghost@x.in', 'Ghost', 'support')")).rejects.toThrow(/No login exists/);
    await expect(rpc(db, boss, "public.vendor_add_admin('new@ssbills.in', 'New', 'owner')")).rejects.toThrow(/role/);
    await rpc(db, boss, "public.vendor_add_admin('new@ssbills.in', 'New Person', 'support')");
    const team = await rpc<any[]>(db, help, "public.vendor_team()");
    expect(team.map((t) => t.name).sort()).toEqual(["New Person", "Pooja Sharma", "Rajesh Verma"]);
    expect(team.find((t) => t.name === "New Person").email).toBe("new@ssbills.in");
    await expect(rpc(db, boss, "public.vendor_remove_admin($1)", [bossId])).rejects.toThrow(/yourself/);
    const [n] = await q("select user_id from public.vendor_admins where name = 'New Person'");
    await rpc(db, boss, "public.vendor_remove_admin($1)", [n.user_id]);
    expect(await rpc<any[]>(db, boss, "public.vendor_team()")).toHaveLength(2);
    // a second super admin may remove the first, but never the last one
    await addUser(db, "second@ssbills.in");
    await rpc(db, boss, "public.vendor_add_admin('second@ssbills.in', 'Second', 'super_admin')");
    const [second] = await q("select user_id from public.vendor_admins where name = 'Second'");
    const secondWho: Who = { role: "authenticated", uid: second.user_id };
    await rpc(db, secondWho, "public.vendor_remove_admin($1)", [bossId]);
    await expect(rpc(db, secondWho, "public.vendor_remove_admin($1)", [second.user_id])).rejects.toThrow(/yourself/);
  });
});
