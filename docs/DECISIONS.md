# SS Bills — Decision Log

Record every product or technical decision here with the date and reason. Newest at the bottom.
Open questions live in their own section until resolved.

## Decisions

| ID | Date | Decision | Reason |
|---|---|---|---|
| D-001 | 2026-10-21 | **Offline-first with local SQLite** on each restaurant's PC holds all bill-level data | Billing must never stop when the internet drops. SQLite is free, needs no server, and backup is a single file |
| D-002 | 2026-10-21 | **Supabase** is the central vendor backend, for license authentication and consolidated daily summaries | One free service covers auth, Postgres, and an admin dashboard. SQL suits reports |
| D-003 | 2026-10-21 | Central server stores **only daily summaries** (sales, bill count, payment split, tax, top item), not full bills. Monthly figures are derived from the daily rows | Owner's choice: keep central data small, and keep detailed data with the restaurant |
| D-004 | 2026-10-21 | **WhatsApp bill sharing removed** for now | Owner's choice. The non-API (`wa.me`) approach can't attach PDFs; revisit later |
| D-005 | 2026-10-21 | **No discounts** | Owner's choice |
| D-006 | 2026-10-21 | Added to scope: table numbers, order types (dine-in, takeaway, delivery), held bills, sequential bill numbers, KOT, CGST/SGST split, optional service charge | Accepted from the review of the original plan |
| D-007 | 2026-10-21 | Support **58mm and 80mm thermal printers**, plus PDF | Standard restaurant hardware. Method superseded by D-023 |
| D-008 | 2026-10-21 | Two roles only: **Admin** and **Cashier** | Keep it simple; only Admin edits prices, cancels bills, and sees reports |
| D-009 | 2026-10-21 | Bills are **never hard-deleted**; they are cancelled with a reason and kept for audit | GST compliance and fraud prevention |
| D-010 | 2026-10-21 | Project docs (`AGENTS.md`, `docs/*`) are the shared memory across agents and must be updated as work progresses | Owner switches between AI agents |
| D-011 | 2026-10-21 | UI is designed in **Stitch AI** with multiple style variations; the owner picks one and shares the export zip (stored in `design/`). Style goal: catchy but simple and professional, with tiles, chips, and segmented controls preferred over dropdowns | Owner's choice. Prompts are in [UI_DESIGN.md](UI_DESIGN.md) |
| D-012 | 2026-10-21 | Add a **Vendor Admin Portal** ("SS Bills Console"), a separate hosted web app for us to track clients, issue, renew, and revoke licenses, reset device bindings, and view sales from daily summaries, with an audit log | Owner asked for a proper console. The raw Supabase dashboard is unsuitable for daily client management |
| D-013 | 2026-10-21 | **Desktop app built with Next.js + Electron.** Next.js (App Router) is built as a static export and served offline inside Electron through a private `app://` protocol. Resolves O-1 (desktop) and O-3 (Electron) | Owner chose Next.js + Electron. A static export keeps the app fully offline with no local server, and Electron allows silent thermal printing and SQLite later |
| D-014 | 2026-10-21 | Chosen UI direction: **Warm Saffron Counter** (Stitch export in `design/stitch-client-app/`). Resolves O-6 | Owner's selection after comparing Stitch variations |
| D-015 | 2026-10-21 | Features Stitch added that are outside the PRD were **left out** of the build (list in [UI_DESIGN.md](UI_DESIGN.md#deviations-from-the-stitch-export)) | AGENTS.md rule: no scope changes without owner agreement. Owner can opt any of them in later |
| D-016 | 2026-10-21 | First build step: **all screens as UI with mock data** (no database yet); billing math is real and unit-tested | Owner's choice. It validates the design and flows before wiring storage |
| D-017 | 2026-10-21 | **No left-out Stitch features are added back**, including the cash change calculator. D-015 stands | Owner's decision |
| D-018 | 2026-10-21 | **Licensing and summary sync are built after the core billing MVP.** Resolves O-2 | Owner accepted the recommendation: prove billing and printing first |
| D-019 | 2026-10-21 | **Local database uses Node's built-in `node:sqlite`** (ships inside Electron) instead of `better-sqlite3` | No native module to compile or rebuild for each Electron version. Works in Electron 45 (Node 24) and in tests |
| D-020 | 2026-10-21 | **The database, not the UI, assigns bill numbers**, inside the same transaction that marks the bill paid (`bill_counters` per financial year). Staff PINs are hashed with scrypt and checked in the main process | Gapless GST-compliant numbering must survive crashes and double clicks. PINs must not sit in the UI |
| D-021 | 2026-10-21 | ~~Demo data is seeded into an empty database on first launch~~ **Superseded by D-022** | Was a stopgap until the setup wizard existed |
| D-022 | 2026-10-21 | **A brand-new database runs a 4-step setup wizard** (restaurant, GST, Admin account and PIN, starter categories and tables). The sample restaurant is now an opt-in link on that screen. Tables and categories are soft-removed (`active = 0`) so old bills keep their labels | Real clients must enter their own details. Removing a table or category must never break past bills |
| D-023 | 2026-10-21 | **Printing goes through the Windows printer driver**, not raw ESC/POS. A receipt or kitchen ticket is HTML, loaded in a hidden window and printed silently to a named printer (or the system dialog), or saved as PDF. The same HTML drives the on-screen preview | Nearly every thermal printer sold has a Windows driver, no printer-specific code is needed, and it can be tested without hardware. Raw ESC/POS can be added later as an option if a specific printer needs it |
| D-024 | 2026-10-21 | **Vendor Console is a static Next.js web app (`portal/`) that talks straight to Supabase.** Every privileged action is a database function (`vendor_*`) that re-checks who is calling. `anon` and `authenticated` have no table access at all, and row level security is on with no policies | Hostable anywhere static, and the permission rules live in one tested place (the database), not in browser code |
| D-025 | 2026-10-21 | **Two-factor sign-in (TOTP) is required**, and enforced **in the database** (`mfa_ok()` / `require_mfa`), not only in the UI. Two vendor roles: **super admin** (everything) and **support** (view, renew, reset terminals, edit details; cannot onboard, suspend, edit plans, manage the team, or change a client's terminal limit) | A stolen password must not be enough to suspend clients or issue licenses |
| D-026 | 2026-10-21 | **One license per restaurant, allowing N terminals (PCs).** A PC binds to the license by machine ID on activation; a super admin or support can reset a binding to free a slot. Plans carry the default terminal count. This replaces the single `machine_id` in the first TRD draft | The Stitch design (and real restaurants) use more than one counter PC |
| D-027 | 2026-10-21 | **Payments are recorded by hand** (amount, method, reference) when the vendor receives money; renewing = record payment + extend. GST (18%, a setting) is added on top of plan prices. No payment gateway yet. A new period starts when the old one ends (or today if it already ended), so paying early loses no days | Keeps v1 simple and real. Razorpay links can be added later |
| D-028 | 2026-10-21 | **"Expiring soon" depends on the plan**: 30 days before a yearly license ends, 7 days before a monthly one. Grace period 7 days; "offline" = no check-in for 7 days. All are settings | A 30-day window made every new monthly license look like it needed renewing |
| D-029 | 2026-10-21 | The portal has a **browser demo mode** that runs the *same* migrations in PGlite with sample data (used whenever no Supabase project is configured) | Lets the console be explored and tested before a Supabase project exists, with no second copy of the business logic |
| D-030 | 2026-10-21 | Stitch features for the vendor console that are **not in the PRD were left out** (list in [UI_DESIGN.md](UI_DESIGN.md#vendor-console-deviations-from-the-stitch-export)). Same policy as D-015 | No scope changes without the owner. Any can be added later |

## Open questions

| ID | Question | Options | Recommendation |
|---|---|---|---|
| O-4 | Off-site backup of the full local database? | None / client's Google Drive / our Supabase Storage | Undecided. Local and USB backup is planned regardless |
| O-5 | Final plans and prices? | Seeded from the design: Monthly Standard ₹2,499 (1 terminal), Yearly Pro ₹24,999 (3), Lifetime POS ₹59,999 (5), all before 18% GST | **Placeholders.** Owner to confirm or edit in Console → Settings → Plans & prices. Nothing else depends on the numbers |
| O-7 | Where to host the portal, and which Supabase plan? | Vercel / Netlify / Cloudflare Pages (all free for static) · Supabase free vs Pro | Any static host. Free Supabase pauses an inactive project and has no daily backups, so use **Pro** once real clients depend on it |
