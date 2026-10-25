// Menu import and export as a CSV file (opens in Excel and Google Sheets). Pure functions only: parsing, strict checking and
// planning what an import would do. Nothing here touches the database or the screen, so every rule is tested.
//
// Import rules, all deliberate:
//  - all or nothing: if ANY row has a problem the whole file is refused, with line numbers, so a half-imported menu never happens;
//  - nothing is ever deleted: items that are not in the file stay as they are;
//  - an item that already exists (same category and name, ignoring case) is updated; anything else is added;
//  - the file is treated purely as text: no formula is evaluated, and the export protects cells that begin with = + - @.
const LIMITS = { rows: 5000, bytes: 2 * 1024 * 1024, category: 60, name: 80, code: 12, categories: 200, price: 100_000_000 };
const DEFAULT_CATEGORY = "Imported";

const HEADER_ALIASES = {
  category: ["category", "categories", "section", "group", "menu category"],
  name: ["name", "item", "item name", "dish", "dish name", "product"],
  price: ["price", "rate", "mrp", "amount", "price (inr)", "price (rs)", "price (₹)", "price inr", "price rs", "price rupees"],
  veg: ["veg", "type", "food type", "veg/non-veg", "veg / non-veg", "veg or non veg", "veg nonveg", "diet"],
  shortCode: ["short code", "shortcode", "code", "item code", "sku"],
  available: ["available", "availability", "in stock", "active", "status"],
};

/** The header line a person sees in Excel. */
const EXPORT_HEADER = ["Category", "Name", "Price", "Veg", "Short code", "Available"];

// ---------------------------------------------------------------- reading a CSV file

/**
 * Splits CSV text into records. Handles a leading byte-order mark, comma / semicolon / tab separators (Excel uses the one set
 * in the PC's regional settings), quoted values with commas, doubled quotes and line breaks inside quotes.
 * Returns { records: [{ line, cells }], error } where `line` is the line the record starts on (for messages).
 */
function parseCsv(text) {
  let s = String(text ?? "");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const firstLine = s.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch) => {
    let n = 0;
    let quoted = false;
    for (const c of firstLine) {
      if (c === '"') quoted = !quoted;
      else if (c === ch && !quoted) n++;
    }
    return n;
  };
  const sep = [",", ";", "\t"].map((c) => [c, count(c)]).sort((a, b) => b[1] - a[1])[0];
  const delimiter = sep[1] > 0 ? sep[0] : ",";

  const records = [];
  let cells = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let startLine = 1;
  let i = 0;
  const endCell = () => {
    cells.push(cell);
    cell = "";
  };
  const endRecord = () => {
    endCell();
    if (cells.some((c) => c.trim() !== "")) records.push({ line: startLine, cells });
    cells = [];
  };
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        if (c === "\n") line++;
        cell += c;
      }
      i++;
      continue;
    }
    if (c === '"' && cell === "") {
      quoted = true;
      i++;
    } else if (c === delimiter) {
      endCell();
      i++;
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      endRecord();
      i++;
      line++;
      startLine = line;
    } else {
      cell += c;
      i++;
    }
  }
  if (quoted) return { records, error: `A quoted value that starts on line ${startLine} is never closed (a missing closing quote)` };
  if (cell !== "" || cells.length > 0) endRecord();
  return { records, error: null };
}

const clean = (v) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
/** An exported cell that starts with ' only to defuse a formula is turned back into the original text. */
const unprotect = (v) => (/^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v);

/**
 * "₹1,250.50", "Rs 100", "1,25,000" (Indian digit grouping), "100" -> paise, or null when it is not a money amount.
 * Spaces inside the number are refused ("10 20" is a typo, not a thousand), as are signs, exponents and 3+ decimals.
 */
