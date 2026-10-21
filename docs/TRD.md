# SS Bills — Technical Requirements Document (TRD)

| | |
|---|---|
| **Version** | 0.6 |
| **Last updated** | 2026-10-21 |
| **Status** | App shell, UI stack, and local database built (D-013, D-019). Items marked **(PENDING)** depend on open questions in [DECISIONS.md](DECISIONS.md) |

---

## 1. Architecture overview

```
┌──────────────── Restaurant PC (offline-first) ────────────────┐
│                                                               │
│   SS Bills app: Electron + Next.js static export (React)      │
│        │                                                      │
│        ├── Local SQLite database (ALL bill-level data)        │
│        ├── Thermal printer (58mm/80mm, ESC/POS) + PDF         │
│        └── Sync worker (runs only when online)                │
│                 │                                             │
└─────────────────┼─────────────────────────────────────────────┘
                  │ HTTPS (license check + daily summary)
                  ▼
┌──────────────── Vendor: Supabase (ours) ──────────────────────┐
│   Postgres: restaurants (licenses), daily_summary             │
│   Edge Functions: activate, check-in/sync                     │
└───────────────────────────────▲───────────────────────────────┘
                                │ Supabase Auth (vendor admins only)
┌───────────────── Vendor Admin Portal (web) ───────────────────┐
│   "SS Bills Console": clients, licenses, revoke/renew,        │
│   sales insights from daily summaries, audit log              │
└───────────────────────────────────────────────────────────────┘
```

**Principle:** the local database is the source of truth for billing. The network is
only used for licensing and summaries, and all network calls are optional and retried.

## 2. Technology stack

