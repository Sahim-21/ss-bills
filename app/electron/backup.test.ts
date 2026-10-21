import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createBackupService } = require("./backup.cjs");
const { openDatabase, createRepo } = require("./db/index.cjs");
const { MIGRATIONS } = require("./db/schema.cjs");
const { DatabaseSync } = require("node:sqlite");

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

const profile = { name: "Test Cafe", tagline: "", address: "1 Main Rd", phone: "1", gstin: "", fssai: "", hsnSac: "996331", receiptHeader: "", receiptFooter: "", showLogo: true, paperWidthMm: 80 };
const tax = { gstRateBp: 500, pricesIncludeTax: false, serviceChargeEnabled: false, serviceChargeBp: 500 };
const seed = () => ({
  profile, tax, staff: [{ id: "s1", name: "Asha", role: "admin", pin: "1234", phone: "", active: true }],
  categories: [{ id: "c1", name: "Mains", sortOrder: 1 }],
  menu: [{ id: "m1", categoryId: "c1", name: "Paneer", shortCode: "PAN", pricePaise: 26000, veg: true, available: true, deleted: false }],
  tables: [{ id: "t1", label: "T1", seats: 4 }], openBills: [], paidBills: [], history: [],
});
const pay = (id: string) => ({
  id, fy: "2026-27", orderType: "dine_in", tableId: "t1", method: "cash", createdBy: "s1", createdAt: "2026-10-21T10:00:00.000Z",
  paidAt: "2026-10-21T10:30:00.000Z", paidDate: "2026-10-21",
  lines: [{ itemId: "m1", name: "Paneer", unitPricePaise: 26000, veg: true, qty: 1, kotQty: 0 }],
  totals: { subtotal: 26000, serviceCharge: 0, cgst: 650, sgst: 650, roundOff: 0, total: 27300 },
});

function setup(opts: { now?: () => Date } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ssb-backup-"));
  cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const live = path.join(root, "live", "ssbills.db");
  fs.mkdirSync(path.dirname(live));
  let db = openDatabase(live);
  cleanup.push(() => {
    try {
      db?.close();
    } catch {
      /* already closed */
    }
  });
  const repo = createRepo(db);
  repo.seedDemo(seed());
  const svc = createBackupService({ getDb: () => db, dir: () => path.join(root, "backups"), userVersion: MIGRATIONS.length, now: opts.now });
  return { root, live, svc, repo, getDb: () => db, closeDb: () => { db.close(); db = null as never; } };
}

const billCount = (file: string) => {
  const d = new DatabaseSync(file, { readOnly: true });
  try {
    return d.prepare("SELECT COUNT(*) AS n FROM bills").get().n;
  } finally {
    d.close();
  }
};

describe("making backups", () => {
  it("snapshots the live database while the app is using it", () => {
    const { svc, repo, root } = setup();
    repo.payBill(pay("b1"));
    const name = svc.backupNow("manual");
    expect(name).toMatch(/^ssbills_\d{4}-\d{2}-\d{2}_\d{6}\.db$/);
    expect(billCount(path.join(root, "backups", name))).toBe(1);
    repo.payBill(pay("b2")); // later bills are not in the earlier snapshot
    expect(billCount(path.join(root, "backups", name))).toBe(1);
  });

  it("creates the folder, and two backups in the same second do not collide", () => {
    const fixed = new Date(2026, 9, 21, 23, 45, 0);
    const { svc } = setup({ now: () => fixed });
    const a = svc.backupNow("manual");
    const b = svc.backupNow("manual");
    expect(a).not.toBe(b);
    expect(svc.list().map((f: { file: string }) => f.file).sort()).toEqual([a, b].sort());
  });

  it("lists backups newest first with their kind", () => {
    let t = new Date(2026, 9, 21, 10, 0, 0);
    const { svc, root } = setup({ now: () => t });
    const m = svc.backupNow("manual");
    t = new Date(2026, 9, 22, 10, 0, 0);
    const a = svc.backupNow("auto");
    fs.utimesSync(path.join(root, "backups", m), new Date(2026, 9, 21, 10), new Date(2026, 9, 21, 10));
    fs.utimesSync(path.join(root, "backups", a), new Date(2026, 9, 22, 10), new Date(2026, 9, 22, 10));
    expect(svc.list().map((f: { file: string; kind: string }) => [f.file, f.kind])).toEqual([[a, "auto"], [m, "manual"]]);
    fs.writeFileSync(path.join(root, "backups", "notes.txt"), "x"); // unrelated files are ignored
    expect(svc.list()).toHaveLength(2);
  });
});

