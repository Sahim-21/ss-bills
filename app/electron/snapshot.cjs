// The menu-and-settings copy that is kept in SS Bills' cloud so a lost or replaced PC does not mean retyping the menu
// (docs/DECISIONS.md D-043). It contains ONLY: the restaurant profile and receipt text, GST settings, categories, menu items
// and tables. It never contains bills, staff, PINs, printer names or licence data. The same module builds a copy to upload and
// strictly checks a copy before it is restored: nothing from the network is trusted until it passes validateSnapshot.
const crypto = require("node:crypto");

const FORMAT = 1;
const LIMITS = { categories: 200, menu: 5000, tables: 500 };
const TOP_KEYS = ["version", "createdAt", "profile", "tax", "categories", "menu", "tables"];
const PROFILE_KEYS = ["name", "tagline", "address", "phone", "gstin", "fssai", "hsnSac", "receiptHeader", "receiptFooter", "showLogo", "paperWidthMm"];
const TAX_KEYS = ["gstRateBp", "pricesIncludeTax", "serviceChargeEnabled", "serviceChargeBp"];
const CATEGORY_KEYS = ["id", "name", "sortOrder"];
const MENU_KEYS = ["id", "categoryId", "name", "shortCode", "pricePaise", "veg", "available"];
const TABLE_KEYS = ["id", "label", "seats"];

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Read the current menu and settings out of the local database. Returns null for a database that is not set up yet. */
function buildSnapshot(db, now = new Date()) {
  const q = (sql) => db.prepare(sql);
  const p = q("SELECT name, tagline, address, phone, gstin, fssai, hsn_sac, receipt_header, receipt_footer, show_logo, paper_width_mm FROM restaurant_profile WHERE id = 1").get();
  const t = q("SELECT gst_rate_bp, prices_include_tax, service_charge_enabled, service_charge_bp FROM tax_settings WHERE id = 1").get();
  if (!p || !t) return null;
  const categories = q("SELECT id, name, sort_order FROM categories WHERE active = 1 ORDER BY sort_order, name, id").all();
  const activeIds = new Set(categories.map((c) => c.id));
  return {
    version: FORMAT,
    createdAt: now.toISOString(),
    profile: {
      name: p.name, tagline: p.tagline, address: p.address, phone: p.phone, gstin: p.gstin, fssai: p.fssai, hsnSac: p.hsn_sac,
      receiptHeader: p.receipt_header, receiptFooter: p.receipt_footer, showLogo: !!p.show_logo, paperWidthMm: p.paper_width_mm,
    },
    tax: {
      gstRateBp: t.gst_rate_bp, pricesIncludeTax: !!t.prices_include_tax, serviceChargeEnabled: !!t.service_charge_enabled, serviceChargeBp: t.service_charge_bp,
    },
    categories: categories.map((c) => ({ id: c.id, name: c.name, sortOrder: c.sort_order })),
    // items of a removed category are left out: they could not be shown anywhere
    menu: q("SELECT id, category_id, name, short_code, price_paise, veg, available FROM menu_items WHERE deleted = 0 ORDER BY category_id, name, id")
      .all()
      .filter((m) => activeIds.has(m.category_id))
      .map((m) => ({ id: m.id, categoryId: m.category_id, name: m.name, shortCode: m.short_code, pricePaise: m.price_paise, veg: !!m.veg, available: !!m.available })),
    tables: q("SELECT id, label, seats FROM tables WHERE active = 1 ORDER BY label, id").all().map((x) => ({ id: x.id, label: x.label, seats: x.seats })),
  };
}

