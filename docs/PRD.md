# SS Bills — Product Requirements Document (PRD)

| | |
|---|---|
| **Version** | 0.1 (draft) |
| **Last updated** | 2026-10-21 |
| **Status** | Planning complete; awaiting open decisions (see [DECISIONS.md](DECISIONS.md)) |

---

## 1. Overview

SS Bills is billing software for small and medium restaurants in India. Cashiers use it
at the counter to take orders, generate GST-compliant bills, and take payment. Owners use
it to manage the menu and view sales reports.

It is **offline-first**: billing never depends on the internet. The software is licensed
per restaurant, and each restaurant sends a daily sales summary to our central server.

## 2. Goals

1. Fast billing at the counter: an item is added in one click or a short search.
2. Correct GST bills with sequential bill numbers and a CGST/SGST split.
3. Works fully offline. Billing never stops because the Wi-Fi drops.
4. Prints on standard 58mm and 80mm thermal printers, plus PDF receipts.
5. Gives owners clear daily, monthly, and date-range reports.
6. Lets us (the vendor) license restaurants and see their daily summaries centrally.

## 3. Non-goals (for now)

- WhatsApp bill sharing (removed 2026-10-21; may return later)
- Discounts (excluded 2026-10-21)
- Inventory or stock management
- Online ordering or delivery-platform integration (Swiggy, Zomato)
- Multi-outlet management from a single install
- Storing restaurants' full bill-level data on our central server
- Cash change calculator, table merge/split, shifts and Z-reports, and other extras Stitch suggested (see [UI_DESIGN.md](UI_DESIGN.md)); owner declined them on 2026-10-21 (D-017)

## 4. Users and roles

| Role | Who | Can do |
|---|---|---|
| **Admin** | Restaurant owner or manager | Everything: menu, prices, settings, reports, staff, cancel bills, backup |
| **Cashier** | Counter staff | Create, hold, and settle bills; print and reprint; view today's bills |
| **Vendor** (us) | SS Bills team | Manage clients and licenses and view daily summaries in the Vendor Admin Portal (§5.8), not inside the restaurant app |

## 5. Features

Priority: **P0** is required for the MVP, **P1** follows right after the MVP, and **P2** comes later.

### 5.1 Billing and orders

| ID | Feature | Priority | Notes |
|---|---|---|---|
| B-1 | Click-to-add menu items | P0 | Item grid; click to add, click again to increase quantity |
| B-2 | Menu categories | P0 | Category tabs filter the item grid |
| B-3 | Smart menu search | P0 | Search by name or short code as you type |
| B-4 | Automatic bill calculation | P0 | Line totals, subtotal, tax, round-off, grand total |
| B-5 | GST and tax calculation | P0 | Configurable rate; shows the CGST/SGST split |
| B-6 | Order type: dine-in, takeaway, or delivery | P0 | Selected per bill |
| B-7 | Table numbers | P0 | Required for dine-in |
| B-8 | Held (open) bills | P0 | Save a running bill for a table and add items later |
| B-9 | Service charge (optional) | P1 | Off by default; configurable percentage (see TRD compliance note) |
| B-10 | Kitchen Order Ticket (KOT) | P1 | Prints new items for the kitchen without prices. Built; a failed print leaves the items marked as not sent |

### 5.2 Payments and receipts

| ID | Feature | Priority | Notes |
|---|---|---|---|
| P-1 | Cash, UPI, and card payments | P0 | Recorded per bill |
| P-2 | Payment method selection | P0 | One method per bill in the MVP; split payment is P2 |
| P-3 | Bill generation | P0 | Sequential bill number per financial year |
| P-4 | Print bill (thermal 58mm/80mm) | P0 | Silent printing to the chosen Windows printer. Built; **not yet tried on real thermal hardware** |
| P-5 | PDF receipt | P0 | Save a bill as PDF (page sized to the receipt). Built |

### 5.3 Menu management (Admin)

| ID | Feature | Priority |
|---|---|---|
| M-1 | Add menu items | P0 |
| M-2 | Edit and delete menu items (soft delete if used on past bills) | P0 |
| M-3 | Change item prices (past bills keep the old price) | P0 |
| M-4 | Manage categories (add, rename, remove when empty) | P0 |
| M-5 | Mark items available or unavailable | P0 |

### 5.4 Dashboard and reports (Admin)

| ID | Feature | Priority |
|---|---|---|
| R-1 | Today's total sales | P0 |
| R-2 | Total bills generated (today) | P0 |
| R-3 | Sales reports (daily and monthly) | P1 |
| R-4 | Payment reports (cash, UPI, and card breakdown) | P1 |
| R-5 | Best-selling items | P1 |
| R-6 | Date-range reports | P1 |

### 5.5 Bill and order history

| ID | Feature | Priority | Notes |
|---|---|---|---|
| H-1 | View previous bills | P0 | |
| H-2 | Search bills | P0 | By bill number, date, table, or amount |
| H-3 | View bill details | P0 | |
| H-4 | Reprint bills | P0 | Marked "DUPLICATE" on reprint |
| H-5 | Cancel bill (Admin only) | P0 | Soft cancel with a reason, kept for audit, number never reused |

