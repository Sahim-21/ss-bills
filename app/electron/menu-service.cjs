// Everything the app does with the menu beyond ordinary editing (docs/DECISIONS.md D-043, D-044), behind one door for the main process:
//   - find the menu copy saved in SS Bills' cloud and restore it onto a brand-new PC;
//   - save the current menu to the cloud now, and report when it was last saved;
//   - export the menu to a CSV file, and import one (preview first, then apply).
// The screen never supplies file paths, rows of data or a copy to restore: files are chosen in system dialogs opened here, and what
// is previewed is held here and applied by a token. So a modified screen cannot make the app write other data than what the user saw.
const crypto = require("node:crypto");
const { decodeCsvBuffer, readMenuCsv, toCsv, LIMITS } = require("./menu-csv.cjs");

const KEEP_MS = 15 * 60_000; // a preview or a found copy is forgotten after 15 minutes

/**
 * @param o.getRepo       () => the repository (it changes after a restore of a backup)
 * @param o.getDb         () => the open database (for "is this PC set up yet")
 * @param o.license       the licence service (fetchMenu, uploadMenu, getStatus)
 * @param o.dialog        Electron's dialog (showOpenDialog / showSaveDialog), injectable
 * @param o.fs, o.path    node:fs and node:path, injectable
 * @param o.documentsDir  where the save dialog starts
 * @param o.onMenuChanged () => void, called after the menu changes (schedules the cloud save)
 */
function createMenuService(o) {
  const now = o.now ?? (() => Date.now());
  let pendingRestore = null;
  let pendingImport = null;

  const isSetUp = () => o.getDb().prepare("SELECT COUNT(*) AS n FROM users").get().n > 0;
  const fresh = (p) => p && now() - p.at < KEEP_MS;

  async function findCloudCopy() {
    pendingRestore = null;
    if (isSetUp()) return { found: false, reason: "already-set-up" };
    const r = await o.license.fetchMenu(); // throws a plain-language Error when it cannot
    if (!r.found) return { found: false };
    pendingRestore = { snapshot: r.snapshot, at: now() };
    return { found: true, summary: r.summary };
  }

  function restoreCloudCopy(arg) {
    if (!fresh(pendingRestore)) throw new Error("Look for your saved menu again, then restore it");
    const name = typeof arg?.adminName === "string" ? arg.adminName.trim() : "";
    const pin = typeof arg?.pin === "string" ? arg.pin : "";
    const result = o.getRepo().restoreFromSnapshot({ snapshot: pendingRestore.snapshot, admin: { id: `u${crypto.randomBytes(6).toString("hex")}`, name, pin } });
    pendingRestore = null;
    return result;
  }

  async function exportCsv(win) {
    const cat = o.getRepo().loadCatalog();
    const { canceled, filePath } = await o.dialog.showSaveDialog(win, {
      title: "Save the menu as a CSV file",
      defaultPath: o.path.join(o.documentsDir(), "SS-Bills-menu.csv"),
      filters: [{ name: "CSV (opens in Excel)", extensions: ["csv"] }],
    });
    if (canceled || !filePath) return { cancelled: true };
    const target = filePath.toLowerCase().endsWith(".csv") ? filePath : `${filePath}.csv`;
    o.fs.writeFileSync(target, toCsv(cat.categories, cat.items), "utf8");
    return { filePath: target, items: cat.items.filter((i) => cat.categories.some((c) => c.id === i.categoryId)).length };
  }

  async function importCsvPreview(win) {
    pendingImport = null;
    const { canceled, filePaths } = await o.dialog.showOpenDialog(win, {
      title: "Choose a menu CSV file",
      properties: ["openFile"],
      filters: [{ name: "CSV or text", extensions: ["csv", "txt"] }],
    });
    if (canceled || !filePaths?.[0]) return { cancelled: true };
    const file = filePaths[0];
    if (o.fs.statSync(file).size > LIMITS.bytes) return { ok: false, fileName: o.path.basename(file), errors: [{ line: 0, message: "The file is larger than 2 MB. A menu should be far smaller" }], totalErrors: 1 };
    const { text, encoding } = decodeCsvBuffer(o.fs.readFileSync(file));
    const read = readMenuCsv(text);
    const fileName = o.path.basename(file);
    if (read.errors.length > 0) return { ok: false, fileName, errors: read.errors.slice(0, 30), totalErrors: read.errors.length };
    const plan = o.getRepo().previewMenuImport(read.rows);
    if (!plan.ok) return { ok: false, fileName, errors: [{ line: 0, message: plan.error }], totalErrors: 1 };
    const token = crypto.randomBytes(12).toString("hex");
    pendingImport = { token, rows: read.rows, at: now() };
    return {
      ok: true,
      token,
      fileName,
      encoding,
      ignoredColumns: read.ignoredColumns,
      summary: { create: plan.creates.length, update: plan.updates.length, unchanged: plan.unchanged, newCategories: plan.newCategories.length },
      newCategories: plan.newCategories.map((c) => c.name).slice(0, 20),
      samples: [
        ...plan.creates.slice(0, 6).map((c) => ({ action: "add", category: c.category, name: c.name, pricePaise: c.pricePaise })),
        ...plan.updates.slice(0, 6).map((u) => ({ action: "update", category: u.category, name: u.name, pricePaise: u.patch.pricePaise ?? u.before.pricePaise, was: u.before.pricePaise })),
      ],
    };
  }

  function importCsvApply(arg) {
    if (!fresh(pendingImport) || typeof arg?.token !== "string" || arg.token !== pendingImport.token) {
      throw new Error("This import has expired. Choose the file again");
    }
    const rows = pendingImport.rows;
    pendingImport = null; // one preview, one import
    const result = o.getRepo().importMenuRows(rows);
    o.onMenuChanged();
    return result;
  }

  async function call(name, arg, win) {
    switch (name) {
      case "findCloudCopy":
        return findCloudCopy();
      case "restoreCloudCopy":
        return restoreCloudCopy(arg);
      case "cloudStatus": {
        const s = o.license.getStatus();
        return { savedAt: s.menuSavedAt ?? null, error: s.menuError ?? null, enforced: s.enforced !== false, activated: !!s.activated };
      }
      case "cloudSaveNow": {
        const r = await o.license.uploadMenu();
        const s = o.license.getStatus();
        return { ok: r.ok, message: r.message ?? null, unchanged: !!r.unchanged, savedAt: s.menuSavedAt ?? null, error: s.menuError ?? null };
      }
      case "exportCsv":
        return exportCsv(win);
      case "importCsvPreview":
        return importCsvPreview(win);
      case "importCsvApply":
        return importCsvApply(arg);
      default:
        throw new Error(`Unknown menu call: ${name}`);
    }
  }

  return { call };
}

module.exports = { createMenuService };
