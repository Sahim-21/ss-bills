import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { openDatabase, createRepo, hashPin, checkPin } = require("./index.cjs");

type Line = { itemId: string; name: string; unitPricePaise: number; veg: boolean; qty: number; kotQty: number };

const line = (itemId: string, name: string, price: number, qty: number): Line => ({
  itemId, name, unitPricePaise: price, veg: true, qty, kotQty: 0,
});

const profile = {
  name: "Test Cafe", tagline: "", address: "1 Main Rd", phone: "1", gstin: "29AAAAA0000A1Z5", fssai: "1",
  hsnSac: "996331", receiptHeader: "TEST", receiptFooter: "Thanks", showLogo: true, paperWidthMm: 80,
};
const tax = { gstRateBp: 500, pricesIncludeTax: false, serviceChargeEnabled: false, serviceChargeBp: 500 };

function demo() {
  return {
    profile, tax,
    staff: [
      { id: "s1", name: "Asha", role: "admin", pin: "1234", phone: "", active: true },
      { id: "s2", name: "Ravi", role: "cashier", pin: "1111", phone: "", active: true },
    ],
    categories: [{ id: "c1", name: "Mains", sortOrder: 1 }],
    menu: [
      { id: "m1", categoryId: "c1", name: "Paneer", shortCode: "PAN", pricePaise: 26000, veg: true, available: true, deleted: false },
      { id: "m2", categoryId: "c1", name: "Naan", shortCode: "NAN", pricePaise: 5000, veg: true, available: true, deleted: false },
    ],
    tables: [{ id: "t1", label: "T1", seats: 4 }, { id: "t2", label: "T2", seats: 2 }],
    openBills: [], paidBills: [], history: [],
  };
}

/** A payable bill: 2 × ₹260 + 3 × ₹50 = ₹670; GST 5% = ₹33.50 → total ₹703.50 → ₹704 (+₹0.50). */
function payment(id: string, over: Record<string, unknown> = {}) {
  return {
    id, fy: "2026-27", orderType: "dine_in", tableId: "t1", method: "upi", createdBy: "s2",
    createdAt: "2026-10-21T10:00:00.000Z", paidAt: "2026-10-21T10:30:00.000Z", paidDate: "2026-10-21",
    lines: [line("m1", "Paneer", 26000, 2), line("m2", "Naan", 5000, 3)],
    totals: { subtotal: 67000, serviceCharge: 0, cgst: 1675, sgst: 1675, roundOff: 50, total: 70400 },
    ...over,
  };
}

const openDbs: { close(): void }[] = [];
function fresh() {
  const db = openDatabase(":memory:");
  openDbs.push(db);
  const repo = createRepo(db);
  repo.seedDemo(demo());
  return { db, repo };
}
const tmpDirs: string[] = [];
afterEach(() => {
  while (openDbs.length) openDbs.pop()!.close();
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true }); // after the databases are closed
});

const ctx = { today: "2026-10-22", fy: "2026-27", sinceDate: "2026-08-01" };

describe("schema and seed", () => {
  it("starts empty, then seeds once", () => {
    const db = openDatabase(":memory:");
    openDbs.push(db);
    const repo = createRepo(db);
    expect(repo.loadState(ctx)).toEqual({ empty: true });
    expect(repo.seedDemo(demo())).toBe(true);
    expect(repo.seedDemo(demo())).toBe(false);
    const s = repo.loadState(ctx);
    expect(s.staff).toHaveLength(2);
    expect(s.menu).toHaveLength(2);
    expect(s.tax.gstRateBp).toBe(500);
    expect(s.nextSeq).toBe(1);
  });

  it("never returns PINs to the UI", () => {
    const { repo } = fresh();
    expect(repo.loadState(ctx).staff.every((s: { pin: string }) => s.pin === "")).toBe(true);
  });
});

