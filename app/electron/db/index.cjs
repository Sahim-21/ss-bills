// SS Bills local database (docs/TRD.md §3). Uses Node's built-in `node:sqlite`, which ships inside
// Electron, so there is no native module to compile. Runs in the Electron main process only;
// the UI reaches it through the IPC bridge in electron/preload.cjs.
const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { MIGRATIONS } = require("./schema.cjs");

const BILL_PREFIX = "SSB";
const METHODS = ["cash", "upi", "card"];
const PIN_FREE_TRIES = 5;
const ORDER_TYPES = ["dine_in", "takeaway", "delivery"];

/** Open (and create/upgrade) the database at `file`. Pass ":memory:" for tests. */
function openDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  if (file !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
    // FULL: a committed bill survives a power cut. Billing volume is low, so the cost is invisible.
    db.exec("PRAGMA synchronous = FULL");
  }
  try {
    migrate(db, file);
  } catch (e) {
    db.close(); // never leave a half-opened database behind
    throw e;
  }
  return db;
}

function migrate(db, file) {
  const current = db.prepare("PRAGMA user_version").get().user_version;
  // A database written by a NEWER version of the app must never be opened by an older one (for example after
  // an update is rolled back): it could silently corrupt data it does not understand.
  if (current > MIGRATIONS.length) {
    throw new Error("This data was saved by a newer version of SS Bills. Install the latest version of the app to open it.");
  }
  // Before an update changes an existing database, keep a copy of it (one per old version, next to the database).
  if (current > 0 && current < MIGRATIONS.length && file && file !== ":memory:") {
    const copy = `${file}.before-v${current + 1}.bak`;
    if (!fs.existsSync(copy)) db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`Database migration ${v + 1} failed: ${e.message}`);
    }
  }
}

// ---------- PIN hashing (TRD §6) ----------

