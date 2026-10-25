// The cloud copy of a restaurant's menu and settings (migration 8): who may read and write it, what it may contain,
// how many copies are kept. Run against the real migrations in an in-memory Postgres.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addUser, as, freshDb, rpc, type Who } from "./harness";

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: PGlite;
let boss: Who;
const anon: Who = { role: "anon" };
const service: Who = { role: "service_role" };

const snapshot = (over: Record<string, unknown> = {}) => ({
  version: 1,
  createdAt: "2026-10-25T10:00:00.000Z",
  profile: { name: "Spice Garden", tagline: "", address: "1 Main Rd", phone: "98100 00000", gstin: "", fssai: "", hsnSac: "996331", receiptHeader: "Spice Garden", receiptFooter: "Thanks", showLogo: true, paperWidthMm: 80 },
  tax: { gstRateBp: 500, pricesIncludeTax: false, serviceChargeEnabled: false, serviceChargeBp: 500 },
  categories: [{ id: "c1", name: "Mains", sortOrder: 1 }],
  menu: [{ id: "m1", categoryId: "c1", name: "Paneer Butter Masala", shortCode: "PBM", pricePaise: 26000, veg: true, available: true }],
  tables: [{ id: "t1", label: "T1", seats: 4 }],
  ...over,
});

const newClient = async (name: string, over: Record<string, unknown> = {}) =>
  rpc<any>(db, boss, "public.vendor_create_client($1::jsonb)", [
    JSON.stringify({ name, owner_name: "O", phone: "1", email: "o@x.in", city: "Pune", plan_id: "monthly", ...over }),
  ]);
const activate = (key: string, machine: string) => rpc<any>(db, service, "public.license_activate($1, $2, 'Counter', '0.1.0')", [key, machine]);
const put = (key: string, machine: string, snap: unknown) => rpc<any>(db, service, "public.license_menu_put($1, $2, $3::jsonb)", [key, machine, JSON.stringify(snap)]);
const get = (key: string, machine: string) => rpc<any>(db, service, "public.license_menu_get($1, $2)", [key, machine]);
const q = async (sql: string, params: unknown[] = []) => (await db.query<any>(sql, params)).rows;

let A: any; // an activated client with one PC "PC-A"
beforeAll(async () => {
  db = await freshDb();
  boss = { role: "authenticated", uid: await addUser(db, "boss@ssbills.in", "super_admin", "Boss") };
}, 60_000);
afterAll(() => db.close());
beforeEach(async () => {
  await db.exec("alter table public.license_events disable trigger license_events_append_only");
  await db.exec("truncate public.menu_snapshots, public.license_events, public.payments, public.daily_summary, public.license_devices, public.licenses, public.restaurants restart identity cascade");
  await db.exec("alter table public.license_events enable trigger license_events_append_only");
  A = await newClient("Alpha Cafe");
  expect((await activate(A.license_key, "PC-A")).ok).toBe(true);
});

describe("saving and loading the menu copy", () => {
  it("starts with nothing, then returns exactly what was saved", async () => {
    expect(await get(A.license_key, "PC-A")).toEqual({ ok: true, found: false });
    const r = await put(A.license_key, "PC-A", snapshot());
    expect(r).toMatchObject({ ok: true, stored: true, unchanged: false, copies: 1 });
    const g = await get(A.license_key, "PC-A");
    expect(g).toMatchObject({ ok: true, found: true });
    expect(g.content).toEqual(snapshot());
    expect(g.bytes).toBeGreaterThan(100);
  });

  it("accepts the key in lower case with spaces around it", async () => {
    expect((await put(`  ${A.license_key.toLowerCase()} `, "PC-A", snapshot())).stored).toBe(true);
  });

  it("an identical menu is not stored twice, even if only the timestamp differs", async () => {
    await put(A.license_key, "PC-A", snapshot());
    const again = await put(A.license_key, "PC-A", snapshot({ createdAt: "2026-10-26T09:00:00.000Z" }));
    expect(again).toMatchObject({ ok: true, stored: false, unchanged: true });
    expect(await q("select count(*)::int as n from public.menu_snapshots")).toEqual([{ n: 1 }]);
  });

  it("a changed menu is stored as a new copy and becomes the latest", async () => {
    await put(A.license_key, "PC-A", snapshot());
    const changed = snapshot({ menu: [{ id: "m1", categoryId: "c1", name: "Paneer Butter Masala", shortCode: "PBM", pricePaise: 27000, veg: true, available: true }] });
    expect(await put(A.license_key, "PC-A", changed)).toMatchObject({ stored: true, copies: 2 });
    expect((await get(A.license_key, "PC-A")).content.menu[0].pricePaise).toBe(27000);
  });

  it("keeps only the newest 10 copies", async () => {
    for (let i = 1; i <= 13; i++) {
      await put(A.license_key, "PC-A", snapshot({ tables: [{ id: "t1", label: `T${i}`, seats: 4 }] }));
    }
    const rows = await q("select content->'tables'->0->>'label' as label from public.menu_snapshots order by id");
    expect(rows).toHaveLength(10);
    expect(rows[0].label).toBe("T4"); // the three oldest went
    expect(rows[9].label).toBe("T13");
    expect((await get(A.license_key, "PC-A")).content.tables[0].label).toBe("T13");
  });

  it("works for an empty menu (a brand-new restaurant)", async () => {
    expect((await put(A.license_key, "PC-A", snapshot({ categories: [], menu: [], tables: [] }))).stored).toBe(true);
  });
});