describe("PINs", () => {
  it("hashes with scrypt and verifies", () => {
    const h = hashPin("4321");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(h).not.toContain("4321");
    expect(checkPin("4321", h)).toBe(true);
    expect(checkPin("4322", h)).toBe(false);
  });

  it("verifies staff PINs and rejects inactive staff", () => {
    const { repo } = fresh();
    expect(repo.verifyPin({ id: "s1", pin: "1234" })).toBe(true);
    expect(repo.verifyPin({ id: "s1", pin: "0000" })).toBe(false);
    expect(repo.verifyPin({ id: "nobody", pin: "1234" })).toBe(false);
    repo.upsertStaff({ id: "s2", name: "Ravi", role: "cashier", pin: "", phone: "", active: false });
    expect(repo.verifyPin({ id: "s2", pin: "1111" })).toBe(false);
  });

  it("keeps the old PIN when an edit sends no new one, and replaces it when one is sent", () => {
    const { repo } = fresh();
    repo.upsertStaff({ id: "s2", name: "Ravi K", role: "cashier", pin: "", phone: "9", active: true });
    expect(repo.verifyPin({ id: "s2", pin: "1111" })).toBe(true);
    repo.upsertStaff({ id: "s2", name: "Ravi K", role: "cashier", pin: "7777", phone: "9", active: true });
    expect(repo.verifyPin({ id: "s2", pin: "1111" })).toBe(false);
    expect(repo.verifyPin({ id: "s2", pin: "7777" })).toBe(true);
  });

  it("requires a PIN for new staff and always keeps one active admin", () => {
    const { repo } = fresh();
    expect(() => repo.upsertStaff({ id: "s9", name: "New", role: "cashier", pin: "", phone: "", active: true })).toThrow(/PIN/);
    expect(() => repo.upsertStaff({ id: "s1", name: "Asha", role: "admin", pin: "", phone: "", active: false })).toThrow(/Admin/);
    expect(repo.verifyPin({ id: "s1", pin: "1234" })).toBe(true); // rolled back
  });
});

describe("paying bills", () => {
  it("assigns gapless numbers per financial year", () => {
    const { repo } = fresh();
    const a = repo.payBill(payment("b1"));
    const b = repo.payBill(payment("b2"));
    const c = repo.payBill(payment("b3", { fy: "2027-28" }));
    expect(a.billNo).toBe("SSB/2026-27/000001");
    expect(b.billNo).toBe("SSB/2026-27/000002");
    expect(c.billNo).toBe("SSB/2027-28/000001"); // new year restarts
    expect(a.status).toBe("paid");
    expect(a.totalPaise).toBe(70400);
    expect(a.lines).toHaveLength(2);
  });

  it("does not issue a second number when the same bill is paid twice", () => {
    const { repo } = fresh();
    const a = repo.payBill(payment("b1"));
    const again = repo.payBill(payment("b1"));
    expect(again.billNo).toBe(a.billNo);
    expect(repo.loadState(ctx).nextSeq).toBe(2);
  });

  it("settles a held bill in place", () => {
    const { repo } = fresh();
    const open = { id: "b1", orderType: "dine_in", tableId: "t1", lines: payment("b1").lines, createdAt: "2026-10-21T10:00:00.000Z", createdBy: "s2" };
    repo.saveOpenBill(open);
    expect(repo.loadState(ctx).openBills).toHaveLength(1);
    repo.payBill(payment("b1"));
    const s = repo.loadState(ctx);
    expect(s.openBills).toHaveLength(0);
    expect(s.paidBills).toHaveLength(1);
  });

  it("rejects bad input and writes nothing", () => {
    const { repo } = fresh();
    expect(() => repo.payBill(payment("b1", { lines: [] }))).toThrow(/empty/);
    expect(() => repo.payBill(payment("b1", { method: "bitcoin" }))).toThrow(/method/);
    expect(() => repo.payBill(payment("b1", { totals: { subtotal: 1, serviceCharge: 0, cgst: 0, sgst: 0, roundOff: 0, total: 100 } }))).toThrow(/subtotal/);
    expect(() => repo.payBill(payment("b1", { totals: { ...payment("x").totals, total: 70450 } }))).toThrow(/whole rupees/);
    expect(repo.loadState(ctx).paidBills).toHaveLength(0);
    expect(repo.loadState(ctx).nextSeq).toBe(1); // failed attempts burn no numbers
  });

  it("snapshots item names and prices, so later menu edits never change a bill", () => {
    const { repo } = fresh();
    repo.payBill(payment("b1"));
    repo.upsertMenuItem({ id: "m1", categoryId: "c1", name: "Paneer Deluxe", shortCode: "PAN", pricePaise: 99900, veg: true, available: true, deleted: false });
    const bill = repo.loadState(ctx).paidBills[0];
    expect(bill.lines[0].name).toBe("Paneer");
    expect(bill.lines[0].unitPricePaise).toBe(26000);
  });
});