function parsePrice(raw) {
  const t = String(raw ?? "").trim().replace(/^(?:₹|rs\.?|inr)\s*/i, "");
  const m = /^(\d{1,7}|\d{1,3}(?:,\d{2,3})+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const whole = m[1].replace(/,/g, "");
  if (whole.length > 7) return null;
  const paise = Number(whole) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return paise <= LIMITS.price ? paise : null;
}

const YES = new Set(["y", "yes", "true", "1", "veg", "v", "vegetarian", "available", "active", "in stock", "instock", "on"]);
const NO = new Set(["n", "no", "false", "0", "non-veg", "nonveg", "non veg", "nv", "non vegetarian", "non-vegetarian", "unavailable", "inactive", "out of stock", "outofstock", "off"]);
/** Yes/no style cells. Blank means `fallback`. Returns undefined for something we cannot understand. */
function parseFlag(raw, fallback) {
  const t = clean(raw).toLowerCase();
  if (t === "") return fallback;
  if (YES.has(t)) return true;
  if (NO.has(t)) return false;
  return undefined;
}

/** Turns CSV text into checked rows. Returns { rows, errors, ignoredColumns }. Never throws. */
function readMenuCsv(text) {
  const errors = [];
  if (Buffer.byteLength(String(text ?? ""), "utf8") > LIMITS.bytes) return { rows: [], errors: [{ line: 0, message: "The file is larger than 2 MB. A menu should be far smaller" }], ignoredColumns: [] };
  const { records, error } = parseCsv(text);
  if (error) return { rows: [], errors: [{ line: 0, message: error }], ignoredColumns: [] };
  if (records.length === 0) return { rows: [], errors: [{ line: 0, message: "The file is empty" }], ignoredColumns: [] };

  const header = records[0].cells.map((c) => clean(unprotect(c)).toLowerCase());
  const col = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const at = header.findIndex((h) => aliases.includes(h));
    if (at >= 0) col[field] = at;
  }
  if (col.name === undefined || col.price === undefined) {
    return { rows: [], errors: [{ line: records[0].line, message: `The first row must be column titles including "Name" and "Price" (found: ${header.filter(Boolean).join(", ") || "nothing"})` }], ignoredColumns: [] };
  }
  const used = new Set(Object.values(col));
  const ignoredColumns = records[0].cells.map((c, i) => (used.has(i) || clean(c) === "" ? null : clean(c))).filter(Boolean);

  const body = records.slice(1);
  if (body.length === 0) return { rows: [], errors: [{ line: records[0].line, message: "There are no items under the column titles" }], ignoredColumns };
  if (body.length > LIMITS.rows) return { rows: [], errors: [{ line: 0, message: `The file has ${body.length} items; the limit is ${LIMITS.rows} in one import` }], ignoredColumns };

  const rows = [];
  const seen = new Map();
  for (const rec of body) {
    const get = (f) => (col[f] === undefined ? "" : unprotect(rec.cells[col[f]] ?? ""));
    const problems = [];
    const name = clean(get("name"));
    if (!name) problems.push("the name is empty");
    else if (name.length > LIMITS.name) problems.push(`the name is longer than ${LIMITS.name} characters`);
    const category = clean(get("category")) || DEFAULT_CATEGORY;
    if (category.length > LIMITS.category) problems.push(`the category name is longer than ${LIMITS.category} characters`);
    const pricePaise = parsePrice(get("price"));
    if (pricePaise === null) problems.push(`the price "${clean(get("price")).slice(0, 20)}" is not a valid amount (use digits like 120 or 120.50)`);
    const veg = parseFlag(get("veg"), true);
    if (veg === undefined) problems.push(`the Veg value "${clean(get("veg")).slice(0, 20)}" is not understood (use Veg or Non-veg)`);
    const available = parseFlag(get("available"), true);
    if (available === undefined) problems.push(`the Available value "${clean(get("available")).slice(0, 20)}" is not understood (use Yes or No)`);
    let shortCode = clean(get("shortCode")).toUpperCase().replace(/\s/g, "");
    if (shortCode && !/^[A-Z0-9\-]{1,12}$/.test(shortCode)) problems.push(`the short code "${shortCode.slice(0, 16)}" may only have letters, digits and dashes, up to ${LIMITS.code}`);
    if (rec.cells.length > header.length && rec.cells.slice(header.length).some((c) => clean(c) !== "")) problems.push("it has more values than the title row has columns (a comma inside a name must be in quotes)");

    if (problems.length === 0) {
      const key = `${category.toLowerCase()}|${name.toLowerCase()}`;
      if (seen.has(key)) problems.push(`it repeats "${name}" in "${category}" from line ${seen.get(key)}`);
      else seen.set(key, rec.line);
    }
    if (problems.length > 0) errors.push({ line: rec.line, message: `${name ? `"${name.slice(0, 40)}": ` : ""}${problems.join("; ")}` });
    else rows.push({ line: rec.line, category, name, pricePaise, veg, available, shortCode });
  }
  return { rows: errors.length > 0 ? [] : rows, errors, ignoredColumns };
}

/**
 * Turns the bytes of a file into text. Excel offers several "CSV" kinds: "CSV UTF-8" (starts with a byte-order mark), plain "CSV"
 * (the old Windows character set, NOT UTF-8) and "Unicode Text" (UTF-16). Reading all three correctly keeps accented letters
 * and names in any script intact. Returns { text, encoding }.
 */
function decodeCsvBuffer(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.toString("utf8").replace(/^\uFEFF/, ""), encoding: "UTF-8" };
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { text: buf.toString("utf16le").replace(/^\uFEFF/, ""), encoding: "UTF-16" };
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return { text: swapped.toString("utf16le"), encoding: "UTF-16" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf), encoding: "UTF-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(buf), encoding: "Windows-1252" };
  }
}

