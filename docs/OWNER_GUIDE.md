# SS Bills: Owners' Guide

For the two founders. This is **not** a customer manual. It explains the whole product from the first idea to the last button: what each part does, how the parts fit together, how we run the business with it, and what is still unfinished. Written 2026-10-25 from the code and docs as they stand; where something is untested or not built, it says so.

Other docs go deeper on single topics (see section 15). If this guide and the code disagree, the code wins; please fix this guide.

## Contents

1. The big picture
2. Who and what is involved
3. The restaurant app: first run (install, activate, set up, log in)
4. The restaurant app: daily use (every screen)
5. How a bill is calculated
6. Offline behaviour and the status chip
7. Licences: how they work
8. The cloud copy of the menu
9. Backups (restaurant side and our side)
10. The Vendor Console (our side)
11. Plans and prices
12. Running the business: playbooks
13. Building, releasing and maintaining (technical)
14. Security: what protects what
15. Where everything lives, and the doc map
16. What is not finished (honest list)
17. Demo script for showing a co-founder or investor
18. Troubleshooting and FAQ
19. Glossary

---

## 1. The big picture

SS Bills is **billing software for restaurants in India**, with GST. It has two halves.

| Half | What it is | Who uses it | Where it runs |
|---|---|---|---|
| **The restaurant app** | A Windows desktop program (Electron + Next.js). Takes orders, makes GST bills, prints them, shows reports | Restaurant owner, manager, cashiers | On the restaurant's own PC |
| **The Vendor Console** | A private website. Creates clients, issues and controls licences, records payments, shows each client's daily sales | Only us (founders and any support staff) | On Cloudflare Pages, talking to Supabase |

Between them sits **one central database on Supabase** (project `ss-bills`, region Sydney). It holds only: clients and their licences, which PC is linked to which licence, payments we record by hand, one row of totals per restaurant per day, a copy of each restaurant's menu and settings, and an audit log. **It never holds a restaurant's bills.**

Three design promises run through everything:

1. **Offline first.** Billing never needs the internet. A restaurant keeps billing through a power cut or a dead router. The internet is used only to check the licence and to upload daily totals, and both fail quietly and retry later.
2. **The restaurant's data is the restaurant's.** Every bill, customer detail, staff PIN and printer setting lives in a database file on their PC and nowhere else. We cannot read it and cannot recover it. (That is a selling point and a support risk; section 9.)
3. **We control the licence, not the bills.** We can suspend, renew, move or replace a licence and see daily totals. We cannot see or change a bill.

```
Restaurant PC                          Our side
┌──────────────────────┐   internet    ┌──────────────────────────────┐
│ SS Bills app         │ ───────────►  │ Supabase                     │
│  local SQLite (ALL   │  licence check│  licences, PCs, payments,    │
│  bills live here)    │  daily totals │  daily totals, menu copy,    │
└──────────────────────┘  menu copy    │  audit log                   │
                                       └──────────────▲───────────────┘
                                                      │ sign-in + MFA
                                       ┌──────────────┴───────────────┐
                                       │ Vendor Console (website)     │
                                       └──────────────────────────────┘
```

## 2. Who and what is involved

**People (roles in the restaurant app)**

| Role | Can do |
|---|---|
| **Admin** (owner or manager) | Everything: menu and prices, settings, staff, reports, cancel bills, backup and restore |
| **Cashier** | Take orders, hold bills, settle payment, print and reprint, see history |

Only Admins see Dashboard, Reports, Menu and Settings in the left bar.

**People (roles in the Vendor Console)**

| Role | Can do |
|---|---|
| **Super admin** | Everything, including onboarding clients, suspending, editing plans and prices, changing a client's terminal limit, replacing keys and managing the team |
| **Support** | View everything, renew, reset a terminal binding, edit client details. Cannot onboard, suspend, edit plans, manage the team or change terminal limits |

**Accounts and places**

| Thing | Where |
|---|---|
| Code | Private GitHub repo `Sahim-21/ss-bills`, branch `main` |
| Central database and functions | Supabase project `ss-bills`, ref `yjvyxjrafeenyovxzzpi` (free plan, see section 16) |
| Console website | Cloudflare Pages, built from the repo's `portal/` folder |
| Licence signing key (private) | `supabase/.secrets/license-signing.key` on the owner's PC, plus the Supabase secret `LICENSE_SIGNING_KEY`. **Never in git, never in chat** |
| Installer | built locally into `app/dist/` |

