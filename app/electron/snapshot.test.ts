/* eslint-disable @typescript-eslint/no-explicit-any */
// The menu copy: building it from a database, checking it strictly, restoring from it, and the CSV import that shares the
// same repository (docs/DECISIONS.md D-043).
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { openDatabase, createRepo } = require("./db/index.cjs");
const { buildSnapshot, snapshotHash, validateSnapshot, summarize, LIMITS } = require("./snapshot.cjs");
const { readMenuCsv } = require("./menu-csv.cjs");

const open: { close(): void }[] = [];
afterEach(() => {
  while (open.length) open.pop()!.close();
});
function fresh() {
  const db = openDatabase(":memory:");
  open.push(db);
  return { db, repo: createRepo(db) };
}

const profile = {
  name: "Spice Garden", tagline: "Since 1999", address: "1 Main Rd, Pune", phone: "98100 00000", gstin: "", fssai: "", hsnSac: "996331",
  receiptHeader: "Spice Garden\n1 Main Rd", receiptFooter: "Thank you!", showLogo: true, paperWidthMm: 58,
};
const tax = { gstRateBp: 1200, pricesIncludeTax: true, serviceChargeEnabled: true, serviceChargeBp: 500 };
const seed = () => ({
  profile, tax,
  staff: [
    { id: "s1", name: "Asha", role: "admin", pin: "2468", phone: "99999 11111", active: true },
    { id: "s2", name: "Ravi", role: "cashier", pin: "1357", phone: "88888 22222", active: true },
  ],
  categories: [{ id: "c1", name: "Starters", sortOrder: 1 }, { id: "c2", name: "Mains", sortOrder: 2 }, { id: "c3", name: "Old", sortOrder: 3 }],
  menu: [
    { id: "m1", categoryId: "c1", name: "Paneer Tikka", shortCode: "PT", pricePaise: 22000, veg: true, available: true, deleted: false },
    { id: "m2", categoryId: "c2", name: "Chicken Curry", shortCode: "CC", pricePaise: 28000, veg: false, available: false, deleted: false },
    { id: "m3", categoryId: "c2", name: "Retired Dish", shortCode: "RD", pricePaise: 100, veg: true, available: false, deleted: true },
    { id: "m4", categoryId: "c3", name: "Hidden By Category", shortCode: "HC", pricePaise: 100, veg: true, available: true, deleted: false },
  ],
  tables: [{ id: "t1", label: "T1", seats: 4 }, { id: "t2", label: "T2", seats: 2 }],
  openBills: [], paidBills: [], history: [],
});
function seeded() {
  const x = fresh();
  x.repo.seedDemo(seed());
  // remove a category and a table the way the app does (soft removal)
  x.repo.upsertCategory({ id: "c3", name: "Old", sortOrder: 3, active: false });
  x.repo.upsertTable({ id: "t2", label: "T2", seats: 2, active: false });
  return x;
}

describe("building a copy from the database", () => {
  it("returns null for a database that is not set up yet", () => {
    expect(buildSnapshot(fresh().db)).toBeNull();
  });

  it("holds the profile, GST, categories, items and tables, and leaves out removed things", () => {
    const { db } = seeded();
    const s = buildSnapshot(db, new Date("2026-10-25T10:00:00Z"));
    expect(s.version).toBe(1);
    expect(s.createdAt).toBe("2026-10-25T10:00:00.000Z");
    expect(s.profile).toEqual(profile);
    expect(s.tax).toEqual(tax);
    expect(s.categories.map((c: { name: string }) => c.name)).toEqual(["Starters", "Mains"]); // "Old" was removed
    expect(s.menu.map((m: { name: string }) => m.name).sort()).toEqual(["Chicken Curry", "Paneer Tikka"]); // not the deleted item, not the removed category's item
    expect(s.tables).toEqual([{ id: "t1", label: "T1", seats: 4 }]); // T2 was removed
    expect(s.menu.find((m: { id: string }) => m.id === "m2")).toMatchObject({ pricePaise: 28000, veg: false, available: false });
  });

  it("never contains staff, PINs, phone numbers of staff, bills, printers or licence data", () => {
    const { db, repo } = seeded();
    repo.setPrinters({ receipt: "XP-80C", kot: "Kitchen" });
    repo.setMeta("license_key", "AAAA-BBBB-CCCC-DDDD");
    const text = JSON.stringify(buildSnapshot(db));
    for (const secret of ["2468", "1357", "99999 11111", "88888 22222", "Asha", "Ravi", "pin_hash", "scrypt", "XP-80C", "AAAA-BBBB", "license"]) {
      expect(text).not.toContain(secret);
    }
    expect(Object.keys(buildSnapshot(db)).sort()).toEqual(["categories", "createdAt", "menu", "profile", "tables", "tax", "version"]);
  });

  it("is a valid copy by its own rules", () => {
    const { db } = seeded();
    expect(validateSnapshot(buildSnapshot(db))).toMatchObject({ ok: true });
  });
});