describe("what a menu copy may contain", () => {
  const rejected = async (snap: unknown) => {
    const r = await put(A.license_key, "PC-A", snap);
    expect(r).toMatchObject({ ok: false, code: "bad_request" });
    expect(await q("select count(*)::int as n from public.menu_snapshots")).toEqual([{ n: 0 }]);
  };

  it("refuses anything that is not the agreed shape", async () => {
    for (const bad of [null, [], "x", 5, {}, snapshot({ version: 2 }), snapshot({ version: "1; drop" }), snapshot({ categories: {} }), snapshot({ menu: "x" }), snapshot({ tables: null })]) {
      await rejected(bad);
    }
  });

  it("refuses staff, PINs, bills or any extra field, at every level", async () => {
    await rejected(snapshot({ staff: [{ name: "Asha", pin: "1234" }] }));
    await rejected(snapshot({ bills: [] }));
    await rejected(snapshot({ printers: { receipt: "XP-80" } }));
    await rejected(snapshot({ license: "KEY" }));
    await rejected(snapshot({ menu: [{ id: "m1", categoryId: "c1", name: "A", shortCode: "A", pricePaise: 1, veg: true, available: true, pin: "1" }] }));
    await rejected(snapshot({ categories: [{ id: "c1", name: "Mains", sortOrder: 1, owner: "x" }] }));
    await rejected(snapshot({ tables: [{ id: "t1", label: "T1", seats: 4, phone: "9" }] }));
    await rejected(snapshot({ profile: { ...snapshot().profile, ownerPin: "1234" } }));
    await rejected(snapshot({ tax: { ...snapshot().tax, secret: 1 } }));
  });

  it("refuses an oversized menu", async () => {
    await rejected(snapshot({ menu: Array.from({ length: 5001 }, (_, i) => ({ id: `m${i}`, categoryId: "c1", name: "x", shortCode: "X", pricePaise: 1, veg: true, available: true })) }));
    await rejected(snapshot({ categories: Array.from({ length: 201 }, (_, i) => ({ id: `c${i}`, name: "x", sortOrder: i })) }));
    await rejected(snapshot({ tables: Array.from({ length: 501 }, (_, i) => ({ id: `t${i}`, label: `T${i}`, seats: 2 })) }));
    await rejected(snapshot({ menu: [{ id: "m1", categoryId: "c1", name: "x".repeat(1_020_000), shortCode: "X", pricePaise: 1, veg: true, available: true }] }));
  });

  it("accepts 5000 realistic items", async () => {
    const big = snapshot({ menu: Array.from({ length: 5000 }, (_, i) => ({ id: `m${i}`, categoryId: "c1", name: `Dish number ${i}`, shortCode: `D${i}`, pricePaise: 10000 + i, veg: i % 2 === 0, available: true })) });
    expect((await put(A.license_key, "PC-A", big)).stored).toBe(true);
    expect((await get(A.license_key, "PC-A")).content.menu).toHaveLength(5000);
  });
});