describe("automatic backups", () => {
  it("runs once a day, not on every check", () => {
    let t = new Date(2026, 9, 21, 9, 0, 0);
    const { svc, root } = setup({ now: () => t });
    const first = svc.autoIfDue();
    expect(first).toMatch(/_auto\.db$/);
    fs.utimesSync(path.join(root, "backups", first), t, t);
    t = new Date(2026, 9, 21, 20, 0, 0);
    expect(svc.autoIfDue()).toBeNull();
    t = new Date(2026, 9, 22, 9, 30, 0);
    expect(svc.autoIfDue()).toMatch(/_auto\.db$/);
  });

  it("keeps the newest 30 automatic backups and never deletes manual ones", () => {
    let day = 1;
    const { svc, root } = setup({ now: () => new Date(2026, 0, day, 12, 0, 0) });
    const manual = svc.backupNow("manual");
    const dir = path.join(root, "backups");
    for (day = 1; day <= 35; day++) {
      const f = svc.backupNow("auto");
      const when = new Date(2026, 0, day, 12);
      fs.utimesSync(path.join(dir, f), when, when);
    }
    const files = svc.list();
    expect(files.filter((f: { kind: string }) => f.kind === "auto")).toHaveLength(30);
    expect(files.some((f: { file: string }) => f.file === manual)).toBe(true);
    // the oldest automatic ones are the ones that went
    const oldest = Math.min(...files.filter((f: { kind: string }) => f.kind === "auto").map((f: { at: number }) => f.at));
    expect(new Date(oldest).getDate()).toBe(6);
  });
});

describe("validating a backup file", () => {
  it("accepts a real backup", () => {
    const { svc } = setup();
    const name = svc.backupNow("manual");
    expect(svc.validate(svc.resolveName(name))).toEqual({ ok: true });
  });

  it("rejects garbage, an empty database, and a non-database file", () => {
    const { svc, root } = setup();
    const junk = path.join(root, "junk.db");
    fs.writeFileSync(junk, "this is not a database at all");
    expect(svc.validate(junk)).toMatchObject({ ok: false, error: expect.stringMatching(/not an SS Bills backup/) });
    const empty = path.join(root, "empty.db");
    new DatabaseSync(empty).close();
    expect(svc.validate(empty)).toMatchObject({ ok: false });
    expect(svc.validate(path.join(root, "missing.db"))).toMatchObject({ ok: false });
  });

  it("rejects a backup made by a newer version of the app", () => {
    const { svc } = setup();
    const name = svc.backupNow("manual");
    const file = svc.resolveName(name);
    const d = new DatabaseSync(file);
    d.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    d.close();
    expect(svc.validate(file)).toMatchObject({ ok: false, error: expect.stringMatching(/newer version/) });
  });

  it("rejects a truncated (damaged) file", () => {
    const { svc, root } = setup();
    const file = svc.resolveName(svc.backupNow("manual"));
    const bytes = fs.readFileSync(file);
    const bad = path.join(root, "truncated.db");
    fs.writeFileSync(bad, bytes.subarray(0, Math.floor(bytes.length / 2)));
    expect(svc.validate(bad).ok).toBe(false);
  });
});

describe("restoring", () => {
  it("saves today's data first, then replaces the live file with the backup", () => {
    const { svc, repo, live, root, closeDb } = setup();
    repo.payBill(pay("b1"));
    const early = svc.backupNow("manual"); // 1 bill
    repo.payBill(pay("b2")); // made after the backup: 2 bills now
    const source = svc.resolveName(early);

    const { savedAs } = svc.prepareRestore(source);
    expect(billCount(path.join(root, "backups", savedAs))).toBe(2); // nothing is lost
    expect(savedAs).toMatch(/_pre-restore\.db$/);

    closeDb();
    svc.swap(source, live);
    const restored = openDatabase(live);
    cleanup.push(() => restored.close());
    expect(restored.prepare("SELECT COUNT(*) AS n FROM bills").get().n).toBe(1);
    expect(fs.existsSync(`${live}.restoring`)).toBe(false);
  });

  it("refuses a bad file and leaves the live database alone", () => {
    const { svc, repo, root, live } = setup();
    repo.payBill(pay("b1"));
    const junk = path.join(root, "junk.db");
    fs.writeFileSync(junk, "nope");
    expect(() => svc.prepareRestore(junk)).toThrow(/not an SS Bills backup/);
    expect(billCount(live)).toBe(1);
    expect(svc.list()).toEqual([]); // not even a pre-restore copy was made
  });

  it("removes stale WAL files so old pages are not replayed onto the restored file", () => {
    const { svc, live, closeDb } = setup();
    const source = svc.resolveName(svc.backupNow("manual"));
    closeDb();
    fs.writeFileSync(`${live}-wal`, "stale");
    fs.writeFileSync(`${live}-shm`, "stale");
    svc.swap(source, live);
    expect(fs.existsSync(`${live}-wal`)).toBe(false);
    expect(fs.existsSync(`${live}-shm`)).toBe(false);
  });
});

describe("names from the UI", () => {
  it("only lets the UI name files that match the backup pattern and exist in the folder", () => {
    const { svc, root } = setup();
    const name = svc.backupNow("manual");
    expect(svc.resolveName(name)).toBe(path.join(root, "backups", name));
    for (const bad of ["../live/ssbills.db", "..\\live\\ssbills.db", "C:\\Windows\\win.ini", "ssbills_x.db/../../x", "other.db", "ssbills_nope.db", "", null, 5, undefined, "ssbills_" + "a".repeat(70) + ".db"]) {
      expect(svc.resolveName(bad)).toBeNull();
    }
  });
});