describe("telling copies apart", () => {
  it("the same menu has the same hash whenever it is read, and any real change alters it", () => {
    const { db, repo } = seeded();
    const a = buildSnapshot(db, new Date("2026-01-01"));
    const b = buildSnapshot(db, new Date("2026-06-01"));
    expect(snapshotHash(a)).toBe(snapshotHash(b)); // time of reading is not part of the content
    repo.upsertMenuItem({ id: "m1", categoryId: "c1", name: "Paneer Tikka", shortCode: "PT", pricePaise: 23000, veg: true, available: true, deleted: false });
    expect(snapshotHash(buildSnapshot(db))).not.toBe(snapshotHash(a));
  });

  it("each kind of change alters the hash", () => {
    const { db, repo } = seeded();
    const h = () => snapshotHash(buildSnapshot(db));
    const seen = new Set([h()]);
    repo.setTax({ ...tax, gstRateBp: 500 }); seen.add(h());
    repo.setProfile({ ...profile, tagline: "New" }); seen.add(h());
    repo.upsertTable({ id: "t9", label: "T9", seats: 6, active: true }); seen.add(h());
    repo.upsertCategory({ id: "c9", name: "Desserts", sortOrder: 9, active: true }); seen.add(h());
    expect(seen.size).toBe(5);
  });
});

describe("checking a copy before it is used", () => {
  const good = () => buildSnapshot(seeded().db);
  const bad = (mutate: (s: any) => void) => {
    const s = JSON.parse(JSON.stringify(good()));
    mutate(s);
    return validateSnapshot(s);
  };

  it("accepts a good copy and returns a cleaned version of it", () => {
    const r = validateSnapshot(good());
    expect(r.ok).toBe(true);
    expect(r.snapshot.menu).toHaveLength(2);
  });

  it("refuses anything that is not a copy", () => {
    for (const junk of [null, undefined, 5, "text", [], {}, { version: 1 }]) expect(validateSnapshot(junk).ok).toBe(false);
  });

  it("refuses a newer format with a message that says to update the app, and an unknown one", () => {
    expect(bad((s) => { s.version = 2; })).toMatchObject({ ok: false, error: expect.stringMatching(/newer version.*Update/) });
    expect(bad((s) => { s.version = 0; })).toMatchObject({ ok: false });
    expect(bad((s) => { s.version = "1"; })).toMatchObject({ ok: false });
  });

  it("refuses any extra field anywhere (so a PIN or a phone number can never ride along)", () => {
    for (const mutate of [
      (s: any) => { s.staff = [{ name: "x", pin: "1234" }]; },
      (s: any) => { s.bills = []; },
      (s: any) => { s.profile.ownerPin = "1"; },
      (s: any) => { s.tax.secret = 1; },
      (s: any) => { s.categories[0].extra = 1; },
      (s: any) => { s.menu[0].pin = "1"; },
      (s: any) => { s.tables[0].phone = "9"; },
    ]) expect(bad(mutate).ok).toBe(false);
  });

  it("refuses wrong types, bad prices, and values out of range", () => {
    for (const mutate of [
      (s: any) => { s.menu[0].pricePaise = 12.5; },
      (s: any) => { s.menu[0].pricePaise = -1; },
      (s: any) => { s.menu[0].pricePaise = 100_000_001; },
      (s: any) => { s.menu[0].pricePaise = "100"; },
      (s: any) => { s.menu[0].veg = "yes"; },
      (s: any) => { s.menu[0].name = ""; },
      (s: any) => { s.menu[0].name = "   "; },
      (s: any) => { s.menu[0].name = 5; },
      (s: any) => { s.menu[0].name = "x".repeat(121); },
      (s: any) => { s.profile.name = ""; },
      (s: any) => { s.profile.paperWidthMm = 100; },
      (s: any) => { s.profile.showLogo = 1; },
      (s: any) => { s.tax.gstRateBp = 10001; },
      (s: any) => { s.tax.pricesIncludeTax = "no"; },
      (s: any) => { s.tables[0].seats = 0; },
      (s: any) => { s.tables[0].seats = 51; },
      (s: any) => { s.categories[0].name = null; },
    ]) expect(bad(mutate).ok).toBe(false);
  });

  it("refuses broken links and repeats", () => {
    expect(bad((s) => { s.menu[0].categoryId = "nope"; })).toMatchObject({ ok: false, error: expect.stringMatching(/category that is not in the copy/) });
    expect(bad((s) => { s.menu.push({ ...s.menu[0] }); })).toMatchObject({ ok: false, error: expect.stringMatching(/repeats/) });
    expect(bad((s) => { s.categories.push({ ...s.categories[0] }); })).toMatchObject({ ok: false });
    expect(bad((s) => { s.tables.push({ id: "tx", label: "t1", seats: 2 }); })).toMatchObject({ ok: false, error: expect.stringMatching(/repeats/) }); // same label ignoring case
    expect(bad((s) => { s.tables.push({ ...s.tables[0] }); })).toMatchObject({ ok: false });
  });

  it("refuses oversized lists", () => {
    expect(bad((s) => { s.menu = Array.from({ length: LIMITS.menu + 1 }, (_, i) => ({ id: `m${i}`, categoryId: "c1", name: "x", shortCode: "X", pricePaise: 1, veg: true, available: true })); }).ok).toBe(false);
    expect(bad((s) => { s.tables = Array.from({ length: LIMITS.tables + 1 }, (_, i) => ({ id: `t${i}`, label: `T${i}`, seats: 2 })); }).ok).toBe(false);
  });

  it("never throws on hostile input", () => {
    const evil = [{ version: 1, profile: null }, { version: 1, profile: {}, tax: {}, categories: [null], menu: [], tables: [] }, { version: 1, profile: { name: {} }, tax: {}, categories: [], menu: [], tables: [] },
      JSON.parse('{"__proto__": {"polluted": 1}, "version": 1}'), { version: 1, categories: "x", menu: "y", tables: "z" }];
    for (const e of evil) expect(() => validateSnapshot(e)).not.toThrow();
    expect(({} as any).polluted).toBeUndefined();
  });

  it("summarizes a copy in plain numbers", () => {
    expect(summarize(validateSnapshot(good()).snapshot, "2026-10-22T10:00:00Z")).toEqual({ restaurantName: "Spice Garden", items: 2, categories: 2, tables: 1, savedAt: "2026-10-22T10:00:00Z" });
  });
});