describe("who may save or load a menu copy", () => {
  it("an unknown key, or a PC that was never linked, is refused", async () => {
    expect(await put("0000-0000-0000-0000", "PC-A", snapshot())).toMatchObject({ ok: false, code: "invalid_key" });
    expect(await get("0000-0000-0000-0000", "PC-A")).toMatchObject({ ok: false, code: "invalid_key" });
    expect(await put(A.license_key, "PC-STRANGER", snapshot())).toMatchObject({ ok: false, code: "device_not_bound" });
    expect(await get(A.license_key, "PC-STRANGER")).toMatchObject({ ok: false, code: "device_not_bound" });
    expect(await get(A.license_key, "")).toMatchObject({ ok: false, code: "device_not_bound" });
  });

  it("a PC whose terminal was reset is refused until it activates again", async () => {
    await put(A.license_key, "PC-A", snapshot());
    const dev = (await q("select id from public.license_devices"))[0];
    await rpc(db, boss, "public.vendor_reset_device($1, 'PC replaced')", [dev.id]);
    expect(await get(A.license_key, "PC-A")).toMatchObject({ ok: false, code: "device_not_bound" });
    // the replacement PC links (one slot), and can now restore the menu
    expect((await activate(A.license_key, "PC-NEW")).ok).toBe(true);
    expect((await get(A.license_key, "PC-NEW")).found).toBe(true);
  });

  it("a suspended or expired licence cannot save or load, and works again once restored", async () => {
    await put(A.license_key, "PC-A", snapshot());
    await rpc(db, boss, "public.vendor_suspend($1, 'unpaid')", [A.restaurant_id]);
    expect(await get(A.license_key, "PC-A")).toMatchObject({ ok: false, code: "suspended" });
    expect(await put(A.license_key, "PC-A", snapshot({ tables: [] }))).toMatchObject({ ok: false, code: "suspended" });
    await rpc(db, boss, "public.vendor_reactivate($1, 'paid')", [A.restaurant_id]);
    expect((await get(A.license_key, "PC-A")).found).toBe(true);
    await db.query("update public.licenses set expires_at = now() - interval '30 days'");
    expect(await get(A.license_key, "PC-A")).toMatchObject({ ok: false, code: "expired" });
  });

  it("a licence inside its grace period can still load its menu", async () => {
    await put(A.license_key, "PC-A", snapshot());
    await db.query("update public.licenses set expires_at = now() - interval '2 days'");
    expect((await get(A.license_key, "PC-A")).found).toBe(true);
  });

  it("one restaurant can never see another's menu", async () => {
    const B = await newClient("Bravo Diner", { city: "Delhi" });
    expect((await activate(B.license_key, "PC-B")).ok).toBe(true);
    await put(A.license_key, "PC-A", snapshot());
    expect(await get(B.license_key, "PC-B")).toEqual({ ok: true, found: false });
    // B's key with A's PC id is refused (the PC is not bound to B)
    expect(await get(B.license_key, "PC-A")).toMatchObject({ ok: false, code: "device_not_bound" });
    await put(B.license_key, "PC-B", snapshot({ profile: { ...snapshot().profile, name: "Bravo Diner" } }));
    expect((await get(A.license_key, "PC-A")).content.profile.name).toBe("Spice Garden");
    expect((await get(B.license_key, "PC-B")).content.profile.name).toBe("Bravo Diner");
  });

  it("a replaced licence key keeps the menu, and the old key stops working", async () => {
    await put(A.license_key, "PC-A", snapshot());
    const r = await rpc<any>(db, boss, "public.vendor_regenerate_key($1, 'leaked')", [A.restaurant_id]);
    expect(await get(A.license_key, "PC-A")).toMatchObject({ ok: false, code: "invalid_key" });
    expect((await get(r.license_key, "PC-A")).found).toBe(true);
  });
});

describe("security", () => {
  it("only the service role can call the menu functions", async () => {
    for (const who of [anon, boss, { role: "authenticated" } as Who]) {
      await expect(rpc(db, who, "public.license_menu_get($1, 'PC-A')", [A.license_key])).rejects.toThrow(/permission denied/i);
      await expect(rpc(db, who, "public.license_menu_put($1, 'PC-A', '{}'::jsonb)", [A.license_key])).rejects.toThrow(/permission denied/i);
      await expect(rpc(db, who, "public.menu_caller($1, 'PC-A')", [A.license_key])).rejects.toThrow(/permission denied/i);
    }
  });

  it("nobody can read the table directly, not even a console admin", async () => {
    await put(A.license_key, "PC-A", snapshot());
    await expect(as(db, anon, () => db.query("select * from public.menu_snapshots"))).rejects.toThrow(/permission denied/i);
    await expect(as(db, boss, () => db.query("select * from public.menu_snapshots"))).rejects.toThrow(/permission denied/i);
    await expect(as(db, boss, () => db.query("delete from public.menu_snapshots"))).rejects.toThrow(/permission denied/i);
  });

  it("row level security is on", async () => {
    expect((await q("select rowsecurity from pg_tables where tablename = 'menu_snapshots'"))[0].rowsecurity).toBe(true);
  });

  it("the console's own reports never expose menu contents", async () => {
    await put(A.license_key, "PC-A", snapshot());
    const detail = JSON.stringify(await rpc<any>(db, boss, "public.vendor_client($1)", [A.restaurant_id]));
    expect(detail).not.toContain("Paneer Butter Masala");
    expect(detail).not.toContain("menu_snapshots");
  });
});