### 5.6 Settings and administration

| ID | Feature | Priority | Notes |
|---|---|---|---|
| S-1 | Restaurant profile | P0 | Name, address, phone, GSTIN, FSSAI number, logo |
| S-2 | GST and tax settings | P0 | Rate, inclusive or exclusive pricing, HSN/SAC code |
| S-3 | Receipt customization | P1 | Header and footer text, logo on or off, paper width |
| S-4 | Staff accounts and roles | P0 | Admin and Cashier with PIN or password login |
| S-5 | Data backup | P1 | **Built** (D-035): manual and daily automatic, folder or USB, restore with safety copy |
| S-6 | First-run setup wizard | P0 | Added 2026-10-21. Restaurant details, GST, first Admin and PIN, starter categories, table count. Built |
| S-7 | Table management | P0 | Added 2026-10-21. Add, rename, change seats, remove (not while it has an open bill). Built |
| S-8 | Cloud copy of menu and settings, restored on a new PC | P1 | Added 2026-10-25 (D-043). Menu, categories, tables, GST and receipt settings only; never bills, staff or PINs. Built, applied to the live project and checked end to end there on 2026-10-25 |
| S-9 | Menu import and export as CSV | P1 | Added 2026-10-25 (D-044). Preview before import, all or nothing, never deletes. Built |

### 5.7 Licensing and central sync (vendor side)

| ID | Feature | Priority | Notes |
|---|---|---|---|
| L-1 | License key activation on first launch | P1 | **Built** (D-031 to D-033). Shown before the setup wizard |
| L-2 | Periodic license check with an offline grace period | P1 | **Built.** The app locks new bills only after the grace period; history, reports, backup stay open |
| L-3 | Daily summary upload to Supabase | P1 | **Built.** Sales total, bill count, payment split, tax, top item |
| L-4 | Monthly view built from daily summaries | P1 | Computed centrally, not uploaded separately |

### 5.8 Vendor Console ("SS Bills Console"; separate web app, vendor team only)

Built 2026-10-21 (D-024 to D-030). It reads and writes only central data: licenses, terminals, payments, and daily
summaries, never restaurants' bills. Works in a **demo mode** with sample data until a Supabase project is connected.

| ID | Feature | Priority | Status |
|---|---|---|---|
| V-1 | Sign-in with email, password and an authenticator code (TOTP); enforced in the database | P1 | Built (demo uses code 123456). Real TOTP untested until a Supabase project exists |
| V-2 | Overview: counts, combined sales trend, top clients, needs-attention list, recent activity | P1 | Built |
| V-3 | Clients list: status, plan, city filters, search (incl. license key), pagination, CSV export | P1 | Built |
| V-4 | Client detail: profile, license key (masked, copy), terminals, sales (7/30 days), daily ledger, payments, audit trail | P1 | Built |
| V-5 | Onboard a client: details, plan, terminals, optional first payment, key hand-over with welcome message | P1 | Built |
| V-6 | Suspend (reason required) and reactivate a license; takes effect at the restaurant's next sync | P1 | Built |
| V-7 | Renew / extend: record a payment (GST shown, agreed-amount override, waived), extend, optionally reactivate | P1 | Built |
| V-8 | Reset a terminal binding (reason required) to free a slot | P1 | Built |
| V-9 | Licenses & renewals view: expiring / grace / suspended / all, horizon, renewal side panel | P2 | Built |
| V-10 | Sales insights across clients: period vs previous period, leaderboard, payment mix, growth table, CSV | P2 | Built |
| V-11 | Activity log: append-only audit with filters, grouping by day, entry inspector | P1 | Built |
| V-12 | Settings: edit plans and prices, manage the vendor team | P2 | Built (not in the original list) |

Roles: **super admin** does everything. **Support** can view everything, renew, reset terminals and edit client details,
but cannot onboard, suspend, edit plans, manage the team, or change a client's terminal limit.

**Not yet connected:** the restaurant app does not call the console's backend yet (real license activation, daily
summary upload, offline grace, lock). That is the next phase (L-1 to L-4 above).

## 6. Release phases

| Phase | Contents |
|---|---|
| **1. Core billing** | Menu management, billing screen, tax calculation, order types, tables, held bills |
| **2. Payment and print** | Payments, bill numbering, thermal print, PDF |
| **3. History** | Bill history, search, details, reprint, cancel |
| **4. Dashboard and reports** | R-1 to R-6 |
| **5. Settings and admin** | Profile, tax settings, receipt customization, staff and roles, backup |
| **6. Extras** | KOT, service charge |
| **7. Licensing and sync** | L-1 to L-4 (may move earlier depending on O-2) |
| **8. Vendor Console** | V-1 to V-12: **built** (UI, database, tests); Supabase hookup pending |

MVP = Phases 1–3 plus R-1, R-2, S-1, S-2, and S-4.

## 7. Success criteria (MVP)

- A cashier can create and print a five-item bill in under 30 seconds.
- Bills are correct to the paisa, including GST split and round-off.
- The app works through a full day with the internet disconnected.
- No bill number is skipped or duplicated within a financial year.