describe("restoring a brand-new PC from a copy", () => {
  const admin = { name: "Meena", pin: "9876" };

  it("recreates the menu, tables, GST and profile, with a NEW admin and PIN", () => {
    const copy = buildSnapshot(seeded().db);
    const { db, repo } = fresh();
    expect(repo.restoreFromSnapshot({ snapshot: copy, admin })).toEqual({ categories: 2, items: 2, tables: 1 });
    const again = buildSnapshot(db);
    expect(snapshotHash(again)).toBe(snapshotHash(copy)); // identical content
    expect(repo.verifyPin({ id: db.prepare("SELECT id FROM users").get().id, pin: "9876" })).toBe(true);
    expect(db.prepare("SELECT name, role FROM users").all()).toEqual([{ name: "Meena", role: "admin" }]); // only the new admin: the old staff were never in the copy
  });

  it("the restored restaurant can take its first order", () => {
    const { repo } = fresh();
    repo.restoreFromSnapshot({ snapshot: buildSnapshot(seeded().db), admin });
    const state = repo.loadState({ today: "2026-10-25", fy: "2026-27", sinceDate: "2026-09-01" });
    expect(state.menu.map((m: { name: string }) => m.name).sort()).toEqual(["Chicken Curry", "Paneer Tikka"]);
    expect(state.tax).toMatchObject({ gstRateBp: 1200, pricesIncludeTax: true });
    expect(state.nextSeq).toBe(1); // no bills came across: numbering starts fresh
    expect(state.paidBills).toEqual([]);
  });

  it("refuses to run on a PC that already has data, and changes nothing", () => {
    const { db, repo } = seeded();
    const before = snapshotHash(buildSnapshot(db));
    expect(() => repo.restoreFromSnapshot({ snapshot: buildSnapshot(fresh().db) ?? buildSnapshot(db), admin })).toThrow(/already set up/);
    expect(snapshotHash(buildSnapshot(db))).toBe(before);
  });

  it("needs a real admin name and a 4-digit PIN, and is all or nothing", () => {
    const copy = buildSnapshot(seeded().db);
    const { db, repo } = fresh();
    for (const a of [null, {}, { name: "", pin: "1234" }, { name: "M", pin: "12" }, { name: "M", pin: "abcd" }, { name: "M" }]) {
      expect(() => repo.restoreFromSnapshot({ snapshot: copy, admin: a })).toThrow();
    }
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get().n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM menu_items").get().n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM restaurant_profile").get().n).toBe(0);
  });

  it("refuses a copy that fails the strict check, without writing anything", () => {
    const copy = JSON.parse(JSON.stringify(buildSnapshot(seeded().db)));
    copy.menu[0].categoryId = "nowhere";
    const { db, repo } = fresh();
    expect(() => repo.restoreFromSnapshot({ snapshot: copy, admin })).toThrow(/category that is not in the copy/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get().n).toBe(0);
  });
});