## 3. The restaurant app: first run

### 3.1 Installing

Give the restaurant the installer `SS Bills Setup 0.1.0.exe` (about 117 MB, Windows 64-bit). It is a normal wizard: pick a folder, it adds Start menu and Desktop shortcuts, and installs for the current Windows user. **Uninstalling never deletes the restaurant's data** (`%APPDATA%\ss-bills\ssbills.db`).

Until we buy a code-signing certificate the installer is **unsigned**, so Windows SmartScreen shows "Windows protected your PC". Click **More info → Run anyway**. Fine for a demo, not for customers (section 16).

### 3.2 Activation (needs internet, once)

The first screen is **Activate your license**. Four boxes take the 16-character key (`XXXX-XXXX-XXXX-XXXX`); a pasted key spreads across the boxes. Press **Activate & start billing**.

What happens: the app sends the key, an identifier of this PC, the PC's name and the app version to our `activate` function. If the key is valid, not suspended, not expired past grace, and a PC slot is free, the server binds this PC to the licence and returns a **digitally signed** answer (plan, expiry, state). The app checks the signature with the public key built into it. A wrong key, or a reply that was altered, is refused with a plain message.

Rules to remember:
- **One PC per licence** (decision D-042). A second PC is refused with a "device limit" message until we reset the first one in the console.
- Activation is needed only once per PC. After that the app works offline.
- Activation happens **before** the setup wizard. Nothing works without it in a real install.

### 3.3 The setup wizard (first run of a brand-new PC)

Appears when the database is empty. Steps: restaurant details (name, address, phone, GSTIN, FSSAI), GST rate (5% is the usual default for standalone restaurants), the first **Admin** (name and a 4-digit PIN, entered twice), starter categories, and the number of tables. **Finish setup** creates everything in one go, or nothing.

Two shortcuts live here:
- **Sample restaurant**: fills in a demo restaurant with a menu and staff (Admin PIN **1234**, Cashiers **1111** and **2222**). Good for demos, never for a real restaurant.
- **"We found your saved menu"**: shown if this licence has a saved cloud copy. Click **Restore my menu**, choose a new Admin name and PIN, and the menu, categories, tables, GST and receipt settings come back (section 8). Bills, staff and old PINs never come back.

### 3.4 Logging in and the PIN

Everyone logs in by choosing their name and typing their PIN (keyboard digits work; Backspace deletes; Esc clears). PINs are stored only as salted hashes; the screen never receives them.

**Lockout:** 5 wrong PINs in a row, then a lockout that doubles each further miss (2, 4, 8, then 15 minutes at most). This stops guessing a 4-digit PIN. A side effect we accepted: someone can lock another person out by guessing wrongly on their name.

A successful login also quietly triggers a licence check-in in the background (never blocks the login). The lock icon on the left bar switches user.

## 4. The restaurant app: daily use

The left bar has: **Billing, Tables, History** (everyone) and **Dashboard, Reports, Menu, Settings** (Admin only). The top shows the restaurant, the user, an online/offline dot and, when needed, a licence chip (section 6).

### 4.1 Billing (the main screen)

Left: the **menu grid** with category tabs and a search box. Right: the **current bill**.

- **Add an item:** click it. Click again to raise the quantity. Plus/minus and remove are on the bill.
- **Search:** press **F2** and type part of a name or a **short code** (for example `PBM` for Paneer Butter Masala). Short codes make fast ordering.
- **Order type:** Dine-in, Takeaway or Delivery. Dine-in needs a **table**.
- **Availability:** items marked unavailable in the Menu screen cannot be added.
- **Hold bill:** saves the running bill (for a table, say) and clears the screen. Held bills survive closing the app, and appear under Tables and as held bills; reopen one to add more items.
- **KOT (kitchen order ticket):** prints only the **new** items since the last KOT, big type, no prices, and marks them "KOT sent" only if the print succeeded. If printing fails, the items stay unsent so nothing is lost.
- **Settle:** press **F9** or the pay button. Choose **Cash (1)**, **UPI (2)** or **Card (3)** with those keys, and **Enter** to confirm and print. One payment method per bill; split payment is not built.

