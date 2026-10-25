import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { openDatabase, createRepo } = require("./db/index.cjs");
const { createMenuService } = require("./menu-service.cjs");
const { buildSnapshot } = require("./snapshot.cjs");

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const profile = { name: "Spice Garden", tagline: "", address: "1 Main Rd", phone: "1", gstin: "", fssai: "", hsnSac: "996331", receiptHeader: "x", receiptFooter: "y", showLogo: true, paperWidthMm: 80 };
const tax = { gstRateBp: 500, pricesIncludeTax: false, serviceChargeEnabled: false, serviceChargeBp: 500 };
const seed = () => ({
  profile, tax,
  staff: [{ id: "s1", name: "Asha", role: "admin", pin: "2468", phone: "", active: true }],
  categories: [{ id: "c1", name: "Starters", sortOrder: 1 }],
  menu: [{ id: "m1", categoryId: "c1", name: "Paneer Tikka", shortCode: "PT", pricePaise: 22000, veg: true, available: true, deleted: false }],
  tables: [{ id: "t1", label: "T1", seats: 4 }], openBills: [], paidBills: [], history: [],
});

function setup(opts: { setUp?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssb-menu-svc-"));
  const db = openDatabase(":memory:");
  const repo = createRepo(db);
  if (opts.setUp !== false) repo.seedDemo(seed());
  cleanups.push(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let clock = 1_000_000;
  const license = {
    fetchMenu: vi.fn(async (): Promise<unknown> => ({ found: false })),
    uploadMenu: vi.fn(async () => ({ ok: true, stored: true })),
    getStatus: vi.fn((): Record<string, unknown> => ({ menuSavedAt: "2026-10-25T10:00:00.000Z", menuError: null, enforced: true, activated: true })),
  };
  const dialog = { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() };
  const onMenuChanged = vi.fn();
  const svc = createMenuService({ getRepo: () => repo, getDb: () => db, license, dialog, fs, path, documentsDir: () => dir, onMenuChanged, now: () => clock });
  const file = (name: string, content: string | Buffer) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, content);
    return f;
  };
  return { svc, db, repo, license, dialog, onMenuChanged, dir, file, tick: (ms: number) => (clock += ms) };
}

const HEAD = "Category,Name,Price,Veg,Short code,Available\n";