// ---------------------------------------------------------------- planning an import

/** A readable short code from a name: initials of the words (Paneer Butter Masala -> PBM), or the first letters of one word. */
function makeShortCode(name, taken) {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  let base = words.length >= 2 ? words.slice(0, 4).map((w) => w[0]).join("") : (words[0] ?? "ITEM").slice(0, 3);
  if (base.length < 2) base = (words.join("") + "XX").slice(0, 2);
  let code = base;
  for (let n = 2; taken.has(code); n++) code = `${base}${n}`.slice(0, LIMITS.code);
  taken.add(code);
  return code;
}

/**
 * Works out exactly what importing `rows` would do to what already exists, without changing anything.
 * @param existing { categories: [{id,name,sortOrder}], items: [{id,categoryId,name,shortCode,pricePaise,veg,available}] } (not removed ones)
 * @param newId    () => a fresh id for a new item or category
 * @returns { ok:false, error } or { ok:true, newCategories, creates, updates, unchanged }
 */
function planImport(rows, existing, newId) {
  const catByName = new Map(existing.categories.map((c) => [c.name.toLowerCase(), c]));
  const itemByKey = new Map();
  for (const it of existing.items) {
    const cat = existing.categories.find((c) => c.id === it.categoryId);
    if (cat) itemByKey.set(`${cat.name.toLowerCase()}|${it.name.toLowerCase()}`, it);
  }
  const taken = new Set(existing.items.map((i) => i.shortCode.toUpperCase()).filter(Boolean));
  const newCategories = [];
  const creates = [];
  const updates = [];
  let unchanged = 0;
  let sortOrder = existing.categories.reduce((m, c) => Math.max(m, c.sortOrder), 0);

  for (const r of rows) {
    let cat = catByName.get(r.category.toLowerCase());
    if (!cat) {
      cat = { id: newId("c"), name: r.category, sortOrder: ++sortOrder, isNew: true };
      catByName.set(r.category.toLowerCase(), cat);
      newCategories.push({ id: cat.id, name: cat.name, sortOrder: cat.sortOrder });
    }
    const found = itemByKey.get(`${cat.name.toLowerCase()}|${r.name.toLowerCase()}`);
    if (found) {
      const patch = {};
      if (found.pricePaise !== r.pricePaise) patch.pricePaise = r.pricePaise;
      if (found.veg !== r.veg) patch.veg = r.veg;
      if (found.available !== r.available) patch.available = r.available;
      if (r.shortCode && found.shortCode.toUpperCase() !== r.shortCode) patch.shortCode = r.shortCode;
      if (Object.keys(patch).length === 0) unchanged++;
      else updates.push({ id: found.id, name: found.name, category: cat.name, before: { pricePaise: found.pricePaise, veg: found.veg, available: found.available, shortCode: found.shortCode }, patch });
    } else {
      let code = r.shortCode;
      if (code) taken.add(code);
      else code = makeShortCode(r.name, taken);
      creates.push({ id: newId("m"), categoryId: cat.id, category: cat.name, name: r.name, shortCode: code, pricePaise: r.pricePaise, veg: r.veg, available: r.available });
    }
  }
  if (existing.categories.length + newCategories.length > LIMITS.categories) {
    return { ok: false, error: `This import would make ${existing.categories.length + newCategories.length} categories; the limit is ${LIMITS.categories}` };
  }
  return { ok: true, newCategories, creates, updates, unchanged };
}

// ---------------------------------------------------------------- writing a CSV file

const quoteCell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** A cell that starts with = + - @ (or a tab / carriage return) would be run as a formula by a spreadsheet, so it is marked as text. */
const protect = (v) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const rupees = (paise) => `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;

/** The whole menu as CSV text: UTF-8 with a byte-order mark and Windows line breaks, so Excel shows every character correctly. */
function toCsv(categories, items) {
  const order = new Map(categories.map((c, i) => [c.id, i]));
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const lines = [EXPORT_HEADER.join(",")];
  const sorted = items
    .filter((i) => names.has(i.categoryId))
    .sort((a, b) => order.get(a.categoryId) - order.get(b.categoryId) || a.name.localeCompare(b.name));
  for (const i of sorted) {
    lines.push([protect(names.get(i.categoryId)), protect(i.name), rupees(i.pricePaise), i.veg ? "Veg" : "Non-veg", protect(i.shortCode), i.available ? "Yes" : "No"].map(quoteCell).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

module.exports = { LIMITS, DEFAULT_CATEGORY, EXPORT_HEADER, parseCsv, parsePrice, parseFlag, readMenuCsv, decodeCsvBuffer, makeShortCode, planImport, toCsv };