Paying is all-or-nothing: the bill number is assigned inside the same database transaction as the payment. If saving fails, nothing is charged and the bill stays open. Double-clicking cannot create two bills.

Paying while the licence is locked is refused (section 7).

### 4.2 After payment

The **complete** screen shows the receipt exactly as it will print (the on-screen preview and the paper copy come from the same code). Options: print, save as **PDF**, or start the next bill.

Receipt contents: logo (initials), header text, GSTIN and FSSAI, bill number, date, order type and table, items (with a veg/non-veg mark), subtotal, service charge if enabled, CGST, SGST, round-off, total, payment method, footer, SAC code. A reprint says **DUPLICATE**; a cancelled bill says **CANCELLED**.

### 4.3 Tables

Shows the tables and which have an open bill; pick one to continue its bill. Tables are managed in Settings → Tables.

### 4.4 History

All previous bills (the last 62 days are loaded; older ones stay in the database). **Search** by bill number, date, table or amount. Open a bill to see its details, **reprint** it (marked DUPLICATE), or, as an **Admin**, **cancel** it. Cancelling needs a reason (Wrong items punched, Customer walked out, Duplicate bill, or Other); the bill is **kept** for audit, keeps its number, and the number is never reused. **Bills are never deleted.**

### 4.5 Dashboard and Reports (Admin)

**Dashboard:** today's sales, bills today (and how many are held right now), average bill with GST collected, cancelled bills, the payment split (cash/UPI/card), best-selling items and the held bills. **Reports:** choose Today, This month or a custom date range; see sales, the cash/UPI/card split, tax, and best-selling items. (Best-sellers for ranges other than today are estimates; section 16.)

### 4.6 Menu (Admin)