/** Identifies the CONTENT (not the time it was made): the same menu always gives the same hash. */
function snapshotHash(snapshot) {
  const rest = { ...snapshot };
  delete rest.createdAt;
  return crypto.createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

/**
 * Strictly checks a copy before it is used. Returns { ok: true, snapshot } with a cleaned copy (only known fields, trimmed text)
 * or { ok: false, error } naming the first problem. Used before uploading AND before restoring.
 */
function validateSnapshot(input) {
  const fail = (error) => ({ ok: false, error });
  if (!isObject(input)) return fail("The saved menu is not in the expected format");
  for (const k of Object.keys(input)) if (!TOP_KEYS.includes(k)) return fail(`The saved menu has an unexpected field "${k}"`);
  if (input.version !== FORMAT) {
    return fail(input.version > FORMAT ? "This menu copy was saved by a newer version of SS Bills. Update the app first" : "The saved menu is in an unknown format");
  }
  for (const [name, max] of Object.entries(LIMITS)) {
    if (!Array.isArray(input[name])) return fail(`The saved menu is missing its ${name}`);
    if (input[name].length > max) return fail(`The saved menu has too many ${name} (the limit is ${max})`);
  }
  const keysOk = (o, allowed, where) => {
    if (!isObject(o)) return `${where} is not valid`;
    for (const k of Object.keys(o)) if (!allowed.includes(k)) return `${where} has an unexpected field "${k}"`;
    return null;
  };
  const str = (v, min, max) => typeof v === "string" && v.length >= min && v.length <= max;
  const tr = (v) => (typeof v === "string" ? v.trim() : ""); // trimmed text, or "" for anything that is not text
  const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

  // profile and tax
  let e = keysOk(input.profile, PROFILE_KEYS, "The restaurant profile");
  if (e) return fail(e);
  const p = input.profile;
  const text = (key, max) => str(p[key], 0, max);
  if (!str(tr(p.name), 1, 200)) return fail("The restaurant name is missing or too long");
  if (!text("tagline", 300) || !text("address", 500) || !text("phone", 60) || !text("gstin", 20) || !text("fssai", 20) || !text("hsnSac", 20) || !text("receiptHeader", 2000) || !text("receiptFooter", 2000)) {
    return fail("The restaurant profile has a text that is too long");
  }
  if (typeof p.showLogo !== "boolean" || ![58, 80].includes(p.paperWidthMm)) return fail("The receipt settings are not valid");
  e = keysOk(input.tax, TAX_KEYS, "The tax settings");
  if (e) return fail(e);
  const t = input.tax;
  if (!int(t.gstRateBp, 0, 10000) || !int(t.serviceChargeBp, 0, 10000) || typeof t.pricesIncludeTax !== "boolean" || typeof t.serviceChargeEnabled !== "boolean") {
    return fail("The tax settings are not valid");
  }

  // categories, items, tables
  const catIds = new Set();
  const categories = [];
  for (const [i, c] of input.categories.entries()) {
    e = keysOk(c, CATEGORY_KEYS, `Category ${i + 1}`);
    if (e) return fail(e);
    if (!str(c.id, 1, 80) || !str(tr(c.name), 1, 80) || !int(c.sortOrder, 0, 100000)) return fail(`Category ${i + 1} is not valid`);
    if (catIds.has(c.id)) return fail(`Category ${i + 1} repeats an earlier one`);
    catIds.add(c.id);
    categories.push({ id: c.id, name: c.name.trim(), sortOrder: c.sortOrder });
  }
  const itemIds = new Set();
  const menu = [];
  for (const [i, m] of input.menu.entries()) {
    e = keysOk(m, MENU_KEYS, `Item ${i + 1}`);
    if (e) return fail(e);
    if (!str(m.id, 1, 80) || !str(tr(m.name), 1, 120) || !str(m.shortCode, 0, 20)) return fail(`Item ${i + 1} is not valid`);
    if (!int(m.pricePaise, 0, 100_000_000)) return fail(`Item ${i + 1} has an invalid price`);
    if (typeof m.veg !== "boolean" || typeof m.available !== "boolean") return fail(`Item ${i + 1} is not valid`);
    if (!catIds.has(m.categoryId)) return fail(`Item ${i + 1} belongs to a category that is not in the copy`);
    if (itemIds.has(m.id)) return fail(`Item ${i + 1} repeats an earlier one`);
    itemIds.add(m.id);
    menu.push({ id: m.id, categoryId: m.categoryId, name: m.name.trim(), shortCode: m.shortCode, pricePaise: m.pricePaise, veg: m.veg, available: m.available });
  }
  const tableIds = new Set();
  const labels = new Set();
  const tables = [];
  for (const [i, x] of input.tables.entries()) {
    e = keysOk(x, TABLE_KEYS, `Table ${i + 1}`);
    if (e) return fail(e);
    if (!str(x.id, 1, 80) || !str(tr(x.label), 1, 40) || !int(x.seats, 1, 50)) return fail(`Table ${i + 1} is not valid`);
    const label = x.label.trim();
    if (tableIds.has(x.id) || labels.has(label.toLowerCase())) return fail(`Table ${i + 1} repeats an earlier one`);
    tableIds.add(x.id);
    labels.add(label.toLowerCase());
    tables.push({ id: x.id, label, seats: x.seats });
  }

  return {
    ok: true,
    snapshot: {
      version: FORMAT,
      createdAt: typeof input.createdAt === "string" ? input.createdAt.slice(0, 40) : "",
      profile: {
        name: p.name.trim(), tagline: p.tagline, address: p.address, phone: p.phone, gstin: p.gstin, fssai: p.fssai, hsnSac: p.hsnSac,
        receiptHeader: p.receiptHeader, receiptFooter: p.receiptFooter, showLogo: p.showLogo, paperWidthMm: p.paperWidthMm,
      },
      tax: { gstRateBp: t.gstRateBp, pricesIncludeTax: t.pricesIncludeTax, serviceChargeEnabled: t.serviceChargeEnabled, serviceChargeBp: t.serviceChargeBp },
      categories, menu, tables,
    },
  };
}

/** A short plain-language description for the screen: how much a copy holds. */
function summarize(snapshot, savedAt) {
  return { restaurantName: snapshot.profile.name, items: snapshot.menu.length, categories: snapshot.categories.length, tables: snapshot.tables.length, savedAt: savedAt ?? null };
}

module.exports = { FORMAT, LIMITS, buildSnapshot, snapshotHash, validateSnapshot, summarize };