describe("daily summary", () => {
  it("tracks sales, payment split and tax as bills are paid and cancelled", () => {
    const { repo } = fresh();
    repo.payBill(payment("b1", { method: "upi" }));
    repo.payBill(payment("b2", { method: "cash" }));
    let d = repo.getDailySummary("2026-10-21");
    expect(d).toMatchObject({ sales_paise: 140800, bills: 2, cancelled: 0, upi_paise: 70400, cash_paise: 70400, card_paise: 0, tax_paise: 6700 });

    repo.cancelBill({ id: "b2", reason: "Wrong items punched", by: "s1", at: "2026-10-21T11:00:00.000Z" });
    d = repo.getDailySummary("2026-10-21");
    expect(d).toMatchObject({ sales_paise: 70400, bills: 1, cancelled: 1, cash_paise: 0, tax_paise: 3350 });
  });

  it("keeps cancelled bills (and their numbers) for audit", () => {
    const { repo } = fresh();
    const bill = repo.payBill(payment("b1"));
    const c = repo.cancelBill({ id: "b1", reason: "Duplicate", by: "s1", at: "2026-10-21T11:00:00.000Z" });
    expect(c.status).toBe("cancelled");
    expect(c.billNo).toBe(bill.billNo);
    expect(c.cancelReason).toBe("Duplicate");
    expect(repo.payBill(payment("b2")).billNo).toBe("SSB/2026-27/000002"); // number 1 is never reused
  });

  it("requires a reason and refuses to cancel an unpaid bill", () => {
    const { repo } = fresh();
    repo.payBill(payment("b1"));
    expect(() => repo.cancelBill({ id: "b1", reason: "  ", by: "s1", at: "x" })).toThrow(/reason/);
    repo.saveOpenBill({ id: "o1", orderType: "takeaway", tableId: null, lines: [line("m2", "Naan", 5000, 1)], createdAt: "2026-10-21T10:00:00.000Z", createdBy: "s2" });
    expect(() => repo.cancelBill({ id: "o1", reason: "x", by: "s1", at: "x" })).toThrow(/paid/);
  });

  it("excludes today from history and returns earlier days", () => {
    const { repo } = fresh();
    repo.payBill(payment("b1"));
    repo.payBill(payment("b2", { paidDate: "2026-10-20", paidAt: "2026-10-20T10:30:00.000Z" }));
    const h = repo.loadState(ctx).history;
    expect(h.map((x: { date: string }) => x.date)).toEqual(["2026-10-20", "2026-10-21"]);
    expect(repo.loadState({ ...ctx, today: "2026-10-21" }).history.map((x: { date: string }) => x.date)).toEqual(["2026-10-20"]);
  });
});

describe("open (held) bills", () => {
  const open = (id: string, qty = 1) => ({
    id, orderType: "dine_in", tableId: "t2", lines: [line("m1", "Paneer", 26000, qty)], createdAt: "2026-10-21T10:00:00.000Z", createdBy: "s2",
  });

  it("saves, updates and removes held bills", () => {
    const { repo } = fresh();
    repo.saveOpenBill(open("o1", 1));
    repo.saveOpenBill(open("o1", 3));
    let s = repo.loadState(ctx);
    expect(s.openBills).toHaveLength(1);
    expect(s.openBills[0].lines[0].qty).toBe(3);
    repo.saveOpenBill({ ...open("o1"), lines: [] }); // emptied
    s = repo.loadState(ctx);
    expect(s.openBills).toHaveLength(0);
  });

  it("never overwrites or deletes a paid bill", () => {
    const { repo } = fresh();
    repo.payBill(payment("b1"));
    expect(repo.saveOpenBill({ ...open("b1", 9) })).toBe(false);
    repo.deleteOpenBill("b1");
    const bill = repo.loadState(ctx).paidBills[0];
    expect(bill.lines[0].qty).toBe(2);
  });

  it("keeps kitchen-ticket progress", () => {
    const { repo } = fresh();
    repo.saveOpenBill({ ...open("o1", 4), lines: [{ ...line("m1", "Paneer", 26000, 4), kotQty: 3 }] });
    expect(repo.loadState(ctx).openBills[0].lines[0].kotQty).toBe(3);
  });
});

