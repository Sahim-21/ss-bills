# SS Bills — Progress Tracker

**Last updated:** 2026-10-21

## Current status

**The database is live and the licensing and backup code is built; the Edge Functions still need to be deployed by the owner.**

- **Supabase project `ss-bills`** (ref `yjvyxjrafeenyovxzzpi`, Sydney): migrations 1 to 5 applied and verified on 2026-10-21 (3 plans, 19 `vendor_*` functions, RLS on every table, no access for `anon`/`authenticated` beyond those functions). **Migration 6 (`rate_limit`) was applied on 2026-10-21** (verified: RLS on all 10 tables, no table access for `anon`/`authenticated`, `rate_limit_hit` executable only by `service_role` and the owner).
- **Edge Functions `activate` and `sync` are deployed** (seen live on 2026-10-21 by the owner's deploy; smoke-tested with curl: unknown key gives 404 `invalid_key`, bad body 400, GET 405; the signing secret is set, since requests would fail otherwise). Source in `supabase/functions/`, steps in `supabase/README.md`. The signing key pair exists in `supabase/.secrets/` (private, git-ignored: **back it up, never replace it once apps are installed**); the public key and project URL are in `app/electron/license-config.json`.
- **Restaurant app, new on 2026-10-21:** licence activation (shown before the setup wizard), signed licence answers verified on every read, daily summary upload, 7-day offline grace, lock of new bills (suspended / expired / offline too long), top-bar chip and banners; real backup and restore (manual, daily automatic, folder or USB, safety copy before a restore); wrong-PIN lockout. A fresh install **must now be activated**; set `SSBILLS_LICENSE=off` to skip that during development.
- **Installer and updates (2026-10-21):** `npm run dist` builds a working NSIS installer (tested: silent install, packaged app starts, enforces licensing, ignores dev env overrides, blocks navigation, clean uninstall that keeps data). **Unsigned** until the owner buys a certificate. Auto-update is built but **off** until `updateUrl` is set (O-8). Updates keep a pre-migration copy of the database and refuse newer data.
- **Key regeneration** built and applied to the live project (migration 7, console button on the client page).
- **Vendor Console** works against the real project once the owner has signed in with their own login (the `vendor_admins` row and `portal/.env.local` are done by the owner).

**Checks, 2026-10-21:** `app/`: 131 tests, lint, types, build. `portal/`: 85 tests (new: Edge Function logic against the real migrations), lint, types, build. Electron end-to-end with a fake licence server signing with the real key: 23 checks (activation first, wrong key, setup, licence page, sale uploaded as a summary with top item, suspension locks billing but not history, unlock, backup file, restore with safety copy). Earlier end-to-end flows (setup wizard, printing, console) were not re-run: their scripts need `SSBILLS_LICENSE=off` now.

**Open questions:** O-4 (off-site backup: local/USB/synced-folder is built), O-5 (confirm plan prices), O-7 (hosting and Supabase plan).

## Next steps (in order)

0. ~~Apply migration 8 and deploy the `menu` function~~ Done on 2026-10-25 (owner approved) and checked live (see the session log). **Still to do:** update the privacy notice / terms before the first customer (the menu and settings are now stored in the cloud; the Task 8 draft is not written yet). One test menu copy for `ZZ Test Restaurant` (two `LIVE-CHECK` items) remains in the live `menu_snapshots` table; it is harmless and is replaced by the next save.
1. ~~Deploy the Edge Functions~~ Done. **Still unverified:** a *successful* activation and sync against the live project (needs a real client key from the console), so the signed-answer path has not run on Supabase yet.
2. **Owner + agent:** real end-to-end test: create a client in the console, activate the restaurant app with its key, sell, "Sync now", and see the PC and the day's sales in the console. Then suspend the client and confirm the app locks at the next sync.
3. **Owner:** get a code-signing certificate and choose where updates live (O-8), then set `updateUrl` and build the first customer installer (docs/RELEASING.md).
4. **Owner:** try the restaurant app with a real thermal printer; confirm plans and prices (O-5); decide hosting (O-7); host `portal/out`.
5. Restaurant app backlog: Windows installer and code signing, auto-update, CSP, history pagination, real best-sellers for non-today report ranges, an off-site backup option (O-4).
6. Later: payment gateway (Razorpay), invoices, regional roles, anything in the "left out" lists (UI_DESIGN.md).

## Task 4 and Task 5 results (2026-10-25)

**Task 4, live end-to-end licensing: done and observed.** Against the real project, with a dedicated test client `ZZ Test Restaurant` (`CL-TES-0001`, Monthly, 1 terminal) and an isolated test database: wrong key refused; real key activated (signed answer verified by the app; `activated` event with the PC id; terminals 1 of 1); one ₹105.00 cash sale synced and matched on every field in the console (sales, bills, cancelled, GST ₹5.00, cash split, top item); suspension reached the app at the next sync and refused payment while History/Reports/Dashboard stayed open (confirmed by an automated check of displayed content, 26 checks); reactivation unlocked billing and bill 000002 was made. The owner confirmed everything behaved as planned. Not independently re-verified on the server: the upload of the second sale (the console session had expired). **Permanent records now in the live project:** the test client, 5 log events (created, key replaced, activated, suspended `TEST`, reactivated), a daily summary for 2026-10-25. Finding: the red "Billing is paused" banner stays on screen across pages until dismissed (cosmetic; fix proposed, not done).

**Task 5, backups: tooling built and proven locally; the first real backup still needs the owner.** `supabase/scripts/backup.ps1`, `restore-test.ps1` and `docs/BACKUP.md`. Proven against a throw-away Postgres built from the real migrations plus data made through the real functions: backup, then restore into a fresh server, 18 checks pass; three negative tests (damaged dump, wrong counts, not a backup) fail as they must. **Not yet run against the live project** (needs the database password). Findings: the direct DB host is IPv6-only and unreachable from this PC (use the session pooler); the dump's `CREATE SCHEMA public` and the `vendor_admins` rows must be skipped on restore; installed apps bake in the project URL, so a recovery into a new project needs a stable address (O-9).

## Known gaps (as of 2026-10-21, most serious first)

1. **The success path has not run on real Supabase.** Deployed and the error paths answer correctly, but signing a real activation (Deno Ed25519 with the real secret) is only proven by the end-to-end test with a real client key.
2. **One central point of failure.** If Supabase is down or the free project is paused for more than 7 days, every restaurant locks. Needs the Pro plan (O-7) and ideally a longer grace for outages.
3. **The central database has no automatic backup on the free plan.** Tooling now exists (BACKUP.md) but **no real backup has been taken yet**: the owner must run `backup.ps1` with the database password, then `restore-test.ps1`. And O-9 (stable project address) is undecided.
4. **Installer exists but is unsigned, and no update folder is chosen** (O-8). Handing it out now means a SmartScreen warning, and installed apps cannot update until `updateUrl` is set in the first installer.
5. **No real-hardware printing check** (thermal printer) and no review of the receipt against GST invoice rules.
6. **TOTP sign-in against the live project is untested.** If enrolment fails the owner is locked out of the console (recovery: set `require_mfa` to 0 in `app_settings`, sign in, fix, set it back to 1).
7. ~~No key regeneration~~ Built (D-037). Still no self-service for the restaurant to reset a PC.
8. **Licence is not tamper-proof against a determined user with file access** (they can edit the local "last check-in"; the signed status itself cannot be forged). A cracked or patched app is not defended.
9. **No Content-Security-Policy** on the app pages; no off-site backup (O-4); history list is not paginated; best-sellers for non-today report ranges are estimates; a PIN lockout can be triggered on another user by wrong guesses (accepted).
10. **Non-code:** terms and a privacy notice that tell restaurants their daily totals are uploaded; a support process for moved PCs and lost keys; a plan for the signing-key backup.

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
- [x] Supabase project created (owner) and migrations 1-5 applied (2026-10-21, `ss-bills`, Sydney)
- [x] Edge Functions `activate`, `sync` written and tested, with rate limits and signed answers (migration 6) (2026-10-21)
- [x] Migration 6 applied to the real project (2026-10-21)
- [x] Functions deployed and `LICENSE_SIGNING_KEY` secret set (confirmed 2026-10-21)
- [x] L-1 to L-3 in the restaurant app: activation screen, daily upload, offline grace, lock (2026-10-21)
- [ ] L-4 monthly view in the console from real uploaded data (works from `daily_summary`; needs the live end-to-end test)
- [x] Wrong-PIN lockout (D-034)
- [x] Backup and restore, manual and automatic (S-5, D-035)

### Phase 9: Shipping
- [x] Windows installer (electron-builder, NSIS), icon, silent-install and uninstall tested (D-038)
- [x] Auto-update client (off until `updateUrl` is set), database safety on update (D-039)
- [ ] Code-signing certificate and a first signed release (owner, O-8)
- [ ] Choose and set up the update folder (owner, O-8)

### Phase 8: Vendor Console
- [x] Database: schema, vendor functions, device functions, security, 48 tests (`supabase/migrations/`, `portal/sql/`)
- [x] Portal scaffold, demo mode (same SQL in PGlite), sign-in with two-factor (V-1)
- [x] Overview, clients, client detail (V-2 to V-4)
- [x] Onboard, renew, suspend, reactivate, reset terminal, audit log (V-5 to V-8, V-11)
- [x] Licenses view, sales insights, settings (V-9, V-10, V-12)
- [x] Key regeneration: migration 7, console button, tests, applied (D-037)
- [ ] Verify real TOTP sign-in against the live project (owner signs in; `.env.local` is in place)
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
| 2026-10-21 | Claude (Code) | Applied migrations 1-5 to the owner's empty Supabase project `ss-bills` (ref `yjvyxjrafeenyovxzzpi`, Sydney) through the SQL Editor, each pasted file checked by SHA-256 against the repo. Verified: 3 plans, 6 settings, 19 `vendor_*` functions, 9/9 tables with RLS, 0 table grants and 0 function grants for `anon`/`authenticated` beyond the 19 vendor functions, `license_activate`/`license_checkin` executable by `service_role` only. Owner still to do: auth settings (no public sign-ups, TOTP on), first admin user + `vendor_admins` row, `portal/.env.local`, hosting. |
| 2026-10-21 | Claude (Code) | Applied migrations 1-5 to the owner's empty Supabase project through the SQL Editor (each file checked by SHA-256; verified RLS, grants, function counts). Then closed the critical gaps at the owner's request: **Edge Functions** `activate`/`sync` with Ed25519-signed answers, rate limits (migration 6) and hidden error details, tested against the real migrations (16 tests); **restaurant-app licensing** (activation before setup, machine ID, signed status re-verified on every read, daily summary upload with top item, offline grace, lock of `saveOpenBill`/`payBill`, chip and banners, real Licence page); **backup and restore** (`VACUUM INTO`, daily automatic with 30 kept, folder or USB, validated restore with safety copy and restart); **wrong-PIN lockout**. Fixed on the way: the owner's `.env.local` had `/rest/v1/` on the URL and was saved as `.env.local.txt`; the top-bar chip lagged a minute behind a sync; the "could not be saved, check the disk" banner would have wrongly appeared for a licence lock; portal tests ran out of memory with five PGlite files at once (now capped at 2 workers). Logged D-031 to D-035, updated TRD §7 and §8, PRD, supabase README. Later the same day an audit found and fixed two holes in the new code (D-036: the env overrides worked in installed apps too, and the check-in time used the PC clock) and hardened the window (no navigation, no permission prompts). Migration 6 was applied later the same day, and the leftover `supabase/setup-all.sql` was deleted. Not done: deploying the functions (needs the owner's CLI login), key regeneration. |
| 2026-10-21 | Claude (Code) | At the owner's request built **key regeneration** (migration 7 `vendor_regenerate_key`, super admin, reason required, audit event with only key tails; console "Replace this key" button; 5 database tests; the app shows "replaced or removed, enter the new key" and recovers when the new key is entered, tested) and the **installer**: electron-builder NSIS config, generated icon (.ico written without an image tool after the converter ran out of memory), build-time packages moved to devDependencies (installer 117 MB), `electron-updater` wrapper (`updates.cjs`, 6 tests, off until `updateUrl`), pre-migration database copy and refusal of newer data (3 tests, and a leaked database handle on a failed open was fixed), start-up error dialog, version and update state on the Licence page, `docs/RELEASING.md`. Verified the real packaged app and a silent install/uninstall of the installer in a temp folder (all checks passed; data folder untouched). Found and fixed: Supabase's own error replies also carry a `code`, so the app now shows server messages only when `ok === false` with a code (a platform error page now reads "not available right now"). Applied migration 7 to the live project and verified. Logged D-037 to D-039 and O-8. Not done: signing (needs a certificate), update hosting (owner's choice). |
| 2026-10-21 | Claude (Code) | Investigated the owner's report that `activate` answered `400 bad_request` to `curl.exe -d '{"key":...}'`. **Root cause: not a server bug.** Windows PowerShell 5.1 strips the inner double quotes of the argument, so the body that arrived was `{key:0000-...,machineId:test}`, which is not JSON; the function correctly refused it. Proven by sending that exact mangled body (400) versus the same request quoted correctly, from a file, or via `Invoke-RestMethod` (all 404 `invalid_key`; `Invoke-RestMethod` throws on any 4xx, which is why it looked like an error). Only change: body parsing moved into the tested `parseJsonBody` (`_shared/handler.ts`) and a non-JSON body now says "The request body is not valid JSON" (same 400 and `bad_request` code, so no contract change). 8 new tests drive the raw request text through parsing and both handlers against the real migrations (malformed/mangled/empty JSON, non-object JSON, missing fields, optional `deviceName`/`appVersion`, sync summaries, size limit, signed sync answer). Redeployed `activate` and `sync` with the CLI (already linked to the project; secrets untouched) and smoke-tested live. Added a PowerShell tip to `supabase/README.md`. Still unproven on the live project: a **successful** activation and sync (needs a real client key; a test client cannot be created or cleaned up without the owner's console login, and the activity log is append-only). |
| 2026-10-25 | Claude (Code) | Completed **Task 4** live with the owner (see "Task 4 and Task 5 results"): activation, sync with exact comparison, suspension and reactivation against the real project, using a dedicated test client and an isolated database; two moments to record honestly: the owner pressed Create, Suspend and Reactivate in the console pane themselves, and a screenshot of the new-client screen exposed the test key to the assistant (screenshot deleted, key replaced through the new Replace-key feature, which also proved it live). Built **Task 5**: `backup.ps1`, `restore-test.ps1`, `docs/BACKUP.md`, proven on a throw-away Postgres. Found and fixed along the way: Windows PowerShell 5.1 treats any stderr text from a program as an error (native calls wrapped), `Start-Process -Wait` and captured pipes both hang when starting a background server, a variable named `$keep` collided with the `-Keep` switch (PowerShell names are case-insensitive), and the dump's `CREATE SCHEMA public` breaks any restore into a project that already has the schema. Added `app/scripts/run-isolated-test.ps1` (prints its checks, refuses to reuse an existing test database, removes the licensing dev switches). Logged D-040 and O-9. Not done: the real backup (needs the database password), the Task 6 to 8 items, the banner fix. |
| 2026-10-25 | Claude (Code) | Owner asked how a PC that never syncs could dodge a suspension and approved the fix (**D-041**). Answered from the code: a manual suspension reaches a PC only when it next checks in, but normal non-payment locks offline by the signed expiry date plus 7 days, and a PC that never checks in locks 7 days after its last good check-in. Implemented: background check-in at start, at every login (`license:touch`, throttled to once per 5 minutes, never blocks) and hourly (was 6 hourly); **last check-in time now taken from the signed answer** (editing the database or the stored time no longer helps; the clock cannot run before the last signed answer). Grace stays 7 days (owner's decision). 14 new tests (50 licence tests, 145 app tests) and the Electron end-to-end now 27 checks, all passing. Also answered: menus live only on the PC's local database (not in Supabase); moving to a new PC works through Backup, then Restore from a file; **finding:** the licence allows N terminals but each PC has its own separate database and the bill-number prefix is fixed, so two counters would issue duplicate bill numbers (flagged to the owner, decision pending). Owner asked for the menu to be stored in Supabase: analysed and recorded as **O-10**, awaiting scope approval. |
| 2026-10-25 | Claude (Code) | Built the three approved changes. **(1) One PC per licence (D-042):** migration 8 sets every plan to 1 terminal; the console warns when a client's limit is raised above 1; tests that need several PCs now ask for them. **(2) Cloud copy of menu and settings (D-043):** `menu_snapshots` + `license_menu_put`/`get` (service role only, bound PC, active licence, strict shape, newest 10 kept), new `menu` Edge Function (signed restore answers, rate limits), app side `snapshot.cjs`, upload after check-ins and a minute after menu changes, restore in the setup wizard (new Admin and PIN; staff, PINs and bills are never in the copy), Backup screen card. **(3) Menu CSV import and export (D-044):** parse (comma/semicolon/tab, quotes, Excel's three encodings), strict all-or-nothing check with line numbers, preview then apply by token, never deletes, export protects formula cells; Menu screen dialog. Verification: app 251 tests (was 145), portal 125 (was 93), lint and types clean in both; Electron end-to-end across three runs against a fake cloud signing with the real key: **PC 1** (activate, set up, import 3 items, export, save to cloud) 18/18, **PC 2** (a brand-new database found the copy, restored menu, prices, availability, GST, profile and tables with a new Admin; the old PIN is useless; no bills came across) 18/18, **tampered answer** (altered after signing) refused with a clear message and nothing written 5/5; the earlier licence end-to-end still 27/27. **Not done:** migration 8 and the `menu` function are NOT yet applied/deployed to the live project (awaiting the owner); not yet tested against the real Supabase; the privacy notice has not been updated. |
| 2026-10-25 | Claude (Code) | Owner approved applying migration 8 and deploying the `menu` function. The dashboard session had expired, so the SQL was run with `supabase db query --linked` (the CLI's existing login, no password) inside one transaction, after a read-only look at the state (no menu table; plans lifetime=5, monthly=1, yearly=3). **Verified live afterwards:** all plans at 1 terminal; `menu_snapshots` exists with row level security; no table access for `anon`/`authenticated`; `license_menu_put`/`get` executable by `postgres` and `service_role` only; helper functions not exposed; all 11 tables have RLS; the test client's limit unchanged. Deployed `menu` only (v1, `verify_jwt` off); `activate` and `sync` keep their earlier, compatible build of the shared code. Live smoke tests of every error path of `menu` passed. **Real end-to-end with no fakes**, using the ZZ test client's licence (key read inside the script, never printed) and two brand-new local databases: PC A activated, set up, imported a 2-item labelled CSV and saved to the real cloud; the stored copy was inspected in the live database (1 copy, 1556 bytes, exactly the 7 agreed fields, correct items and prices, no sensitive words, 8 tables); PC B activated, the wizard found the copy, and restoring gave the right items, prices, availability, short codes, GST, profile and 8 tables with a new Admin, no bills, and the old PIN useless (all checks pass; one of my checks looked at the wrong category and was confirmed correct from a screenshot). Live data afterwards: still 1 terminal, 5 audit events (saving a menu writes none), 1 payment-free client, 1 menu copy, plans all at 1. Housekeeping: a PIN-lockout unit test left a temp folder behind on every run (35 found); fixed and cleared. |
| 2026-10-25 | Claude (Code) | **Task 7 (hosting and pricing).** Chose Cloudflare Pages static hosting (D-045). Added `portal/public/_headers` (CSP, no framing, HSTS, noindex), `robots.txt`, `.node-version` (22) and the build guard `scripts/check-env.mjs` (tested: missing vars, `/rest/v1/` URL both stop a hosted build). Verified a hosted-mode build: live mode, no `service_role`/signing key/`sb_secret_` key in `portal/out/`, only JWT is role `anon`; full git history scanned for secrets and big files: clean. Served it with the real headers: no CSP violations, Supabase reachable, other hosts blocked. Wrote `docs/HOSTING.md` and `docs/PRICING.md` (prices stay placeholders, O-5; changes affect only future payments and renewals). **Owner still has to:** create the Cloudflare account/project, set the two env vars, set Supabase Auth Site URL, add Cloudflare Access. |