describe("importing a menu from CSV", () => {
  const importText = (repo: ReturnType<typeof createRepo>, text: string) => {
    const r = readMenuCsv(text);
    expect(r.errors).toEqual([]);
    return repo.importMenuRows(r.rows);
  };
  const HEAD = "Category,Name,Price,Veg,Short code,Available\n";

  it("adds new categories and items, updates existing ones, and deletes nothing", () => {
    const { db, repo } = seeded();
    const res = importText(repo, HEAD + "Starters,paneer tikka,240,Veg,PT,Yes\nBreads,Naan,40,Veg,,Yes\nBreads,Roti,25,Veg,,No\n");
    expect(res).toEqual({ created: 2, updated: 1, unchanged: 0, categoriesCreated: 1 });
    const items = db.prepare("SELECT name, price_paise, available, deleted FROM menu_items WHERE deleted = 0 ORDER BY name").all();
    expect(items.map((i: { name: string }) => i.name)).toEqual(["Chicken Curry", "Hidden By Category", "Naan", "Paneer Tikka", "Roti"]); // Chicken Curry untouched
    expect(items.find((i: { name: string }) => i.name === "Paneer Tikka").price_paise).toBe(24000); // updated
    expect(items.find((i: { name: string }) => i.name === "Roti").available).toBe(0);
    expect(db.prepare("SELECT name FROM categories WHERE active = 1 ORDER BY sort_order").all().map((c: { name: string }) => c.name)).toEqual(["Starters", "Mains", "Breads"]);
  });

  it("keeps the item's own id, name spelling, category and other fields when updating", () => {
    const { db, repo } = seeded();
    importText(repo, HEAD + "starters,PANEER TIKKA,250,Non-veg,,No\n");
    const row = db.prepare("SELECT id, name, category_id, short_code, price_paise, veg, available FROM menu_items WHERE id = 'm1'").get();
    expect(row).toEqual({ id: "m1", name: "Paneer Tikka", category_id: "c1", short_code: "PT", price_paise: 25000, veg: 0, available: 0 });
  });

  it("importing the same file twice changes nothing the second time", () => {
    const { repo } = seeded();
    const text = HEAD + "Breads,Naan,40,Veg,,Yes\n";
    expect(importText(repo, text)).toMatchObject({ created: 1 });
    expect(importText(repo, text)).toEqual({ created: 0, updated: 0, unchanged: 1, categoriesCreated: 0 });
  });

  it("an import that is previewed describes exactly what is then done", () => {
    const { repo } = seeded();
    const rows = readMenuCsv(HEAD + "Starters,Paneer Tikka,240,Veg,PT,Yes\nBreads,Naan,40,Veg,,Yes\n").rows;
    const before = JSON.stringify(repo.loadCatalog());
    const plan = repo.previewMenuImport(rows);
    expect(plan).toMatchObject({ ok: true, unchanged: 0 });
    expect(plan.creates).toHaveLength(1);
    expect(plan.updates).toHaveLength(1);
    expect(JSON.stringify(repo.loadCatalog())).toBe(before); // previewing wrote nothing
    expect(repo.importMenuRows(rows)).toMatchObject({ created: plan.creates.length, updated: plan.updates.length });
  });

  it("the exported menu can be imported again with no changes", () => {
    const { repo } = seeded();
    const { toCsv } = require("./menu-csv.cjs");
    const cat = repo.loadCatalog();
    const res = importText(repo, toCsv(cat.categories, cat.items));
    expect(res).toEqual({ created: 0, updated: 0, unchanged: 2, categoriesCreated: 0 });
  });

  it("is all or nothing if the database refuses part of it", () => {
    const { db, repo } = seeded();
    const rows = readMenuCsv(HEAD + "Breads,Naan,40,Veg,,Yes\n").rows;
    rows.push({ line: 3, category: "Breads", name: "Bad", pricePaise: 12.5, veg: true, available: true, shortCode: "" }); // a price the database refuses
    expect(() => repo.importMenuRows(rows)).toThrow();
    expect(db.prepare("SELECT COUNT(*) AS n FROM menu_items WHERE name = 'Naan'").get().n).toBe(0); // the good row was rolled back too
    expect(db.prepare("SELECT COUNT(*) AS n FROM categories WHERE name = 'Breads'").get().n).toBe(0);
  });
});