describe("settings and menu", () => {
  it("persists tax, profile, menu and categories", () => {
    const { repo } = fresh();
    repo.setTax({ gstRateBp: 1800, pricesIncludeTax: true, serviceChargeEnabled: true, serviceChargeBp: 1000 });
    repo.setProfile({ ...profile, name: "Renamed", paperWidthMm: 58 });
    repo.upsertCategory({ id: "c2", name: "Drinks", sortOrder: 2 });
    repo.upsertMenuItem({ id: "m3", categoryId: "c2", name: "Lassi", shortCode: "LAS", pricePaise: 9000, veg: true, available: false, deleted: false });
    repo.upsertMenuItem({ id: "m2", categoryId: "c1", name: "Naan", shortCode: "NAN", pricePaise: 5000, veg: true, available: true, deleted: true });
    const s = repo.loadState(ctx);
    expect(s.tax).toEqual({ gstRateBp: 1800, pricesIncludeTax: true, serviceChargeEnabled: true, serviceChargeBp: 1000 });
    expect(s.profile.name).toBe("Renamed");
    expect(s.profile.paperWidthMm).toBe(58);
    expect(s.categories).toHaveLength(2);
    expect(s.menu.find((m: { id: string }) => m.id === "m3")).toMatchObject({ available: false, pricePaise: 9000 });
    expect(s.menu.find((m: { id: string }) => m.id === "m2").deleted).toBe(true);
  });

  it("rejects an out-of-range GST rate and negative prices", () => {
    const { repo } = fresh();
    expect(() => repo.setTax({ ...tax, gstRateBp: 20000 })).toThrow(/GST/);
    expect(() => repo.upsertMenuItem({ id: "m9", categoryId: "c1", name: "X", shortCode: "X", pricePaise: -1, veg: true, available: true, deleted: false })).toThrow();
  });
});