describe("finding and restoring the cloud copy on a new PC", () => {
  const found = (over: Record<string, unknown> = {}) => {
    const copy = buildSnapshot((() => { const d = openDatabase(":memory:"); createRepo(d).seedDemo(seed()); return d; })());
    return { found: true, snapshot: copy, summary: { restaurantName: "Spice Garden", items: 1, categories: 1, tables: 1, savedAt: "2026-10-22T10:00:00Z" }, ...over };
  };

  it("on a PC that is already set up it does not even ask the server", async () => {
    const { svc, license } = setup();
    expect(await svc.call("findCloudCopy")).toEqual({ found: false, reason: "already-set-up" });
    expect(license.fetchMenu).not.toHaveBeenCalled();
  });

  it("says nothing was found when the cloud has no copy", async () => {
    const { svc } = setup({ setUp: false });
    expect(await svc.call("findCloudCopy")).toEqual({ found: false });
  });

  it("describes a found copy in plain numbers, without handing the copy itself to the screen", async () => {
    const { svc, license } = setup({ setUp: false });
    license.fetchMenu.mockResolvedValue(found());
    const r = await svc.call("findCloudCopy");
    expect(r).toEqual({ found: true, summary: { restaurantName: "Spice Garden", items: 1, categories: 1, tables: 1, savedAt: "2026-10-22T10:00:00Z" } });
    expect(JSON.stringify(r)).not.toContain("Paneer"); // the screen never sees (or sends back) the menu itself
  });

  it("restores the found copy with a new admin, and only once", async () => {
    const { svc, license, db } = setup({ setUp: false });
    license.fetchMenu.mockResolvedValue(found());
    await svc.call("findCloudCopy");
    expect(await svc.call("restoreCloudCopy", { adminName: " Meena ", pin: "9876" })).toEqual({ categories: 1, items: 1, tables: 1 });
    expect(db.prepare("SELECT name, role FROM users").all()).toEqual([{ name: "Meena", role: "admin" }]);
    expect(db.prepare("SELECT name FROM menu_items").all()).toEqual([{ name: "Paneer Tikka" }]);
    await expect(svc.call("restoreCloudCopy", { adminName: "X", pin: "1111" })).rejects.toThrow(/Look for your saved menu again/);
  });

  it("will not restore without first looking, or after the found copy has gone stale", async () => {
    const { svc, license, tick } = setup({ setUp: false });
    await expect(svc.call("restoreCloudCopy", { adminName: "M", pin: "9876" })).rejects.toThrow(/Look for your saved menu again/);
    license.fetchMenu.mockResolvedValue(found());
    await svc.call("findCloudCopy");
    tick(16 * 60_000);
    await expect(svc.call("restoreCloudCopy", { adminName: "M", pin: "9876" })).rejects.toThrow(/Look for your saved menu again/);
  });

  it("ignores any menu the screen tries to send along: only the copy found by the app is used", async () => {
    const { svc, license, db } = setup({ setUp: false });
    license.fetchMenu.mockResolvedValue(found());
    await svc.call("findCloudCopy");
    await svc.call("restoreCloudCopy", { adminName: "M", pin: "9876", snapshot: { evil: true }, menu: [{ name: "Evil" }] });
    expect(db.prepare("SELECT name FROM menu_items").all()).toEqual([{ name: "Paneer Tikka" }]);
  });

  it("a bad admin name or PIN changes nothing and the found copy can still be used", async () => {
    const { svc, license, db } = setup({ setUp: false });
    license.fetchMenu.mockResolvedValue(found());
    await svc.call("findCloudCopy");
    for (const a of [{}, { adminName: "", pin: "1234" }, { adminName: "M", pin: "12" }, { adminName: "M", pin: 1234 }]) {
      await expect(svc.call("restoreCloudCopy", a)).rejects.toThrow();
    }
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get().n).toBe(0);
    expect(await svc.call("restoreCloudCopy", { adminName: "M", pin: "4321" })).toMatchObject({ items: 1 });
  });

  it("passes on a refusal from the server (for example a PC that is not linked)", async () => {
    const { svc, license } = setup({ setUp: false });
    license.fetchMenu.mockRejectedValue(new Error("This PC is not linked to the license. Activate it again"));
    await expect(svc.call("findCloudCopy")).rejects.toThrow(/not linked/);
  });
});

describe("saving to the cloud from the Backup screen", () => {
  it("reports when the menu was last saved, and any problem", async () => {
    const { svc, license } = setup();
    expect(await svc.call("cloudStatus")).toEqual({ savedAt: "2026-10-25T10:00:00.000Z", error: null, enforced: true, activated: true });
    license.getStatus.mockReturnValue({ menuSavedAt: null, menuError: "Could not reach SS Bills", enforced: true, activated: true });
    expect(await svc.call("cloudStatus")).toMatchObject({ savedAt: null, error: "Could not reach SS Bills" });
  });

  it("'Save now' asks the licence service to upload and returns the outcome", async () => {
    const { svc, license } = setup();
    expect(await svc.call("cloudSaveNow")).toMatchObject({ ok: true, savedAt: "2026-10-25T10:00:00.000Z" });
    expect(license.uploadMenu).toHaveBeenCalledTimes(1);
    license.uploadMenu.mockResolvedValue({ ok: false, message: "Could not reach SS Bills" } as never);
    expect(await svc.call("cloudSaveNow")).toMatchObject({ ok: false, message: "Could not reach SS Bills" });
  });

  it("refuses unknown calls", async () => {
    await expect(setup().svc.call("deleteEverything")).rejects.toThrow(/Unknown menu call/);
  });
});