| Layer | Choice | Status |
|---|---|---|
| App shell | **Electron** desktop app (`app/electron/main.cjs`) | **Decided** (D-013) |
| UI | **Next.js 16** (App Router) + React 19 + TypeScript, built as a **static export** (`output: "export"`) | **Decided** (D-013) |
| Styling | Tailwind CSS v4; design tokens in `app/src/app/globals.css` | **Built** |
| Fonts and icons | Plus Jakarta Sans (`@fontsource-variable`) and Material Symbols (`material-symbols`), bundled locally so the app works offline | **Built** |
| Local database | SQLite file `ssbills.db` in the per-user app data folder (Windows: `%APPDATA%\ss-bills\`). Override with env `SSBILLS_DB` | **Built** (D-001) |
| SQLite access | Node's built-in `node:sqlite` in the Electron main process (`app/electron/db/`), exposed to the UI over IPC through `preload.cjs` | **Built** (D-019) |
| Printing | Windows printer driver: receipt/KOT HTML printed by Electron (`electron/print.cjs`), PDF via `printToPDF` | **Built** (D-023) |
| Central backend | Supabase (Postgres + Edge Functions) | **Decided** (D-002) |
| Testing | Vitest (`npm test`): money and tax in `src/lib/billing.test.ts`, the database in `electron/db/db.test.ts` (30 tests: numbering, summaries, PINs, setup, tables and categories, migration upgrade, persistence) | **Built** |

### 2.1 How the desktop app runs

- **Dev:** `npm run electron:dev` starts `next dev` and opens Electron on `http://localhost:3000`.
  `npm run dev` alone runs the UI in a normal browser.
- **Production:** `npm run build` writes the static site to `app/out/`. Electron serves it through
  a private `app://ssbills/` protocol, so there is **no local web server** at runtime. The protocol
  handler refuses paths outside `out/`, and it maps Next.js segment-prefetch requests
  (`__next.<seg>.<seg>.__PAGE__.txt`) to the exported files (`__next.<seg>/<seg>/__PAGE__.txt`).
- Because it is a static export, there are no Next.js server features: no API routes, server
  actions, middleware, or cookies. Data access will go through Electron IPC instead.
- The renderer runs with `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`.
- **Not done yet:** a packaged Windows installer (electron-builder), and a Content-Security-Policy.

### 2.2 Data flow (desktop app)

```
UI (React)  ──usePos()──►  pos-store.tsx  ──window.ssbills.call(name, arg)──►  preload.cjs
                                                                                   │ ipcRenderer.invoke("db")
                                                                                   ▼
                          electron/main.cjs  (allowlist + sender check)  ──►  electron/db/index.cjs  ──►  ssbills.db
```

- **Startup:** `pos-store.tsx` calls `loadState`. A brand-new database (no staff) shows the **setup wizard**
  (`components/setup-wizard.tsx`), which calls `completeSetup` (one transaction) or, from its "sample restaurant" link,
  `seedDemo`; then the app reloads. Bills from the last 62 days are loaded into memory; older bills stay in the database
  (**pagination is not built yet**).
- **Saving:** the store compares each new state with the previous one and saves what changed
  (`usePersistence`), one write at a time in order. Held bills, menu, categories, staff, tax, and profile all work this way.
  If a save fails, a red banner appears in the app shell.
- **Paying and cancelling are not optimistic.** `payBill` and `cancelBill` run in one transaction in the main
  process; the UI only updates after they succeed. On failure the bill stays open and nothing is charged.
- **Browser mode** (`npm run dev`, no preload): there is no bridge, so the store runs on in-memory mock data.
  Screens behave the same, but nothing is saved.
- The main process accepts only the method names in `DB_METHODS` (`main.cjs`), and only from the app's own page.

### 2.3 Database rules (implemented)

- Schema is in `app/electron/db/schema.cjs` as numbered migrations (`PRAGMA user_version`). **Never edit a released
  migration; add a new one.** Foreign keys are on; WAL mode with `synchronous = FULL`.
- `bills` holds a bill from the moment it is opened (`status = 'open'`, no number) until it is paid or cancelled.
  `bill_no` is assigned in the same transaction as payment, from `bill_counters` (one counter per financial year),
  so numbers are gapless and a double click can't issue two. A cancelled bill keeps its number.
- `bill_items` stores the item name and price **as sold**, so later menu edits never change a bill.
- `daily_summary` is recomputed from the bills for that day on every pay and cancel, so it can't drift. It is exactly
  what the Supabase sync will upload.
- `payBill` validates its input (known payment method, whole-rupee total, subtotal equals the sum of the items).
  The totals themselves are calculated in the UI by `lib/billing.ts` and trusted by the database.
- PINs are stored as `scrypt$salt$hash`. The UI never receives them, and verification happens in the main process.
  An edit that sends no new PIN keeps the old one. The last active Admin can't be deactivated.
- `tables` and `categories` have an `active` flag (migration 2). Removing one sets `active = 0` so bills keep their
  labels; the UI shows only active ones (`usePos().tables` / `.categories`). A table can't be removed while it has an open bill,
  and active table labels are unique (case-insensitive).
- `completeSetup` refuses to run if any staff exist, validates the name, address, 4-digit PIN and table count (0 to 100),
  and either creates everything or nothing.
- **Known gaps:** no PIN attempt limit or lockout yet; the UI keeps a newly typed PIN in memory until restart; the
  Backup & Restore screen is still a UI mock (real backup should use SQLite's backup API, see §8).

## 3. Local database schema (SQLite), draft

All money columns are **integer paise** (₹1 = 100). All timestamps are ISO-8601 strings
in local time with the offset included.

```sql
restaurant_profile (id=1, name, address, phone, gstin, fssai_no, logo_path,
                    receipt_header, receipt_footer, paper_width_mm)

tax_settings       (id=1, gst_rate_bp,          -- basis points: 500 = 5.00%
                    prices_include_tax BOOLEAN,
                    service_charge_enabled BOOLEAN DEFAULT 0,
                    service_charge_bp, hsn_sac_code)

users              (id, name, role CHECK(role IN ('admin','cashier')),
                    pin_hash, active, created_at)

categories         (id, name, sort_order, active)

menu_items         (id, category_id, name, short_code, price_paise,
                    available BOOLEAN, deleted BOOLEAN, created_at, updated_at)

tables             (id, label, active)          -- "T1", "T2", ...

bills              (id, bill_no TEXT UNIQUE,    -- e.g. SSB/2026-27/000123
                    fy TEXT, seq INTEGER,       -- financial year + running number
                    order_type CHECK(order_type IN ('dine_in','takeaway','delivery')),
                    table_id NULL,
                    status CHECK(status IN ('open','paid','cancelled')),
                    subtotal_paise, service_charge_paise,
                    cgst_paise, sgst_paise, round_off_paise, total_paise,
                    payment_method CHECK(payment_method IN ('cash','upi','card')) NULL,
                    created_by, created_at, paid_at,
                    cancelled_by, cancelled_at, cancel_reason)

bill_items         (id, bill_id, menu_item_id,
                    item_name, unit_price_paise,  -- snapshot at time of sale
                    qty, line_total_paise, kot_printed BOOLEAN)

sync_queue         (id, kind, payload_json, created_at, attempts, last_error)

app_meta           (key PRIMARY KEY, value)     -- license key, machine id, last sync, schema version
```

**Notes:**
- `bill_items` copies the item name and price, so later menu edits never change old bills.
- A bill number is assigned when the bill is **paid**, inside a transaction, so numbers
  are gapless. Open (held) bills have no number yet.
- The financial year runs April to March (for example `2026-27`), and `seq` restarts at 1 each year.
- Schema changes use numbered migrations; the current version is stored in `app_meta`.

## 4. Billing calculation rules

1. `line_total = unit_price × qty`
2. `subtotal = Σ line_total`
3. `service_charge = subtotal × service_charge_rate`, only if enabled
4. Tax base = subtotal + service charge.
5. **Exclusive pricing:** `gst = base × gst_rate`. **Inclusive pricing:** tax is extracted
   with `gst = base − base / (1 + gst_rate)`.
6. `cgst = floor(gst / 2)`, and `sgst = gst − cgst`, so the two halves always add up to the total GST.
7. `round_off` brings the total to the nearest whole rupee and is shown as its own line.
8. All arithmetic is integer paise with explicit rounding (half-up), and it is unit-tested.

The default GST rate is **5%** (2.5% CGST + 2.5% SGST), the common rate for standalone
restaurants, and it is configurable. The owner is responsible for choosing the correct
rate; the app does not give tax advice.

> **Compliance note: service charge.** Indian consumer-protection guidelines
> (CCPA, 2022) say a service charge must not be added automatically or by default.
> It therefore ships **disabled**, and when enabled it must be clearly shown on the
> bill. Verify current rules before release.

## 5. Printing (D-023)

Printing uses the **Windows printer driver**, so any printer with a driver works, thermal receipt printers included.

```
receipt-html.ts (one HTML layout) ─┬─► on-screen preview (Receipt component, same HTML)
                                   └─► printDocument() ─► IPC "print" ─► print.cjs ─► hidden window ─► driver / PDF
```

- **One layout, two uses.** `src/lib/receipt-html.ts` builds the receipt and kitchen ticket as HTML (black on white, no
  shadows or greys). The on-screen preview renders exactly that HTML, so the preview is what prints. All user text is
  HTML-escaped (tested).
- **`electron/print.cjs`** loads the document into a hidden, sandboxed window (no scripts, no network, navigation blocked),
  measures the content height, then:
  - `printHtml` with a printer name: **silent** print to that printer, paper width = 58 or 80mm, length = content + 6mm feed.
    It first checks the printer exists and fails with a clear message if not.
  - `printHtml` with no printer: opens the **system print dialog** ("ask every time"). Cancel is not an error.
  - `htmlToPdf`: PDF whose page matches the paper width and content length. The **user picks the save location** in the
    system dialog; the UI never supplies a file path.
- **Settings:** `app_meta` key `printers` = `{ receipt, kot }` (Windows printer names, or null). A null KOT printer means
  "same as the receipt printer"; both null means the system dialog. Settings → Printing lists the Windows printers and has
  test buttons.
- **Receipt:** logo (initials), header, GSTIN/FSSAI, bill number, date, order and table, items with veg/non-veg mark,
  subtotal, optional service charge, CGST, SGST, round-off, total, payment method, footer, SAC. Marked `DUPLICATE` on
  reprint and `CANCELLED` for cancelled bills.
- **Kitchen ticket (KOT):** order type and table, time, cashier, only the **new** quantities (qty minus what a previous
  ticket already covered), big type, no prices. Items are marked "sent" only after the print succeeds.
- **Browser mode** (no Electron) falls back to the browser's print dialog through a hidden iframe.
- **Not yet verified on real hardware:** the silent path is tested with a fake printer and with intercepted Electron calls,
  because the Windows PDF and OneNote printers always show a dialog. Before first use with a real printer: set the
  driver's paper size to the roll width, turn off "fit to page", and run Settings → Printing → test buttons.
- Raw **ESC/POS** (cash-drawer kick, cutter commands, direct USB/network) is **not built**. It can be added as an
  alternative backend if a specific printer needs it.

## 6. Auth and roles (local)

- Staff log in with a 4–6 digit PIN, stored hashed (bcrypt or argon2).
- The first launch forces creation of an Admin account.
- Admin-only actions: menu and price edits, bill cancellation, reports beyond today,
  settings, staff management, backup and restore.

## 7. Central backend (Supabase)

Built and tested (D-024 to D-029). Source: `supabase/migrations/`, how-to: [supabase/README.md](../supabase/README.md).

### 7.1 Tables

| Table | Purpose |
|---|---|
| `app_settings` | `grace_days` 7, `expiring_days` 30, `expiring_days_monthly` 7, `offline_days` 7, `gst_bp` 1800, `require_mfa` 1 |
| `plans` | id, name, kind (`monthly`/`yearly`/`lifetime`), duration, price (paise, before GST), default terminals, on sale |
| `vendor_admins` | who can use the console: `super_admin` or `support` (linked to Supabase `auth.users`) |
| `restaurants` | code (`CL-HYD-0001`), name, owner, phone, email, city, address, GSTIN, notes |
| `licenses` | **one per restaurant**: key, plan, status (`active`/`suspended`), starts/expires (null = lifetime), `max_devices`, last check-in |
| `license_devices` | terminals bound to a license by machine ID; `active = false` after a reset |
| `payments` | manual record: plan, periods, subtotal, GST, total, method, reference, period covered |
| `daily_summary` | per restaurant per day: sales, bills, cancelled, cash/UPI/card, tax, top item (what the restaurant app uploads) |
| `license_events` | append-only audit log (trigger blocks update/delete): who, what, when, details |

Derived (not stored): `license_state()` = `suspended` > `expired` (past grace) > `grace` > `expiring` (within 30 days, or 7 for monthly) > `active`.
"Today" is the India calendar date. Money is integer paise.

### 7.2 Access model

- `anon` / `authenticated` have **no table privileges**; row level security is on with **no policies**; privileges are also
  revoked for tables added later (default privileges).
- The portal calls `vendor_*` functions (`security definer`). Each begins with `assert_vendor_admin()` (or
  `assert_super_admin()`), which requires a row in `vendor_admins` **and** a two-factor session (`auth.jwt()->>'aal' = 'aal2'`,
  switchable with `require_mfa`).
- `license_activate` and `license_checkin` are granted to `service_role` only, so only an Edge Function can call them.
- Internal helpers (`log_event`, `generate_license_key`, …) are not executable by anyone but the owner.

### 7.3 Flows

**Onboard:** `vendor_create_client` → restaurant + license + 16-hex key `XXXX-XXXX-XXXX-XXXX` (+ optional first payment). A super admin hands the key over.

**Activate (first launch, online):** the restaurant app sends key + machine ID + PC name to an Edge Function →
`license_activate`. The PC binds if a terminal slot is free and the license is not suspended or past grace. Returns plan,
expiry, state, grace days. Refusals come back as `{ ok:false, code, message }` (`invalid_key`, `suspended`, `expired`,
`device_limit`, `bad_request`).

**Check-in (daily, or when back online):** key + machine ID + pending daily summaries → `license_checkin`. The PC must
still be bound (a reset PC gets `device_not_bound`). The **whole batch is validated before anything is stored** (whole
non-negative numbers, sane dates, at most 400 days); a day is overwritten on re-sync. Returns the current state so the
app can lock or warn.

**Renew:** `vendor_renew` records the payment and extends from the later of the old expiry and now. **Suspend /
reactivate / reset terminal** need a reason where it matters and write an audit event.

**Offline grace and lock on the restaurant side** (7 days offline, block new bills afterwards, keep history/backup)
are specified in §7.4 and **not built yet**.

### 7.4 Restaurant app behaviour (to build)

- Activation screen calls the Edge Function; stores the key, machine ID and last good status in `app_meta`.
- A sync worker uploads `daily_summary` rows (already maintained locally, TRD §3) and refreshes status once a day when online.
- If the app cannot reach the server for more than `grace_days` since the last good check-in, or the server says
  `suspended`/`expired` past grace, it settles open bills, then blocks **new** bills. History, reports and backup stay available.
- A suspension only takes effect at the next successful check-in.

### 7.5 Vendor Console (`portal/`)

- Next.js 16 static export, React 19, Tailwind v4, same design tokens as the restaurant app (copied; extract a shared
  package later). Talks to Supabase from the browser with the **anon** key only.
- `src/lib/api.ts` maps each screen's call to a database function; two backends implement `rpc`: `supabase-api.ts`
  (real, with TOTP sign-in and first-time QR enrolment) and `demo/demo-api.ts` (the same migrations in PGlite, in the
  browser, with seed data).
- `scripts/sync-migrations.mjs` copies the SQL into the demo bundle before dev/build/test, so the demo can never drift.
- Routes: `/login`, `/` overview, `/clients`, `/clients/new`, `/clients/view?id=`, `/licenses`, `/insights`, `/activity`, `/settings`.
  (Detail uses a query string because static export has no dynamic routes.)

### 7.6 Security notes

- The app never contains the `service_role` key. The console only ever holds the anon key.
- Device-supplied text (item names, device names) is length-limited and only ever shown as text.
- CSV exports prefix cells starting with `= + - @` so a spreadsheet cannot run them as formulas.
- Known gaps: no rate limit on activation attempts (add one in the Edge Function); the machine ID deters casual copying
  but is not tamper-proof; TOTP enrolment/verification is written against Supabase's API but untested without a project.

## 8. Backup (local data)

- Manual: Admin chooses "Backup", which copies a consistent snapshot of `ssbills.db`
  (SQLite backup API) to a folder or USB drive. Restore replaces the DB after confirmation.
- Automatic: a daily snapshot goes to a local backups folder, and the last N copies are kept.
- Off-site backup of the full database (the client's Google Drive, or our storage) is
  **(PENDING)** O-4.
- The central `daily_summary` table is **not** a backup and can't restore bills.

## 9. Folder layout

```
SS Bills/
├── AGENTS.md, CLAUDE.md, README.md
├── docs/                  PRD, TRD, PROGRESS, DECISIONS, UI_DESIGN
├── design/                Stitch export of the chosen UI (reference only, not built)
├── app/                   restaurant desktop app (Next.js + Electron)
│   ├── electron/main.cjs    Electron main process, app:// protocol, IPC handlers
│   ├── electron/preload.cjs window.ssbills bridge (db + print)
│   ├── electron/print.cjs   printing engine (+ print.test.ts)
│   ├── electron/db/         schema.cjs (migrations), index.cjs (repository), db.test.ts
│   └── src/
│       ├── app/             routes: / (login), /activate, (pos)/billing, tables, history,
│       │                    dashboard, reports, menu, settings/{tax,receipt,staff,backup,license}
│       ├── components/      ui.tsx (design-system primitives), shell, receipt, charts, payment modal, setup-wizard
│       └── lib/             billing.ts (money/tax rules) + tests, money.ts, reports.ts,
│                            pos-store.tsx (state + persistence), mock-data.ts, types.ts, hooks.ts, desktop.d.ts,
│                            receipt-html.ts (receipt/KOT layout) + tests, printing.ts (print helper)
├── portal/                Vendor Console (Next.js): src/app, src/components, src/lib (+ demo/), sql/ tests, scripts/
└── supabase/              migrations/ (schema, functions, security) + README. functions/ (Edge Functions) not written yet
```

## 10. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | Adding an item updates the bill in under 100 ms; app cold start under 5 s |
| Reliability | No data loss on power cut (SQLite WAL mode, a transaction per bill) |
| Offline | 100% of billing features work offline |
| Platform | Windows 10/11 first |
| Data volume | About 500 bills a day for 5+ years without slowdown (indexed by date and bill number) |
