# SS Bills — Progress Tracker

**Last updated:** 2026-10-21

## Current status

**Two tracks.** The restaurant app (`app/`) is feature-complete for the MVP except real-hardware printing checks, backup and the installer (paused by the owner on 2026-10-21). The **Vendor Console is built** (`portal/` + `supabase/`) and works end to end in its **browser demo mode**. It is **not yet connected to a real Supabase project**, and the restaurant app does not talk to it yet.

**Vendor Console, verified 2026-10-21:** 64 tests in `portal/` (real Postgres via PGlite: permissions, onboarding, renewals,
terminals, check-in validation, reports, audit log, the demo adapter and its seed); lint, types and a static build pass; a
36-check browser run in Electron covered onboarding, suspend/reactivate, renew (two ways), terminal reset, activity
filtering, plan editing, team errors, sign-out, route guarding and the support role's limits.
Restaurant app checks from earlier still apply (`app/`: 64 tests).

**Open questions:** O-4 (off-site backup), O-5 (confirm plans and prices; placeholders from the design), O-7 (hosting and Supabase plan).

## Next steps (in order)

1. **Owner:** try the console (`cd portal && npm run dev`, http://localhost:3100, press Continue, code `123456`) and list changes. Confirm plans and prices (O-5).
2. **Connect real Supabase** (owner creates the project; steps in `supabase/README.md`): run the migrations, create the first super admin, set `portal/.env.local`, test real TOTP sign-in. *Needs the owner: creating accounts is not something an agent does.*
3. **Edge Functions** `activate` and `sync` (`supabase/functions/`), thin wrappers over `license_activate` / `license_checkin` with the service role and a simple rate limit.
4. **Restaurant app integration** (PRD L-1 to L-4, TRD §7.4): real activation screen, daily summary upload from `daily_summary`, status refresh, 7-day offline grace, lock for new bills when suspended/expired. Add the item-level data decision (best-selling items for other ranges is still an estimate).
5. Resume the restaurant app: real backup and restore, thermal printer check, Windows installer, CSP, auto-update.
6. Later: payment gateway (Razorpay), invoices, regional roles, anything in the "left out" lists (UI_DESIGN.md).

## Phase checklist

Feature IDs refer to [PRD.md](PRD.md).

### Phase 0: Planning
- [x] Feature list agreed
- [x] Database strategy (local SQLite plus central Supabase)
- [x] PRD, TRD, decision log, and progress tracker written
- [x] Resolve O-1, O-3 (D-013: Next.js + Electron desktop app)
- [x] Resolve O-2 (D-018: licensing after the core billing MVP)

### Phase 0.5: UI design
- [x] Stitch AI prompts written (3 style directions, 11 screen prompts)
- [x] Stitch prompts for the Vendor Admin Portal (6 prompts)
- [x] Owner generates variations and picks one (D-014: Warm Saffron Counter)
- [x] Selected design zip saved to `design/` and reviewed against the checklist

### Phase 1: Core billing
- [x] Project scaffold (Next.js 16 + Electron + Tailwind v4 + Vitest)
- [x] Money and tax calculation module plus tests (`app/src/lib/billing.ts`)
- [x] **UI for all screens with mock data** (D-016): every PRD MVP screen, plus KOT, service charge, backup, and license UIs
- [x] SQLite schema and migrations (`app/electron/db/`), repository, IPC bridge, 21 tests
- [x] Menu management M-1 to M-5 (saved to the database)
- [x] Billing screen B-1 to B-4 (held bills and bills saved to the database)
- [x] GST calculation: B-5
- [x] Order types and tables B-6, B-7
- [x] Held bills B-8 (survive restarts)
- [x] First-run setup wizard (D-022), with sample-restaurant option
- [x] Table management (add, rename, seats, remove) and category rename/remove

### Phase 2: Payment and print
- [x] Payment methods: P-1, P-2 (saved with the bill)
- [x] Bill numbering per financial year: P-3 (gapless, assigned by the database)
- [x] Thermal printing 58mm/80mm: P-4 (via Windows driver, D-023). **Real-hardware check pending**
- [x] PDF receipt: P-5
- [x] KOT printing: B-10
- [x] Printer picker and test prints (Settings → Printing)

### Phase 3: History
- [ ] H-1 to H-5

### Phase 4: Dashboard and reports
- [ ] R-1, R-2 (MVP)
- [ ] R-3 to R-6

### Phase 5: Settings and admin
- [ ] S-1, S-2, S-4 (MVP)
- [ ] S-3, S-5

### Phase 6: Extras
- [ ] KOT: B-10
- [ ] Service charge: B-9

### Phase 7: Licensing and sync
- [x] Database side: tables, `license_activate`, `license_checkin` (tested)
- [ ] Supabase project created and migrations applied (needs the owner)
- [ ] Edge Functions: activate, sync
- [ ] L-1 to L-4 in the restaurant app (activation screen, daily upload, offline grace, lock)

### Phase 8: Vendor Console
- [x] Database: schema, vendor functions, device functions, security, 48 tests (`supabase/migrations/`, `portal/sql/`)
- [x] Portal scaffold, demo mode (same SQL in PGlite), sign-in with two-factor (V-1)
- [x] Overview, clients, client detail (V-2 to V-4)
- [x] Onboard, renew, suspend, reactivate, reset terminal, audit log (V-5 to V-8, V-11)
- [x] Licenses view, sales insights, settings (V-9, V-10, V-12)
- [ ] Connect a real Supabase project and verify real TOTP sign-in (needs the owner)
- [ ] Hosting

## Session log

| Date | Agent | Summary |
|---|---|---|
| 2026-10-21 | Claude (Code) | Created the project folder and git repo. Planned features with the owner, reviewed the plan, and chose local SQLite plus Supabase. Wrote AGENTS.md, CLAUDE.md, README, PRD, TRD, DECISIONS, and PROGRESS. |
| 2026-10-21 | Claude (Code) | Owner chose Stitch AI for UI design. Wrote docs/UI_DESIGN.md with a base prompt, 3 style directions, 10 more screen prompts, and a screen checklist. Logged D-011 and O-6. |
| 2026-10-21 | Claude (Code) | Owner asked for a vendor dashboard. Added the Vendor Admin Portal to the PRD (§5.8, V-1 to V-11), TRD (§7.4, `vendor_admins` and `license_events` tables, revocation behavior), DECISIONS (D-012), and 6 Stitch prompts in UI_DESIGN.md. |
| 2026-10-21 | Claude (Code) | Owner shared the Stitch zip (Warm Saffron Counter), extracted it to `design/stitch-client-app/`, and chose Next.js + Electron. Scaffolded `app/` and built all 16 routes from the design with an in-memory mock store, real paise/GST math with 10 unit tests, Electron `app://` static serving, and validated chart colors. Left out the Stitch extras that are outside the PRD (UI_DESIGN.md). Logged D-013 to D-016; resolved O-1, O-3, O-6. Updated TRD §2 and §9. |
| 2026-10-21 | Claude (Code) | Owner decided: no left-out Stitch features (D-017) and licensing after the MVP (D-018). Built the local database: `app/electron/db/` (migration 1, repository with gapless bill numbers, daily summaries, scrypt PINs), Electron IPC + preload bridge, and a store that loads from and saves to SQLite (browser mode keeps mock data). Pay and cancel are transactional and not optimistic. 21 database tests; end-to-end restart test in real Electron passed. Logged D-019 to D-021, resolved O-2, updated TRD §2 and §9. |
| 2026-10-21 | Claude (Code) | Built the first-run setup wizard (4 steps with validation) and `completeSetup` transaction. Added migration 2 (`active` on tables and categories), table management in Settings, and category rename/remove on the Menu screen. Sample restaurant is now an opt-in link. 9 new database tests (40 total); two end-to-end Electron runs passed. Logged D-022, superseded D-021, added PRD S-6 and S-7, updated TRD §2.2 to §2.3. |
| 2026-10-21 | Claude (Code) | Owner approved driver-based printing (D-023). Built `receipt-html.ts` (one HTML layout for preview and paper, escaped), `electron/print.cjs` (hidden sandboxed window, silent print, system dialog, PDF), IPC + preload, printer settings in the database (`app_meta`), `usePrinting` helper, Settings → Printing page, real KOT printing (new items only), print status and retry on the bill-complete page, and reprint from History. Fixed two bugs found by testing: print functions threw synchronously instead of rejecting, and the page height was measured as the window height. Fixed a toast timer that hid new errors. 24 new unit tests (64 total); a 24-check Electron end-to-end flow passed. Not tested on real thermal hardware. |
| 2026-10-21 | Claude (Code) | Owner shared the vendor-console Stitch export and paused the restaurant app. Built the **Vendor Console**: Supabase migrations (schema, 18 vendor functions, activate/check-in functions, security, two-factor enforced in the database), `portal/` (9 screens, CSV export, demo mode running the same SQL in PGlite), and 64 tests plus a 36-check Electron run. Bugs found and fixed by testing: a half-stored upload batch, fractional amounts crashing instead of returning a clean error, a wrong `FOUND` check on device lookup, monthly licenses showing "expiring" for their whole life (D-028), overlapping chart labels. Logged D-024 to D-030, O-5/O-7, PRD §5.8, TRD §7. Not done: real Supabase hookup, Edge Functions, restaurant-app integration. |