describe("exporting the menu to CSV", () => {
  it("writes the file the user chose in the Save dialog, with .csv added if missing", async () => {
    const { svc, dialog, dir } = setup();
    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: path.join(dir, "mymenu") });
    const r = await svc.call("exportCsv", null);
    expect(r).toEqual({ filePath: path.join(dir, "mymenu.csv"), items: 1 });
    const text = fs.readFileSync(r.filePath, "utf8");
    expect(text.startsWith("﻿Category,Name,Price,Veg,Short code,Available\r\n")).toBe(true);
    expect(text).toContain("Starters,Paneer Tikka,220.00,Veg,PT,Yes");
    expect(dialog.showSaveDialog.mock.calls[0][1].defaultPath).toBe(path.join(dir, "SS-Bills-menu.csv"));
  });

  it("writes nothing when the dialog is cancelled", async () => {
    const { svc, dialog, dir } = setup();
    dialog.showSaveDialog.mockResolvedValue({ canceled: true });
    expect(await svc.call("exportCsv", null)).toEqual({ cancelled: true });
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe("importing a menu from CSV: preview, then apply", () => {
  const pick = (t: ReturnType<typeof setup>, file: string) => t.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [file] });

  it("shows exactly what would change, writes nothing, and hands the screen a token (not the rows)", async () => {
    const t = setup();
    pick(t, t.file("menu.csv", HEAD + "Starters,Paneer Tikka,240,Veg,PT,Yes\nBreads,Naan,40,Veg,,Yes\nBreads,Roti,25,Veg,,No\n"));
    const r = await t.svc.call("importCsvPreview", null);
    expect(r).toMatchObject({ ok: true, fileName: "menu.csv", encoding: "UTF-8", summary: { create: 2, update: 1, unchanged: 0, newCategories: 1 }, newCategories: ["Breads"] });
    expect(r.token).toMatch(/^[0-9a-f]{24}$/);
    expect(r.samples).toEqual(expect.arrayContaining([{ action: "update", category: "Starters", name: "Paneer Tikka", pricePaise: 24000, was: 22000 }, expect.objectContaining({ action: "add", name: "Naan" })]));
    expect(JSON.stringify(r)).not.toContain("rows");
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM menu_items").get().n).toBe(1); // nothing written yet
    expect(t.onMenuChanged).not.toHaveBeenCalled();
  });

  it("applies what was previewed, once, and schedules the cloud save", async () => {
    const t = setup();
    pick(t, t.file("menu.csv", HEAD + "Breads,Naan,40,Veg,,Yes\n"));
    const { token } = await t.svc.call("importCsvPreview", null);
    expect(await t.svc.call("importCsvApply", { token })).toEqual({ created: 1, updated: 0, unchanged: 0, categoriesCreated: 1 });
    expect(t.db.prepare("SELECT name FROM menu_items ORDER BY name").all()).toEqual([{ name: "Naan" }, { name: "Paneer Tikka" }]);
    expect(t.onMenuChanged).toHaveBeenCalledTimes(1);
    await expect(t.svc.call("importCsvApply", { token })).rejects.toThrow(/expired/); // one preview, one import
  });

  it("refuses to apply with a wrong token, no preview, or an old preview", async () => {
    const t = setup();
    await expect(t.svc.call("importCsvApply", { token: "abc" })).rejects.toThrow(/expired/);
    pick(t, t.file("menu.csv", HEAD + "Breads,Naan,40,Veg,,Yes\n"));
    const { token } = await t.svc.call("importCsvPreview", null);
    await expect(t.svc.call("importCsvApply", { token: "0".repeat(24) })).rejects.toThrow(/expired/);
    await expect(t.svc.call("importCsvApply", {})).rejects.toThrow(/expired/);
    t.tick(16 * 60_000);
    await expect(t.svc.call("importCsvApply", { token })).rejects.toThrow(/expired/);
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM menu_items").get().n).toBe(1);
  });

  it("a new preview replaces the old one (an old token stops working)", async () => {
    const t = setup();
    pick(t, t.file("a.csv", HEAD + "Breads,Naan,40,Veg,,Yes\n"));
    const first = await t.svc.call("importCsvPreview", null);
    pick(t, t.file("b.csv", HEAD + "Breads,Roti,25,Veg,,Yes\n"));
    const second = await t.svc.call("importCsvPreview", null);
    await expect(t.svc.call("importCsvApply", { token: first.token })).rejects.toThrow(/expired/);
    await t.svc.call("importCsvApply", { token: second.token });
    expect(t.db.prepare("SELECT name FROM menu_items WHERE name = 'Roti'").all()).toHaveLength(1);
    expect(t.db.prepare("SELECT name FROM menu_items WHERE name = 'Naan'").all()).toHaveLength(0);
  });

  it("ignores any rows the screen tries to send with the token: only the previewed rows are applied", async () => {
    const t = setup();
    pick(t, t.file("menu.csv", HEAD + "Breads,Naan,40,Veg,,Yes\n"));
    const { token } = await t.svc.call("importCsvPreview", null);
    await t.svc.call("importCsvApply", { token, rows: [{ category: "Evil", name: "Evil", pricePaise: 1 }] });
    expect(t.db.prepare("SELECT name FROM menu_items WHERE name = 'Evil'").all()).toHaveLength(0);
    expect(t.db.prepare("SELECT name FROM menu_items WHERE name = 'Naan'").all()).toHaveLength(1);
  });

  it("a file with any bad row is refused whole, with line numbers and no token", async () => {
    const t = setup();
    pick(t, t.file("bad.csv", HEAD + "Breads,Naan,40,Veg,,Yes\nBreads,,10,Veg,,Yes\nBreads,Roti,abc,Veg,,Yes\n"));
    const r = await t.svc.call("importCsvPreview", null);
    expect(r).toMatchObject({ ok: false, fileName: "bad.csv", totalErrors: 2 });
    expect(r.errors.map((e: { line: number }) => e.line)).toEqual([3, 4]);
    expect(r.token).toBeUndefined();
    await expect(t.svc.call("importCsvApply", { token: "x" })).rejects.toThrow(/expired/);
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM menu_items").get().n).toBe(1);
  });

  it("shows at most the first 30 problems but counts them all", async () => {
    const t = setup();
    pick(t, t.file("bad.csv", HEAD + Array.from({ length: 50 }, (_, i) => `A,Item ${i},oops,Veg,,Yes`).join("\n")));
    const r = await t.svc.call("importCsvPreview", null);
    expect(r.errors).toHaveLength(30);
    expect(r.totalErrors).toBe(50);
  });

  it("reads Excel's plain CSV (Windows character set) and UTF-16 files correctly", async () => {
    const t = setup();
    const win = Buffer.concat([Buffer.from(HEAD, "latin1"), Buffer.from([0x44, 0x65, 0x73, 0x73, 0x65, 0x72, 0x74, 0x73, 0x2c, 0x43, 0x72, 0xe8, 0x6d, 0x65, 0x20, 0x42, 0x72, 0xfb, 0x6c, 0xe9, 0x65, 0x2c, 0x31, 0x35, 0x30, 0x2c, 0x56, 0x65, 0x67, 0x2c, 0x2c, 0x59, 0x65, 0x73, 0x0a])]);
    pick(t, t.file("excel.csv", win));
    const r = await t.svc.call("importCsvPreview", null);
    expect(r).toMatchObject({ ok: true, encoding: "Windows-1252" });
    await t.svc.call("importCsvApply", { token: r.token });
    expect(t.db.prepare("SELECT name FROM menu_items WHERE name LIKE 'Cr%'").all()).toEqual([{ name: "Crème Brûlée" }]);

    pick(t, t.file("unicode.txt", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(HEAD.replace(/,/g, "\t") + "Drinks\tचाय\t15\tVeg\t\tYes\n", "utf16le")])));
    const u = await t.svc.call("importCsvPreview", null);
    expect(u).toMatchObject({ ok: true, encoding: "UTF-16" });
    await t.svc.call("importCsvApply", { token: u.token });
    expect(t.db.prepare("SELECT name FROM menu_items WHERE name = 'चाय'").all()).toHaveLength(1);
  });

  it("lists columns it did not use, and refuses a huge file without reading it all", async () => {
    const t = setup();
    pick(t, t.file("extra.csv", "Name,Price,Chef notes\nTea,15,hot\n"));
    expect((await t.svc.call("importCsvPreview", null)).ignoredColumns).toEqual(["Chef notes"]);
    pick(t, t.file("huge.csv", Buffer.alloc(2 * 1024 * 1024 + 10, 97)));
    expect(await t.svc.call("importCsvPreview", null)).toMatchObject({ ok: false, totalErrors: 1 });
  });

  it("does nothing when the Open dialog is cancelled", async () => {
    const t = setup();
    t.dialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await t.svc.call("importCsvPreview", null)).toEqual({ cancelled: true });
  });

  it("importing the exported file again changes nothing", async () => {
    const t = setup();
    t.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: path.join(t.dir, "out.csv") });
    const exported = await t.svc.call("exportCsv", null);
    pick(t, exported.filePath);
    const r = await t.svc.call("importCsvPreview", null);
    expect(r.summary).toEqual({ create: 0, update: 0, unchanged: 1, newCategories: 0 });
  });
});
