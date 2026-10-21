// Numbered migrations. The applied version lives in PRAGMA user_version.
// Never edit a released migration; add a new one. Schema mirrors docs/TRD.md §3.
// All money columns are integer paise. Timestamps are ISO-8601 UTC strings, and
// `paid_date` / `date` columns are the restaurant's local calendar date (YYYY-MM-DD).

const MIGRATIONS = [
  // 1: initial schema
  `
  CREATE TABLE restaurant_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL, tagline TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '', gstin TEXT NOT NULL DEFAULT '', fssai TEXT NOT NULL DEFAULT '',
    hsn_sac TEXT NOT NULL DEFAULT '996331',
    receipt_header TEXT NOT NULL DEFAULT '', receipt_footer TEXT NOT NULL DEFAULT '',
    show_logo INTEGER NOT NULL DEFAULT 1,
    paper_width_mm INTEGER NOT NULL DEFAULT 80 CHECK (paper_width_mm IN (58, 80))
  );

  CREATE TABLE tax_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    gst_rate_bp INTEGER NOT NULL DEFAULT 500,
    prices_include_tax INTEGER NOT NULL DEFAULT 0,
    service_charge_enabled INTEGER NOT NULL DEFAULT 0,
    service_charge_bp INTEGER NOT NULL DEFAULT 500
  );

  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'cashier')),
    pin_hash TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE categories (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE menu_items (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES categories(id),
    name TEXT NOT NULL,
    short_code TEXT NOT NULL,
    price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
    veg INTEGER NOT NULL DEFAULT 1,
    available INTEGER NOT NULL DEFAULT 1,
    deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_menu_items_category ON menu_items(category_id);

  CREATE TABLE tables (
    id TEXT PRIMARY KEY, label TEXT NOT NULL, seats INTEGER NOT NULL DEFAULT 4
  );

  -- One row per bill from the moment it is opened (status 'open') until it is paid or cancelled.
  -- bill_no is NULL while open and assigned in the same transaction that marks it paid.
  CREATE TABLE bills (
    id TEXT PRIMARY KEY,
    bill_no TEXT UNIQUE,
    fy TEXT, seq INTEGER,
    order_type TEXT NOT NULL CHECK (order_type IN ('dine_in', 'takeaway', 'delivery')),
    table_id TEXT REFERENCES tables(id),
    status TEXT NOT NULL CHECK (status IN ('open', 'paid', 'cancelled')),
    subtotal_paise INTEGER NOT NULL DEFAULT 0,
    service_charge_paise INTEGER NOT NULL DEFAULT 0,
    cgst_paise INTEGER NOT NULL DEFAULT 0,
    sgst_paise INTEGER NOT NULL DEFAULT 0,
    round_off_paise INTEGER NOT NULL DEFAULT 0,
    total_paise INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT CHECK (payment_method IN ('cash', 'upi', 'card')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    paid_at TEXT, paid_date TEXT,
    cancelled_by TEXT, cancelled_at TEXT, cancel_reason TEXT,
    CHECK (status = 'open' OR (bill_no IS NOT NULL AND payment_method IS NOT NULL AND paid_at IS NOT NULL))
  );
  CREATE INDEX idx_bills_paid_date ON bills(paid_date);
  CREATE INDEX idx_bills_status ON bills(status);

  CREATE TABLE bill_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    menu_item_id TEXT NOT NULL,
    item_name TEXT NOT NULL,           -- snapshot at time of sale
    unit_price_paise INTEGER NOT NULL, -- snapshot at time of sale
    veg INTEGER NOT NULL DEFAULT 1,
    qty INTEGER NOT NULL CHECK (qty > 0),
    kot_qty INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_bill_items_bill ON bill_items(bill_id);

  -- Gapless bill numbers per financial year.
  CREATE TABLE bill_counters (fy TEXT PRIMARY KEY, last_seq INTEGER NOT NULL);

  -- One row per local calendar day. Kept in step with bills by the pay/cancel transactions,
  -- and is exactly what the daily sync to Supabase will upload (TRD §7).
  CREATE TABLE daily_summary (
    date TEXT PRIMARY KEY,
    sales_paise INTEGER NOT NULL DEFAULT 0,
    bills INTEGER NOT NULL DEFAULT 0,
    cancelled INTEGER NOT NULL DEFAULT 0,
    cash_paise INTEGER NOT NULL DEFAULT 0,
    upi_paise INTEGER NOT NULL DEFAULT 0,
    card_paise INTEGER NOT NULL DEFAULT 0,
    tax_paise INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // 2: tables and categories can be removed from the menu/floor without breaking old bills
  `
  ALTER TABLE tables ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE categories ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
  `,
];

module.exports = { MIGRATIONS };