- Add, edit and remove items: name, category, price, veg or non-veg, **short code**, available or not.
- **Price changes never alter old bills**: every bill stores the name and price as sold.
- Deleting an item that was used on past bills just hides it.
- Categories: add, rename, remove (only when empty).
- **Import / Export (CSV)**, for typing a first menu in Excel or Google Sheets:
  - **Export** gives a CSV of the menu (cells starting with `= + - @` are protected from running as formulas).
  - **Import** reads a CSV (comma, semicolon or tab separated; Excel's UTF-8, plain CSV or UTF-16). It shows a **preview** first. It is **all or nothing**: one bad row refuses the whole file and tells you the line numbers. It **never deletes** anything. It matches existing items by category + name (ignoring case) and updates their price/flags instead of duplicating them.

Changing the menu triggers a cloud copy about a minute later (section 8).

### 4.7 Settings (Admin)

| Page | What it does |
|---|---|
| **Restaurant profile** | Name, tagline, address, phone, GSTIN, FSSAI, HSN/SAC; printed on every bill |
| **GST & tax** | GST rate, whether menu prices **include** tax, optional **service charge** (off by default; see 5) |
| **Receipt** | Header and footer text, logo on/off, paper width (58 or 80 mm) |
| **Printing** | Choose the receipt printer and the kitchen printer from the Windows printers; test buttons. "Ask every time" opens the Windows print dialog |
| **Staff** | Add, edit, deactivate staff; set roles and PINs. The last active Admin cannot be deactivated |
| **Tables** | Add, rename, set seats, remove (not while a table has an open bill) |
| **Backup & restore** | Back up now, automatic daily backup, choose the folder (a USB drive works), restore, and the cloud menu copy card |
| **License & sync** | Plan, expiry, status, last check-in, **Sync now**, **Activate again** |

Printing is built on the Windows printer driver, so any printer with a driver works. **It has not yet been tested on a real thermal printer** (section 16). Before first use with a printer: set the driver's paper size to the roll width, turn off "fit to page", and use the test buttons.

## 5. How a bill is calculated

All money is stored as **whole paise** (₹1 = 100), never as decimals, so there are no rounding drifts.

1. Line total = price × quantity.
2. Subtotal = sum of line totals.
3. Service charge = subtotal × rate, only if enabled.
4. Tax base = subtotal + service charge.
5. **GST exclusive** (prices don't include tax): GST = base × rate. **GST inclusive** (menu prices already include it): GST is extracted, GST = base − base ÷ (1 + rate).
6. CGST = half of the GST (rounded down); SGST = the rest, so the two always add up exactly.
7. A **round-off** line brings the total to the nearest whole rupee and is printed separately.

Example (exclusive, 5%): subtotal ₹100.00 → GST ₹5.00 → CGST ₹2.50 + SGST ₹2.50 → total ₹105.00.

**Bill numbers** run in order per financial year (April–March) and are assigned by the database at payment, so there are no gaps and no duplicates. Format example: `SSB/2026-27/000123`. This matters for GST audits. It is also why **one PC per licence**: two PCs would each start at 000001 and the same numbers would repeat.

**Service charge:** consumer-protection rules in India say it must not be added by default or automatically, so it ships **off**. Check the current rules before turning it on for a customer.

The app does not give tax advice. The restaurant chooses the GST rate and is responsible for it.

## 6. Offline behaviour and the status chip

- **The online dot** (top bar): connected or offline. Offline never stops billing.
- **Check-ins** (talking to our server): about 10 seconds after the app starts, at every login, and hourly while it is open. Requests within 5 minutes of the last one are ignored. A failed check-in retries after 15 minutes. The time of the last check-in is taken from the server's signed answer, so setting the PC clock back does not help.
- **What a check-in does:** confirms the licence is still valid, uploads the daily totals, and saves the menu copy if it changed.
- **The chip** appears only when something needs attention:
  - warnings: offline 1 to 7 days, licence in its grace period, expiring soon;
  - **Billing paused** (red): locked. See next section.

## 7. Licences: how they work

### 7.1 A licence

One licence per restaurant, with a key `XXXX-XXXX-XXXX-XXXX`, a plan (Monthly, Yearly or Lifetime), an expiry date (none for lifetime), a status (active or suspended) and a terminal limit (**1** for every plan by default).

### 7.2 States (what the console shows)

`suspended` → `expired` (past grace) → `grace` (expired but within 7 days) → `expiring` (within 30 days; 7 for monthly) → `active`.

### 7.3 When the restaurant app locks new bills

New bills (saving or paying) are refused when:
- the licence is **suspended**;
- it has **expired** past the 7-day grace;
- the app was **never activated**, or its saved answer is damaged;
- it has **not checked in for more than 7 days** (offline too long);
- the server says this PC is no longer linked (`device_not_bound`) or the key is invalid, which shows **Activate again** in Settings.

Always still open: History, Reports, Dashboard, Backup, Settings. A suspension reaches the PC at its **next successful check-in**, not instantly. Before a suspension arrives, a PC that stays offline keeps billing until the 7-day rule applies. This is deliberate: a flaky internet must not stop a restaurant mid-service.

### 7.4 What a signed answer protects

The licence answer is signed with our private key. The app verifies it every time it reads it, so editing the saved file, or copying it to another PC, makes it invalid. A determined person with file access could still tamper with the local "last check-in" time or patch the app; we accept that for now (section 16).

### 7.5 Moving a restaurant to a new PC

1. In the console, open the client and **Reset the terminal** (reason required). This frees the slot.
2. On the new PC: install, activate with the same key, and at the setup screen choose **Restore my menu**.
3. Bills do not move through the cloud. Copy the restaurant's backup file from the old PC (Settings → Backup & restore → restore from a file) if they need history.

### 7.6 Lost or leaked key

Open the client in the console and use **Replace key** (super admin; reason required). The old key stops working at once; PCs already linked simply re-activate with the new key without using a slot.

## 8. The cloud copy of the menu

So a lost PC does not mean retyping the menu.

- **What is copied:** profile and receipt text, GST settings, categories, menu items and prices, table names.
- **What is never copied:** bills, held bills, staff, PINs, staff phones, printer names, licence data.
- **When:** after each good check-in, and about a minute after the menu changes. Nothing is sent if nothing changed. The newest 10 copies are kept (1 MB limit each).
- **Who can read it:** only a PC that is activated for that licence, and only while the licence is not suspended or expired. The console never shows menus.
- **Restore:** only into an empty install, from the setup wizard, creating a new Admin and PIN. The answer is signed and strictly checked before anything is written.
- The Backup screen has a **Save now** button and shows the last save or last problem.
- **The privacy notice must mention this** (docs/LEGAL_DRAFT.md does).

## 9. Backups

### 9.1 Restaurant side (the bills)

Settings → Backup & restore. **Back up now** writes a complete, consistent copy (safe while the app runs) named `ssbills_YYYY-MM-DD_HHMMSS.db` into the backup folder (default `Documents\SS Bills Backups`, changeable, a USB drive works). **Automatic daily** backups run while the app is open, keep the newest 30, and can be turned off. **Restore** checks the file is healthy and compatible, saves today's data as a `_pre-restore` copy first, replaces the database and restarts the app.

**Our promise is limited:** because bills never reach our server, a dead disk with no backup means lost bills. Tell every client to keep backups on a USB drive or a synced folder. An off-site backup option is not built (open question O-4).

### 9.2 Our side (the central database)

Scripts in `supabase/scripts/`: `backup.ps1` (dumps the database; needs the database password) and `restore-test.ps1` (restores into a throw-away local Postgres and checks it). Proven against a test database; **the first real backup has not been taken yet** (owner action, docs/BACKUP.md). The free Supabase plan has no automatic backups and pauses idle projects, so this is the biggest operational risk. Also keep an encrypted copy of the **signing key**: a database backup cannot recreate it, and losing it would mean every installed app rejects our answers.

## 10. The Vendor Console

A private website for us. Sign-in is **email + password + a 6-digit authenticator code**; the second step is enforced inside the database, not just on the page. The first sign-in enrols your authenticator by QR code. Recovery if you are locked out: set `require_mfa` to 0 in `app_settings` (Supabase SQL), sign in, fix, set it back to 1.

| Page | What it is for |
|---|---|
| **Overview** | Counts of clients, active/expiring/suspended, combined sales trend, top clients, a "needs attention" list, recent activity |
| **Clients** | The list, with filters (status, plan, city), search (name or licence key), pagination, CSV export |
| **Client detail** | Profile; the licence key (masked, copy button); PCs linked; sales for 7 or 30 days and a daily ledger; payments; the client's audit trail. Actions: edit, **Renew**, **Suspend / Reactivate**, **Reset terminal**, **Replace key** |
| **New client** | Details, plan, terminals, optional first payment, and a welcome message with the key to hand over |
| **Licenses** | Expiring, in grace, suspended or all, with a horizon; renew from a side panel |
| **Insights** | Sales across clients, this period against the last, leaderboard, payment mix, growth table, CSV export |
| **Activity** | The append-only audit log, filterable, grouped by day, with an entry inspector |
| **Settings** | Edit plans and prices (super admin) and manage the vendor team |

**The audit log is permanent.** It records who did what and when, and a database trigger blocks any edit or delete. Think before creating test clients: they stay in the log forever.

## 11. Plans and prices

Seeded placeholders (**not decided**, open question O-5): Monthly Standard ₹2,499 per 30 days, Yearly Pro ₹24,999 per 365 days, Lifetime POS ₹59,999 once; all before 18% GST. Stored in `plans.price_paise` (paise) and editable by a super admin in Console → Settings.

- Past payments never change (each payment stores its own amounts).
- Running licences are not affected (they store plan and expiry, not price).
- The next payment you record uses the price at that moment, so a renewing client pays the new price. There is no per-client price lock.
- A special agreed amount can be entered as an override on one payment (GST treated as inside it).
- Raising the terminal limit above 1 for a client works, but the console warns: **each PC keeps separate data, menus are not shared and bill numbers repeat across PCs**. A true multi-PC mode is not built.

Details: docs/PRICING.md.

## 12. Running the business: playbooks

### Sign a new client
1. Console → **New client**: restaurant details, plan, terminals (1), and the payment if they paid.
2. Copy the key and welcome message; send both with the installer.
3. They install, activate, run the wizard. Within a few minutes of their first login, the client's page should show a PC linked and (after a sale) daily totals.

### Renew
Client page → **Renew**: record the payment (method, reference, optional agreed amount, or "waived"), choose how many periods. It extends from the later of the old expiry and now. Optionally reactivates.

### A client stops paying
**Suspend** (reason required). The restaurant keeps History/Reports/Backup but cannot make new bills at its next check-in. **Reactivate** reverses it.

### New PC / PC died
Section 7.5.

### "My bills are gone"
Ask for their backup file first. If it exists, restore it (section 9.1). If no backup exists, the bills cannot be recovered by us.

### "App says Billing paused"
Open Settings → License & sync. The message names the reason (suspended, expired, offline too long, not linked). Fix it in the console, then press **Sync now**.

### Change a price
Console → Settings → edit plan (super admin). Applies to future payments only.

### Add a team member
First create their login in the Supabase dashboard (Authentication → Users → Invite). Then, as a super admin, open Console → Settings → Add a team member with the same email, a name and a role (super admin or support). Remove them from the same list when they leave.

## 13. Building, releasing and maintaining (technical)

Run from `app/` (restaurant app): `npm run dev` (UI in a browser with throwaway mock data), `npm run electron:dev`, `npm run build`, `npm run electron:start`, `npm run dist` (Windows installer into `app/dist/`), `npm run dist:dir`, and `npm test`, `npm run lint`, `npm run typecheck` (all must pass).
Run from `portal/` (console): `npm run dev` (port 3100; without `.env.local` it runs the browser **demo**, sign in with the pre-filled email, any password, code `123456`), `npm test` (125 tests against a real Postgres engine), `npm run lint`, `npm run typecheck`, `npm run build` (static export to `portal/out/`).

**Releasing the app:** raise `version` in `app/package.json` (every release needs a higher number), run the checks, `npm run dist`, test the installer on a clean PC, and sign it once we have a certificate. Updates: the app can auto-update from a folder we host (`updateUrl` in `app/electron/license-config.json`), installing only when the app is closed. **It is switched off (`updateUrl` is empty) and must be set in the very first customer installer**, because installed apps cannot learn a new address later. Details: docs/RELEASING.md.

**Releasing the console:** push to `main`; Cloudflare Pages builds `portal/` with `npm run build` and publishes `out/`. The build **fails on purpose** if the two Supabase variables are missing or the key is not the public anon key, so the demo can never be published by accident. Details: docs/HOSTING.md.

**Changing the database:** add a **new numbered migration** in `supabase/migrations/` and a test in `portal/sql/`. **Never edit a migration already applied to the live project.** Apply with the Supabase CLI. Edge Functions (`activate`, `sync`, `menu`) are in `supabase/functions/` and are deployed with the CLI.

**Where data lives on a dev PC:** `%APPDATA%\ss-bills\ssbills.db`. Set `SSBILLS_DB` to use another file. Dev switches `SSBILLS_LICENSE=off` and `SSBILLS_API_URL` work only in an unpackaged app; an installed app ignores them.

**Never change or regenerate the signing key pair once apps are installed.** Every installed app has the public half built in.

## 14. Security: what protects what

- The restaurant app never contains our secrets; only the **public** signing key.
- The console website holds only the public (anon) database key. All sensitive actions are database functions that re-check who is calling, and need a two-step sign-in. The database tables allow no direct access to the public.
- The service-role key and the signing key exist only inside Supabase and on the owner's PC.
- Licence answers are signed; menu restores are signed and strictly validated; imports and restores can never write outside the allowed fields.
- Rate limits stop key guessing (activation 20 per 10 minutes per address, check-ins and menu limits per PC and per address).
- The website sends strict browser security headers and may only talk to itself and our Supabase project.
- Audit log is append-only.
- Recommended next layer: Cloudflare Access in front of the console (only our emails can even reach the login page).

## 15. Where everything lives, and the doc map

| File | Purpose |
|---|---|
| docs/PROGRESS.md | Status and the dated session log; read first |
| docs/PRD.md | Features and scope |
| docs/TRD.md | Technical design |
| docs/DECISIONS.md | Every decision (D-numbers) and open questions (O-numbers) |
| docs/UI_DESIGN.md | Design direction and the screens left out |
| docs/RELEASING.md | Installer, signing, updates, rollback |
| docs/HOSTING.md | Cloudflare Pages setup |
| docs/PRICING.md | How prices work and what changes affect |
| docs/BACKUP.md | Central database backups and disaster recovery |
| docs/LEGAL_DRAFT.md | Draft terms and privacy notice and the data map |
| supabase/README.md | Central backend set-up |

## 16. What is not finished (honest list)

**Before the first paying customer**
1. **Code-signing certificate** (SmartScreen warning otherwise) and a place to host updates; `updateUrl` set in the first installer (O-8).
2. **Real backup of the central database** taken and restore-tested; decide the Supabase plan. On the free plan the project can pause after inactivity and has no automatic backups; if Supabase is down for more than 7 days every restaurant locks (O-7).
3. **A stable project address** (a custom domain) so a future recovery does not break installed apps (O-9).
4. **Real-printer test.** Printing is built and tested only with fake printers (task 6 deferred).
5. **Terms and privacy** reviewed by a lawyer and the OWNER placeholders filled (docs/LEGAL_DRAFT.md). The app does not yet ask clients to accept terms.
6. **Prices** decided (O-5) and `Cloudflare Access` switched on for the console.
7. **Back up the signing key** to an encrypted place.

**Known limitations**
- One PC per licence; no shared data between PCs; no real multi-PC mode.
- No split payments; no discounts, inventory, online-order integrations, WhatsApp bills or multi-outlet (all deliberately out of scope for now).
- No off-site backup of a restaurant's bills.
- History list is not paginated; best-sellers on past ranges are estimates.
- A determined user with file access could tamper with the local clock record or patch the app.
- The red "Billing is paused" banner stays across pages until dismissed.
- Payments to us are recorded by hand; there is no payment gateway.

## 17. Demo script (about 10 minutes)

1. **Console first.** Sign in with password + authenticator. Show Overview, then **New client** (do not submit unless you mean to; it writes a permanent log entry).
2. **Install and activate** the app on the laptop with a demo key. Show the activation screen and the wizard; choose the sample restaurant (PINs 1234 / 1111 / 2222) or restore the saved menu.
3. **Billing:** F2 search `PBM`, add three items, switch to Dine-in, choose a table, show a **KOT**, then **Hold** and reopen from Tables.
4. **Pay:** F9, press 2 (UPI), Enter. Show the receipt (CGST/SGST, round-off) and Save as PDF.
5. **History:** search the bill, reprint (DUPLICATE), cancel a second test bill with a reason, and point out the number is kept.
6. **Reports / Dashboard** as Admin; **Menu → Import/Export CSV**.
7. **Back in the console:** open the client; after a login check-in the day's sales appear. Show the audit trail.
8. **The control story:** Suspend the demo client, log in again in the app and show "Billing paused" (History still works), then Reactivate. Only do this on a demo client.
9. **The safety story:** Settings → Backup & restore, Back up now, and mention the cloud menu copy.

Tip: check-ins are throttled to once per 5 minutes, so log in a few minutes before the console part, or use Settings → License & sync → Sync now.

## 18. Troubleshooting and FAQ

| Problem | What it usually means | What to do |
|---|---|---|
| Activation says "device limit" | The licence already has its one PC | Console → client → Reset terminal, then activate again |
| "Not valid JSON" / 400 when testing by command line | Quotes were stripped by PowerShell 5.1 | Use the app, or a script file |
| App shows Billing paused | Suspended, expired, offline > 7 days, or not linked | Settings → License & sync shows the reason |
| Console builds as the demo | The two Supabase variables were missing at build | The build now fails instead; set them in Cloudflare |
| Console login fails after MFA changes | MFA is enforced in the database | Section 10 recovery |
| Menu not found on a new PC | No copy saved yet, or the PC isn't activated | Check the old PC's Backup screen for the last save |
| Import refused | A row is invalid | The message lists line numbers; fix and retry |
| Print does nothing | Wrong printer selected or driver paper size | Settings → Printing → test buttons |
| Restore from backup says incompatible | The file is from a newer app version | Update the app and retry |

## 19. Glossary

**Paise**: 1/100 of a rupee; all money is stored in paise. **GST / CGST / SGST**: goods and services tax, split into the central and state halves. **GSTIN**: a business's GST number. **FSSAI**: food-safety licence number. **HSN/SAC**: tax classification code printed on bills. **KOT**: kitchen order ticket. **Held bill**: an open bill saved for later. **Licence key**: the 16-character code that activates a PC. **Terminal**: one PC linked to a licence. **Grace**: the 7 days after expiry (or offline) before billing locks. **Check-in**: the app talking to our server. **Signed answer**: the server's reply with a digital signature the app verifies. **Anon key**: the public Supabase key; safe in a browser. **Service-role key**: the powerful Supabase key; never in the app or the website. **Migration**: a numbered database change script. **Edge Function**: a small server program on Supabase (`activate`, `sync`, `menu`). **RLS**: row-level security, the database's own access control. **MFA / TOTP**: the 6-digit authenticator code. **Audit log**: the permanent record of console actions.