describe("persistence on disk", () => {
  it("survives closing and reopening the database file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssbills-"));
    const file = path.join(dir, "ssbills.db");
    try {
      let db = openDatabase(file);
      let repo = createRepo(db);
      repo.seedDemo(demo());
      repo.payBill(payment("b1"));
      db.close();

      db = openDatabase(file); // reopening must not re-run migrations or lose data
      openDbs.push(db);
      repo = createRepo(db);
      const s = repo.loadState(ctx);
      expect(s.paidBills[0].billNo).toBe("SSB/2026-27/000001");
      expect(s.nextSeq).toBe(2);
      expect(db.prepare("PRAGMA user_version").get().user_version).toBeGreaterThanOrEqual(1);
    } finally {
      for (const d of openDbs.splice(0)) d.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("first-run setup", () => {
  const setup = (over: Record<string, unknown> = {}) => ({
    profile,
    tax,
    admin: { id: "a1", name: "Meera", pin: "2468", phone: "" },
    categories: [{ id: "c1", name: "Starters" }, { id: "c2", name: "Mains" }],
    tableCount: 6,
    ...over,
  });
  const blank = () => {
    const db = openDatabase(":memory:");
    openDbs.push(db);
    return createRepo(db);
  };

  it("creates the restaurant, first admin, categories and tables in one go", () => {
    const repo = blank();
    expect(repo.completeSetup(setup())).toBe(true);
    const s = repo.loadState(ctx);
    expect(s.empty).toBe(false);
    expect(s.staff).toHaveLength(1);
    expect(s.staff[0]).toMatchObject({ name: "Meera", role: "admin", active: true });
    expect(s.categories.map((c: { name: string }) => c.name)).toEqual(["Starters", "Mains"]);
    expect(s.tables.map((t: { label: string }) => t.label)).toEqual(["T1", "T2", "T3", "T4", "T5", "T6"]);
    expect(s.menu).toHaveLength(0);
    expect(repo.verifyPin({ id: "a1", pin: "2468" })).toBe(true);
    expect(repo.verifyPin({ id: "a1", pin: "1234" })).toBe(false);
  });

  it("allows a takeaway-only restaurant with no tables", () => {
    const repo = blank();
    repo.completeSetup(setup({ tableCount: 0 }));
    expect(repo.loadState(ctx).tables).toHaveLength(0);
  });

  it("refuses to run twice", () => {
    const repo = blank();
    repo.completeSetup(setup());
    expect(() => repo.completeSetup(setup())).toThrow(/already set up/);
  });

  it("rejects bad input and leaves the database empty", () => {
    const repo = blank();
    expect(() => repo.completeSetup(setup({ admin: { id: "a1", name: "Meera", pin: "12" } }))).toThrow(/4 digits/);
    expect(() => repo.completeSetup(setup({ profile: { ...profile, name: " " } }))).toThrow(/name/);
    expect(() => repo.completeSetup(setup({ tableCount: 500 }))).toThrow(/Table count/);
    expect(repo.loadState(ctx)).toEqual({ empty: true });
    expect(repo.completeSetup(setup())).toBe(true); // a failed attempt doesn't block a good one
  });
});

describe("tables and categories", () => {
  it("adds, renames and removes tables, but never loses bills made on them", () => {
    const { repo } = fresh();
    repo.upsertTable({ id: "t3", label: "Patio 1", seats: 6, active: true });
    expect(repo.loadState(ctx).tables.find((t: { id: string }) => t.id === "t3")).toMatchObject({ label: "Patio 1", seats: 6, active: true });

    repo.payBill(payment("b1", { tableId: "t1" }));
    repo.upsertTable({ id: "t1", label: "T1", seats: 4, active: false }); // removed from the floor
    const s = repo.loadState(ctx);
    expect(s.tables.find((t: { id: string }) => t.id === "t1").active).toBe(false);
    expect(s.paidBills[0].tableId).toBe("t1"); // the old bill still points at it
  });

  it("refuses duplicate labels and removing a table that has an open bill", () => {
    const { repo } = fresh();
    expect(() => repo.upsertTable({ id: "t9", label: "t1", seats: 2, active: true })).toThrow(/already called/);
    repo.saveOpenBill({ id: "o1", orderType: "dine_in", tableId: "t2", lines: [line("m1", "Paneer", 26000, 1)], createdAt: "2026-10-21T10:00:00.000Z", createdBy: "s2" });
    expect(() => repo.upsertTable({ id: "t2", label: "T2", seats: 2, active: false })).toThrow(/open bill/);
    expect(() => repo.upsertTable({ id: "t1", label: "T1", seats: 0, active: true })).toThrow(/Seats/);
  });

  it("lets a removed table's label be reused", () => {
    const { repo } = fresh();
    repo.upsertTable({ id: "t1", label: "T1", seats: 4, active: false });
    expect(() => repo.upsertTable({ id: "t10", label: "T1", seats: 4, active: true })).not.toThrow();
  });

  it("renames and hides categories without touching their items", () => {
    const { repo } = fresh();
    repo.upsertCategory({ id: "c1", name: "Main Course", sortOrder: 1, active: true });
    repo.upsertCategory({ id: "c1", name: "Main Course", sortOrder: 1, active: false });
    const s = repo.loadState(ctx);
    expect(s.categories[0]).toMatchObject({ name: "Main Course", active: false });
    expect(s.menu).toHaveLength(2);
    expect(() => repo.upsertCategory({ id: "c1", name: "  ", sortOrder: 1, active: true })).toThrow(/name/);
  });
});

describe("upgrading an existing database", () => {
  it("applies new migrations without losing data", () => {
    const { MIGRATIONS } = require("./schema.cjs");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssbills-up-"));
    const file = path.join(dir, "old.db");
    try {
      const { DatabaseSync } = require("node:sqlite");
      const old = new DatabaseSync(file);
      old.exec(MIGRATIONS[0]); // what a released v1 app created
      old.exec("PRAGMA user_version = 1");
      old.exec("INSERT INTO categories (id, name, sort_order) VALUES ('c1','Mains',1)");
      old.exec("INSERT INTO tables (id, label, seats) VALUES ('t1','T1',4)");
      old.close();

      const db = openDatabase(file);
      openDbs.push(db);
      expect(db.prepare("PRAGMA user_version").get().user_version).toBe(MIGRATIONS.length);
      expect(db.prepare("SELECT active FROM tables WHERE id='t1'").get().active).toBe(1);
      expect(db.prepare("SELECT active FROM categories WHERE id='c1'").get().active).toBe(1);
    } finally {
      for (const d of openDbs.splice(0)) d.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("updates and the database", () => {
  const { MIGRATIONS } = require("./schema.cjs");
  const { DatabaseSync } = require("node:sqlite");
  const tmp = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssbills-upd-"));
    return { dir, file: path.join(dir, "ssbills.db"), done: () => fs.rmSync(dir, { recursive: true, force: true }) };
  };

  it("keeps a copy of an existing database before an update changes it", () => {
    const t = tmp();
    try {
      const old = new DatabaseSync(t.file);
      old.exec(MIGRATIONS[0]);
      old.exec("PRAGMA user_version = 1");
      old.exec("INSERT INTO categories (id, name, sort_order) VALUES ('c1','Mains',1)");
      old.close();
      const db = openDatabase(t.file);
      openDbs.push(db);
      const copy = `${t.file}.before-v2.bak`;
      expect(fs.existsSync(copy)).toBe(true);
      const bak = new DatabaseSync(copy, { readOnly: true });
      expect(bak.prepare("PRAGMA user_version").get().user_version).toBe(1); // exactly as it was
      expect(bak.prepare("SELECT COUNT(*) AS n FROM categories").get().n).toBe(1);
      bak.close();
    } finally {
      for (const d of openDbs.splice(0)) d.close();
      t.done();
    }
  });

  it("makes no copy for a brand-new database or one that is already up to date", () => {
    const t = tmp();
    try {
      openDatabase(t.file).close(); // new
      openDatabase(t.file).close(); // current
      expect(fs.readdirSync(t.dir).filter((f) => f.endsWith(".bak"))).toEqual([]);
    } finally {
      t.done();
    }
  });

  it("refuses a database saved by a newer version, and leaves it untouched", () => {
    const t = tmp();
    try {
      openDatabase(t.file).close();
      const d = new DatabaseSync(t.file);
      d.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
      d.close();
      expect(() => openDatabase(t.file)).toThrow(/newer version of SS Bills/);
      const again = new DatabaseSync(t.file, { readOnly: true });
      expect(again.prepare("PRAGMA user_version").get().user_version).toBe(MIGRATIONS.length + 1);
      again.close();
    } finally {
      t.done();
    }
  });
});

describe("printer settings", () => {
  it("defaults to 'ask every time' and remembers the choice", () => {
    const { repo } = fresh();
    expect(repo.loadState(ctx).printers).toEqual({ receipt: null, kot: null });
    repo.setPrinters({ receipt: "XP-80C", kot: "Kitchen XP-58" });
    expect(repo.loadState(ctx).printers).toEqual({ receipt: "XP-80C", kot: "Kitchen XP-58" });
    repo.setPrinters({ receipt: null, kot: "Kitchen XP-58" });
    expect(repo.loadState(ctx).printers).toEqual({ receipt: null, kot: "Kitchen XP-58" });
  });

  it("rejects malformed settings", () => {
    const { repo } = fresh();
    expect(() => repo.setPrinters({ receipt: 5, kot: null })).toThrow(/printer/);
    expect(() => repo.setPrinters({ receipt: "", kot: null })).toThrow(/printer/);
    expect(() => repo.setPrinters({ receipt: "x".repeat(300), kot: null })).toThrow(/printer/);
    expect(() => repo.setPrinters(null)).toThrow(/printer/);
  });
});

describe("PIN lockout", () => {
  function withClock() {
    let t = Date.parse("2026-10-21T10:00:00Z");
    const db = openDatabase(":memory:");
    openDbs.push(db);
    const repo = createRepo(db, { now: () => t });
    repo.seedDemo(demo());
    return { repo, advance: (ms: number) => (t += ms) };
  }
  const bad = (repo: ReturnType<typeof createRepo>, id = "s2") => repo.verifyPin({ id, pin: "0000" });

  it("locks a user for a minute after 5 wrong PINs, even for the right PIN", () => {
    const { repo, advance } = withClock();
    for (let i = 0; i < 5; i++) expect(bad(repo)).toBe(false);
    expect(() => repo.verifyPin({ id: "s2", pin: "1111" })).toThrow(/Try again in 1 minute$/);
    advance(61_000);
    expect(repo.verifyPin({ id: "s2", pin: "1111" })).toBe(true);
  });

  it("locks longer after each further failure, up to 15 minutes", () => {
    const { repo, advance } = withClock();
    for (let i = 0; i < 5; i++) bad(repo);
    advance(61_000);
    bad(repo); // 6th failure: 2 minutes
    expect(() => bad(repo)).toThrow(/2 minutes/);
    advance(121_000);
    bad(repo); // 7th: 4
    advance(4 * 60_000 + 1000);
    bad(repo); // 8th: 8
    advance(8 * 60_000 + 1000);
    bad(repo); // 9th: 15 (capped)
    expect(() => bad(repo)).toThrow(/15 minutes/);
    advance(15 * 60_000 + 1000);
    bad(repo); // 10th: still 15
    expect(() => bad(repo)).toThrow(/15 minutes/);
  });

  it("a correct PIN clears the count", () => {
    const { repo } = withClock();
    for (let i = 0; i < 4; i++) bad(repo);
    expect(repo.verifyPin({ id: "s2", pin: "1111" })).toBe(true);
    for (let i = 0; i < 4; i++) bad(repo); // would be locked if the count had not been cleared
    expect(repo.verifyPin({ id: "s2", pin: "1111" })).toBe(true);
  });

  it("locks per user, not for everyone", () => {
    const { repo } = withClock();
    for (let i = 0; i < 5; i++) bad(repo, "s2");
    expect(() => repo.verifyPin({ id: "s2", pin: "1111" })).toThrow(/Too many/);
    expect(repo.verifyPin({ id: "s1", pin: "1234" })).toBe(true);
  });

  it("survives a restart (the count is saved)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssb-pin-"));
    tmpDirs.push(dir);
    const file = path.join(dir, "t.db");
    const t = Date.parse("2026-10-21T10:00:00Z");
    let db = openDatabase(file);
    let repo = createRepo(db, { now: () => t });
    repo.seedDemo(demo());
    for (let i = 0; i < 5; i++) bad(repo);
    db.close();
    db = openDatabase(file);
    repo = createRepo(db, { now: () => t });
    openDbs.push(db);
    expect(() => repo.verifyPin({ id: "s2", pin: "1111" })).toThrow(/Too many/);
  });

  it("does not track unknown user ids", () => {
    const { repo } = withClock();
    for (let i = 0; i < 10; i++) expect(repo.verifyPin({ id: "ghost", pin: "1" })).toBe(false);
    expect(repo.getMeta("pin_fail_ghost")).toBeNull();
  });
});

describe("summaries for the licence sync", () => {
  it("returns daily totals from a date on, with each day's best-selling item", () => {
    const { repo } = fresh();
    repo.payBill(payment("b1")); // 2 Paneer + 3 Naan on 2026-10-21
    repo.payBill(payment("b2", { lines: [line("m2", "Naan", 5000, 4)], totals: { subtotal: 20000, serviceCharge: 0, cgst: 500, sgst: 500, roundOff: 0, total: 21000 } }));
    repo.payBill(payment("b3", { paidDate: "2026-10-22", paidAt: "2026-10-22T10:00:00.000Z" }));
    const all = repo.summariesSince("2000-01-01");
    expect(all.map((d: { date: string }) => d.date)).toEqual(["2026-10-21", "2026-10-22"]);
    expect(all[0]).toMatchObject({ bills: 2, salesPaise: 91400, topItemName: "Naan", topItemQty: 7 });
    expect(all[1]).toMatchObject({ bills: 1, topItemName: "Naan", topItemQty: 3 });
    expect(repo.summariesSince("2026-10-22")).toHaveLength(1);
    expect(repo.summariesSince("2026-10-23")).toEqual([]);
  });

  it("has no top item on a day with only cancelled bills, and counts the cancellation", () => {
    const { repo } = fresh();
    repo.payBill(payment("b1"));
    repo.cancelBill({ id: "b1", reason: "Duplicate", by: "s1", at: "2026-10-21T11:00:00.000Z" });
    expect(repo.summariesSince("2026-10-21")).toEqual([
      expect.objectContaining({ bills: 0, cancelled: 1, salesPaise: 0, topItemName: null, topItemQty: null }),
    ]);
  });

  it("the meta store round-trips and deletes", () => {
    const { repo } = fresh();
    expect(repo.getMeta("x")).toBeNull();
    repo.setMeta("x", 5);
    expect(repo.getMeta("x")).toBe("5");
    repo.setMeta("x", null);
    expect(repo.getMeta("x")).toBeNull();
  });
});