function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pin, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function checkPin(pin, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(String(pin), Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// ---------- helpers ----------

const b = (v) => (v ? 1 : 0);
const nn = (v) => (v === undefined ? null : v);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const isPaise = (n) => Number.isInteger(n) && n >= 0;

/** `opts.now` (ms) is injectable so tests can move the clock. */
function createRepo(db, opts = {}) {
  const nowMs = opts.now ?? (() => Date.now());
  /** Run `fn` in an immediate transaction. Not re-entrant: repo methods never call each other's tx. */
  function tx(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  const q = (sql) => db.prepare(sql);

  // ----- mapping rows -> UI objects -----

  const mapLine = (r) => ({
    itemId: r.menu_item_id,
    name: r.item_name,
    unitPricePaise: r.unit_price_paise,
    veg: !!r.veg,
    qty: r.qty,
    kotQty: r.kot_qty,
  });

  function attachLines(rows, where, params) {
    if (rows.length === 0) return [];
    const items = q(
      `SELECT bi.* FROM bill_items bi JOIN bills ON bills.id = bi.bill_id WHERE ${where} ORDER BY bi.id`,
    ).all(...params);
    const byBill = new Map();
    for (const it of items) {
      if (!byBill.has(it.bill_id)) byBill.set(it.bill_id, []);
      byBill.get(it.bill_id).push(mapLine(it));
    }
    return rows.map((r) => ({ row: r, lines: byBill.get(r.id) ?? [] }));
  }

  const mapOpen = ({ row, lines }) => ({
    id: row.id,
    orderType: row.order_type,
    tableId: row.table_id,
    lines,
    createdAt: row.created_at,
    createdBy: row.created_by,
  });

  const mapPaid = ({ row, lines }) => ({
    id: row.id,
    billNo: row.bill_no,
    orderType: row.order_type,
    tableId: row.table_id,
    lines,
    status: row.status,
    subtotalPaise: row.subtotal_paise,
    serviceChargePaise: row.service_charge_paise,
    cgstPaise: row.cgst_paise,
    sgstPaise: row.sgst_paise,
    roundOffPaise: row.round_off_paise,
    totalPaise: row.total_paise,
    paymentMethod: row.payment_method,
    createdBy: row.created_by,
    paidAt: row.paid_at,
    ...(row.status === "cancelled"
      ? { cancelledBy: row.cancelled_by, cancelledAt: row.cancelled_at, cancelReason: row.cancel_reason }
      : {}),
  });

  function getPaidBill(id) {
    const row = q("SELECT * FROM bills WHERE id = ?").get(id);
    if (!row) return null;
    const [one] = attachLines([row], "bills.id = ?", [id]);
    return mapPaid(one);
  }

  /** Recompute one day's totals from its bills, so the summary can never drift from the bills. */
  function recomputeDaily(date) {
    q(
      `INSERT OR REPLACE INTO daily_summary (date, sales_paise, bills, cancelled, cash_paise, upi_paise, card_paise, tax_paise)
       SELECT ?1,
         COALESCE(SUM(CASE WHEN status='paid' THEN total_paise END), 0),
         COALESCE(SUM(status='paid'), 0),
         COALESCE(SUM(status='cancelled'), 0),
         COALESCE(SUM(CASE WHEN status='paid' AND payment_method='cash' THEN total_paise END), 0),
         COALESCE(SUM(CASE WHEN status='paid' AND payment_method='upi' THEN total_paise END), 0),
         COALESCE(SUM(CASE WHEN status='paid' AND payment_method='card' THEN total_paise END), 0),
         COALESCE(SUM(CASE WHEN status='paid' THEN cgst_paise + sgst_paise END), 0)
       FROM bills WHERE paid_date = ?1 AND status IN ('paid', 'cancelled')`,
    ).run(date);
  }

  function replaceLines(billId, lines) {
    q("DELETE FROM bill_items WHERE bill_id = ?").run(billId);
    const ins = q(
      "INSERT INTO bill_items (bill_id, menu_item_id, item_name, unit_price_paise, veg, qty, kot_qty) VALUES (?,?,?,?,?,?,?)",
    );
    for (const l of lines) {
      assert(Number.isInteger(l.qty) && l.qty > 0, "Invalid quantity on bill line");
      assert(isPaise(l.unitPricePaise), "Invalid price on bill line");
      ins.run(billId, l.itemId, l.name, l.unitPricePaise, b(l.veg), l.qty, Math.min(l.kotQty ?? 0, l.qty));
    }
  }

  // ----- writes used by both seeding and normal operation (no transaction of their own) -----

  function writeProfile(p) {
    q(
      `INSERT INTO restaurant_profile (id, name, tagline, address, phone, gstin, fssai, hsn_sac, receipt_header, receipt_footer, show_logo, paper_width_mm)
       VALUES (1,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, tagline=excluded.tagline, address=excluded.address,
         phone=excluded.phone, gstin=excluded.gstin, fssai=excluded.fssai, hsn_sac=excluded.hsn_sac,
         receipt_header=excluded.receipt_header, receipt_footer=excluded.receipt_footer,
         show_logo=excluded.show_logo, paper_width_mm=excluded.paper_width_mm`,
    ).run(p.name, p.tagline, p.address, p.phone, p.gstin, p.fssai, p.hsnSac, p.receiptHeader, p.receiptFooter, b(p.showLogo), p.paperWidthMm);
  }

  function writeTax(t) {
    assert(Number.isInteger(t.gstRateBp) && t.gstRateBp >= 0 && t.gstRateBp <= 10000, "Invalid GST rate");
    q(
      `INSERT INTO tax_settings (id, gst_rate_bp, prices_include_tax, service_charge_enabled, service_charge_bp)
       VALUES (1,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET gst_rate_bp=excluded.gst_rate_bp, prices_include_tax=excluded.prices_include_tax,
         service_charge_enabled=excluded.service_charge_enabled, service_charge_bp=excluded.service_charge_bp`,
    ).run(t.gstRateBp, b(t.pricesIncludeTax), b(t.serviceChargeEnabled), t.serviceChargeBp);
  }

  function writeStaff(s) {
    const existing = q("SELECT pin_hash FROM users WHERE id = ?").get(s.id);
    const hasNewPin = typeof s.pin === "string" && /^\d{4}$/.test(s.pin);
    assert(existing || hasNewPin, "A new staff member needs a 4-digit PIN");
    const pinHash = hasNewPin ? hashPin(s.pin) : existing.pin_hash;
    q(
      `INSERT INTO users (id, name, role, pin_hash, phone, active, created_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, role=excluded.role, pin_hash=excluded.pin_hash,
         phone=excluded.phone, active=excluded.active`,
    ).run(s.id, s.name, s.role, pinHash, s.phone ?? "", b(s.active), new Date().toISOString());
    // Never leave the restaurant without an active admin.
    const admins = q("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1").get().n;
    assert(admins > 0, "At least one active Admin is required");
  }

  function readJson(key, fallback) {
    try {
      const row = q("SELECT value FROM app_meta WHERE key = ?").get(key);
      return row ? { ...fallback, ...JSON.parse(row.value) } : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    q("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
  }

  /** Which Windows printers to use. null means "ask every time" (the system print dialog). */
  function readPrinters() {
    const row = q("SELECT value FROM app_meta WHERE key = 'printers'").get();
    try {
      const v = row ? JSON.parse(row.value) : {};
      return { receipt: typeof v.receipt === "string" ? v.receipt : null, kot: typeof v.kot === "string" ? v.kot : null };
    } catch {
      return { receipt: null, kot: null };
    }
  }

  function writePrinters(p) {
    const ok = (v) => v === null || (typeof v === "string" && v.length > 0 && v.length <= 200);
    assert(p && ok(p.receipt) && ok(p.kot), "Invalid printer settings");
    q("INSERT INTO app_meta (key, value) VALUES ('printers', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
      JSON.stringify({ receipt: p.receipt, kot: p.kot }),
    );
  }

  function writeCategory(c) {
    assert(typeof c.name === "string" && c.name.trim(), "A category needs a name");
    q(
      `INSERT INTO categories (id, name, sort_order, active) VALUES (?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order, active=excluded.active`,
    ).run(c.id, c.name.trim(), c.sortOrder, c.active === undefined ? 1 : b(c.active));
  }

  function writeTable(t) {
    const label = typeof t.label === "string" ? t.label.trim() : "";
    assert(label, "A table needs a label");
    assert(Number.isInteger(t.seats) && t.seats >= 1 && t.seats <= 50, "Seats must be between 1 and 50");
    const active = t.active === undefined ? 1 : b(t.active);
    if (active) {
      const clash = q("SELECT id FROM tables WHERE active = 1 AND lower(label) = lower(?) AND id != ?").get(label, t.id);
      assert(!clash, `Another table is already called ${label}`);
    } else {
      const busy = q("SELECT COUNT(*) AS n FROM bills WHERE table_id = ? AND status = 'open'").get(t.id).n;
      assert(busy === 0, "This table has an open bill. Settle or move it first");
    }
    q(
      `INSERT INTO tables (id, label, seats, active) VALUES (?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET label=excluded.label, seats=excluded.seats, active=excluded.active`,
    ).run(t.id, label, t.seats, active);
  }

  function writeMenuItem(m) {
    assert(isPaise(m.pricePaise), "Invalid item price");
    const now = new Date().toISOString();
    q(
      `INSERT INTO menu_items (id, category_id, name, short_code, price_paise, veg, available, deleted, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id, name=excluded.name, short_code=excluded.short_code,
         price_paise=excluded.price_paise, veg=excluded.veg, available=excluded.available, deleted=excluded.deleted,
         updated_at=excluded.updated_at`,
    ).run(m.id, m.categoryId, m.name, m.shortCode, m.pricePaise, b(m.veg), b(m.available), b(m.deleted), now, now);
  }

  function writeOpenBill(bill) {
    const existing = q("SELECT status FROM bills WHERE id = ?").get(bill.id);
    if (existing && existing.status !== "open") return false; // already paid/cancelled: never overwrite
    assert(ORDER_TYPES.includes(bill.orderType), "Invalid order type");
    q(
      `INSERT INTO bills (id, order_type, table_id, status, created_by, created_at) VALUES (?,?,?,'open',?,?)
       ON CONFLICT(id) DO UPDATE SET order_type=excluded.order_type, table_id=excluded.table_id`,
    ).run(bill.id, bill.orderType, nn(bill.tableId), bill.createdBy, bill.createdAt);
    replaceLines(bill.id, bill.lines);
    return true;
  }

  function writePaidBill(p, billNo, fy, seq) {
    q(
      `INSERT INTO bills (id, bill_no, fy, seq, order_type, table_id, status, subtotal_paise, service_charge_paise,
         cgst_paise, sgst_paise, round_off_paise, total_paise, payment_method, created_by, created_at, paid_at, paid_date)
       VALUES (?,?,?,?,?,?,'paid',?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET bill_no=excluded.bill_no, fy=excluded.fy, seq=excluded.seq, order_type=excluded.order_type,
         table_id=excluded.table_id, status='paid', subtotal_paise=excluded.subtotal_paise,
         service_charge_paise=excluded.service_charge_paise, cgst_paise=excluded.cgst_paise, sgst_paise=excluded.sgst_paise,
         round_off_paise=excluded.round_off_paise, total_paise=excluded.total_paise, payment_method=excluded.payment_method,
         paid_at=excluded.paid_at, paid_date=excluded.paid_date`,
    ).run(
      p.id, billNo, fy, seq, p.orderType, nn(p.tableId),
      p.totals.subtotal, p.totals.serviceCharge, p.totals.cgst, p.totals.sgst, p.totals.roundOff, p.totals.total,
      p.method, p.createdBy, p.createdAt ?? p.paidAt, p.paidAt, p.paidDate,
    );
    replaceLines(p.id, p.lines);
  }

  // ----- public API (called over IPC; arguments are plain JSON) -----

  return {
    /** Everything the UI needs at startup. `empty` is true on a brand-new database. */
    loadState({ today, fy, sinceDate }) {
      const users = q("SELECT * FROM users ORDER BY created_at, name").all();
      if (users.length === 0) return { empty: true };

      const profile = q("SELECT * FROM restaurant_profile WHERE id = 1").get();
      const tax = q("SELECT * FROM tax_settings WHERE id = 1").get();
      const openRows = q("SELECT * FROM bills WHERE status = 'open' ORDER BY created_at").all();
      const paidRows = q(
        "SELECT * FROM bills WHERE status IN ('paid','cancelled') AND paid_date >= ? ORDER BY paid_at DESC",
      ).all(sinceDate);
      const counter = q("SELECT last_seq FROM bill_counters WHERE fy = ?").get(fy);

      return {
        empty: false,
        staff: users.map((u) => ({ id: u.id, name: u.name, role: u.role, phone: u.phone, active: !!u.active, pin: "" })),
        categories: q("SELECT * FROM categories ORDER BY sort_order, name").all().map((c) => ({ id: c.id, name: c.name, sortOrder: c.sort_order, active: !!c.active })),
        menu: q("SELECT * FROM menu_items ORDER BY created_at, name").all().map((m) => ({
          id: m.id, categoryId: m.category_id, name: m.name, shortCode: m.short_code, pricePaise: m.price_paise,
          veg: !!m.veg, available: !!m.available, deleted: !!m.deleted,
        })),
        tables: q("SELECT * FROM tables ORDER BY CAST(SUBSTR(label, 2) AS INTEGER), label").all().map((t) => ({ id: t.id, label: t.label, seats: t.seats, active: !!t.active })),
        tax: {
          gstRateBp: tax.gst_rate_bp, pricesIncludeTax: !!tax.prices_include_tax,
          serviceChargeEnabled: !!tax.service_charge_enabled, serviceChargeBp: tax.service_charge_bp,
        },
        profile: {
          name: profile.name, tagline: profile.tagline, address: profile.address, phone: profile.phone,
          gstin: profile.gstin, fssai: profile.fssai, hsnSac: profile.hsn_sac,
          receiptHeader: profile.receipt_header, receiptFooter: profile.receipt_footer,
          showLogo: !!profile.show_logo, paperWidthMm: profile.paper_width_mm,
        },
        openBills: attachLines(openRows, "bills.status = 'open'", []).map(mapOpen),
        paidBills: attachLines(paidRows, "bills.status IN ('paid','cancelled') AND bills.paid_date >= ?", [sinceDate]).map(mapPaid),
        printers: readPrinters(),
        nextSeq: (counter?.last_seq ?? 0) + 1,
        history: q("SELECT * FROM daily_summary WHERE date >= ? AND date < ? ORDER BY date").all(sinceDate, today).map((d) => ({
          date: d.date, salesPaise: d.sales_paise, bills: d.bills, cancelled: d.cancelled,
          cashPaise: d.cash_paise, upiPaise: d.upi_paise, cardPaise: d.card_paise, taxPaise: d.tax_paise,
        })),
      };
    },

    /** Fill an empty database with demo data (until the first-run setup wizard exists). */
    seedDemo(d) {
      return tx(() => {
        if (q("SELECT COUNT(*) AS n FROM users").get().n > 0) return false;
        writeProfile(d.profile);
        writeTax(d.tax);
        d.staff.forEach(writeStaff);
        d.categories.forEach(writeCategory);
        d.menu.forEach(writeMenuItem);
        d.tables.forEach(writeTable);
        d.openBills.forEach(writeOpenBill);
        const maxSeq = new Map();
        for (const p of d.paidBills) {
          const [, fy, seqStr] = p.billNo.split("/");
          const seq = Number(seqStr);
          writePaidBill(
            { id: p.id, orderType: p.orderType, tableId: p.tableId, lines: p.lines, method: p.paymentMethod, createdBy: p.createdBy,
              paidAt: p.paidAt, paidDate: p.paidDate,
              totals: { subtotal: p.subtotalPaise, serviceCharge: p.serviceChargePaise, cgst: p.cgstPaise, sgst: p.sgstPaise, roundOff: p.roundOffPaise, total: p.totalPaise } },
            p.billNo, fy, seq,
          );
          if (p.status === "cancelled") {
            q("UPDATE bills SET status='cancelled', cancelled_by=?, cancelled_at=?, cancel_reason=? WHERE id=?").run(
              nn(p.cancelledBy), nn(p.cancelledAt), nn(p.cancelReason), p.id,
            );
          }
          maxSeq.set(fy, Math.max(maxSeq.get(fy) ?? 0, seq));
        }
        for (const [fy, last] of maxSeq) q("INSERT OR REPLACE INTO bill_counters (fy, last_seq) VALUES (?,?)").run(fy, last);
        // Past days are summarized directly; today's summary is derived from today's bills.
        const dates = new Set(d.paidBills.map((p) => p.paidDate));
        const insDay = q("INSERT OR REPLACE INTO daily_summary VALUES (?,?,?,?,?,?,?,?)");
        for (const h of d.history) insDay.run(h.date, h.salesPaise, h.bills, h.cancelled, h.cashPaise, h.upiPaise, h.cardPaise, h.taxPaise);
        dates.forEach(recomputeDaily);
        return true;
      });
    },

    /** Save (or remove, when empty) a bill that is still being built or is held. Never touches paid bills. */
    saveOpenBill(bill) {
      return tx(() => {
        if (!bill.lines || bill.lines.length === 0) {
          q("DELETE FROM bills WHERE id = ? AND status = 'open'").run(bill.id);
          return false;
        }
        return writeOpenBill(bill);
      });
    },

    deleteOpenBill(id) {
      q("DELETE FROM bills WHERE id = ? AND status = 'open'").run(id);
      return true;
    },

    /**
     * First-run setup: creates the restaurant, its first Admin, GST settings, starter categories and tables
     * in one transaction. Refuses if the database already has staff.
     */
    completeSetup(d) {
      return tx(() => {
        assert(q("SELECT COUNT(*) AS n FROM users").get().n === 0, "This restaurant is already set up");
        assert(typeof d.profile?.name === "string" && d.profile.name.trim(), "Restaurant name is required");
        assert(typeof d.profile?.address === "string" && d.profile.address.trim(), "Address is required");
        assert(d.admin && typeof d.admin.name === "string" && d.admin.name.trim(), "Admin name is required");
        assert(/^\d{4}$/.test(d.admin.pin ?? ""), "The Admin PIN must be 4 digits");
        const tableCount = d.tableCount ?? 0;
        assert(Number.isInteger(tableCount) && tableCount >= 0 && tableCount <= 100, "Table count must be between 0 and 100");
        writeProfile(d.profile);
        writeTax(d.tax);
        writeStaff({ id: d.admin.id, name: d.admin.name.trim(), role: "admin", pin: d.admin.pin, phone: d.admin.phone ?? "", active: true });
        (d.categories ?? []).forEach((c, i) => writeCategory({ id: c.id, name: c.name, sortOrder: i + 1, active: true }));
        for (let i = 1; i <= tableCount; i++) writeTable({ id: `t${i}`, label: `T${i}`, seats: 4, active: true });
        return true;
      });
    },

    upsertTable: (t) => tx(() => (writeTable(t), true)),
    setPrinters: (p) => tx(() => (writePrinters(p), true)),
    upsertMenuItem: (m) => tx(() => (writeMenuItem(m), true)),
    upsertCategory: (c) => tx(() => (writeCategory(c), true)),
    upsertStaff: (s) => tx(() => (writeStaff(s), true)),
    setTax: (t) => tx(() => (writeTax(t), true)),
    setProfile: (p) => tx(() => (writeProfile(p), true)),

    /**
     * Settle a bill. Assigns the next gapless number for the financial year in the same transaction,
     * so a crash can never skip or reuse a number. Safe to call twice for the same bill.
     */
    payBill(p) {
      return tx(() => {
        assert(METHODS.includes(p.method), "Invalid payment method");
        assert(ORDER_TYPES.includes(p.orderType), "Invalid order type");
        assert(Array.isArray(p.lines) && p.lines.length > 0, "Cannot pay an empty bill");
        assert(/^\d{4}-\d{2}$/.test(p.fy), "Invalid financial year");
        assert(/^\d{4}-\d{2}-\d{2}$/.test(p.paidDate), "Invalid bill date");
        const t = p.totals;
        for (const k of ["subtotal", "serviceCharge", "cgst", "sgst", "total"]) assert(isPaise(t[k]), `Invalid ${k}`);
        assert(Number.isInteger(t.roundOff), "Invalid round off");
        assert(t.total % 100 === 0, "Bill total must be whole rupees");
        const lineSum = p.lines.reduce((s, l) => s + l.unitPricePaise * l.qty, 0);
        assert(lineSum === t.subtotal, "Bill subtotal does not match its items");

        const existing = q("SELECT status FROM bills WHERE id = ?").get(p.id);
        if (existing && existing.status !== "open") return getPaidBill(p.id); // already settled (double click)

        const { last_seq: seq } = q(
          `INSERT INTO bill_counters (fy, last_seq) VALUES (?, 1)
           ON CONFLICT(fy) DO UPDATE SET last_seq = last_seq + 1 RETURNING last_seq`,
        ).get(p.fy);
        const billNo = `${BILL_PREFIX}/${p.fy}/${String(seq).padStart(6, "0")}`;
        writePaidBill(p, billNo, p.fy, seq);
        recomputeDaily(p.paidDate);
        return getPaidBill(p.id);
      });
    },

    /** Cancel a paid bill. It is kept for audit and its number is never reused. */
    cancelBill({ id, reason, by, at }) {
      return tx(() => {
        assert(typeof reason === "string" && reason.trim(), "A cancellation reason is required");
        const row = q("SELECT status, paid_date FROM bills WHERE id = ?").get(id);
        assert(row, "Bill not found");
        if (row.status === "cancelled") return getPaidBill(id);
        assert(row.status === "paid", "Only a paid bill can be cancelled");
        q("UPDATE bills SET status='cancelled', cancelled_by=?, cancelled_at=?, cancel_reason=? WHERE id=?").run(by, at, reason.trim(), id);
        recomputeDaily(row.paid_date);
        return getPaidBill(id);
      });
    },

    /**
     * Checks a PIN. After PIN_FREE_TRIES wrong tries in a row the user is locked out for a growing
     * time (1, 2, 4, 8, then 15 minutes), so a 4-digit PIN cannot be guessed at the keyboard.
     * A correct PIN clears the count. The count is saved, so restarting the app does not reset it.
     */
    verifyPin({ id, pin }) {
      const failKey = `pin_fail_${id}`;
      const fail = readJson(failKey, { n: 0, until: 0 });
      const now = nowMs();
      if (fail.until > now) {
        const mins = Math.ceil((fail.until - now) / 60_000);
        throw new Error(`Too many wrong PINs. Try again in ${mins} minute${mins === 1 ? "" : "s"}`);
      }
      const u = q("SELECT pin_hash, active FROM users WHERE id = ?").get(id);
      const ok = !!u && !!u.active && checkPin(pin, u.pin_hash);
      if (ok) {
        if (fail.n > 0) q("DELETE FROM app_meta WHERE key = ?").run(failKey);
        return true;
      }
      if (u) {
        const n = fail.n + 1;
        const until = n >= PIN_FREE_TRIES ? now + Math.min(15, 2 ** (n - PIN_FREE_TRIES)) * 60_000 : 0;
        writeJson(failKey, { n, until });
      }
      return false;
    },

    /**
     * Daily totals for the licence sync, from `sinceDate` (inclusive) on, with each day's best-selling item.
     * Cancelled-only days are included (they carry the cancelled count).
     */
    summariesSince(sinceDate) {
      const days = q("SELECT * FROM daily_summary WHERE date >= ? ORDER BY date DESC LIMIT 400").all(sinceDate).reverse();
      const tops = new Map();
      for (const r of q(
        `SELECT b.paid_date AS date, bi.item_name AS name, SUM(bi.qty) AS qty
         FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
         WHERE b.status = 'paid' AND b.paid_date >= ?
         GROUP BY b.paid_date, bi.item_name ORDER BY b.paid_date, qty DESC, bi.item_name`,
      ).all(sinceDate)) {
        if (!tops.has(r.date)) tops.set(r.date, r);
      }
      return days.map((d) => ({
        date: d.date, salesPaise: d.sales_paise, bills: d.bills, cancelled: d.cancelled,
        cashPaise: d.cash_paise, upiPaise: d.upi_paise, cardPaise: d.card_paise, taxPaise: d.tax_paise,
        topItemName: tops.get(d.date)?.name ?? null, topItemQty: tops.get(d.date)?.qty ?? null,
      }));
    },

    /** Small settings store for the main process (licence, backups). NOT reachable from the UI (see main.cjs). */
    getMeta(key) {
      return q("SELECT value FROM app_meta WHERE key = ?").get(key)?.value ?? null;
    },
    setMeta(key, value) {
      if (value === null) q("DELETE FROM app_meta WHERE key = ?").run(key);
      else q("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
    },

    /** Used by tests and the future summary sync. */
    getDailySummary(date) {
      return q("SELECT * FROM daily_summary WHERE date = ?").get(date) ?? null;
    },
  };
}

module.exports = { openDatabase, createRepo, hashPin, checkPin };
