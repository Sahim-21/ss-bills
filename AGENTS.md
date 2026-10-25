# AGENTS.md — Start Here

This file is the entry point for **any** AI agent or developer working on SS Bills
(Claude, Copilot, Cursor, Codex, a human, etc.). Read it fully before doing anything.

## What this project is

**SS Bills** is offline-first billing software for restaurants (India, GST). Each
restaurant's full billing data lives on its own PC in SQLite. A central Supabase
project (owned by us) holds only restaurant licenses and daily sales summaries.

## Read these, in this order

| File | What it holds | When to read |
|---|---|---|
| [docs/PROGRESS.md](docs/PROGRESS.md) | Current status, what's done, what's next, session log | **Always first** |
| [docs/PRD.md](docs/PRD.md) | Product requirements: features, scope, phases | Before building any feature |
| [docs/TRD.md](docs/TRD.md) | Technical design: stack, architecture, schemas, flows | Before writing code |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Every decision made (and open questions) with reasons | Before changing direction |
| [docs/UI_DESIGN.md](docs/UI_DESIGN.md) | UI/UX direction, Stitch AI prompts, screen checklist, what was left out | Before building any screen |
| [supabase/README.md](supabase/README.md) | Central backend: tables, access rules, set-up steps | Before touching the database or the portal |
| [docs/HOSTING.md](docs/HOSTING.md) | Putting the Vendor Console on Cloudflare Pages: settings, headers, owner steps | Before hosting the portal |
| [docs/PRICING.md](docs/PRICING.md) | Where plan prices live and what a change does to existing clients | Before touching prices |
| [docs/RELEASING.md](docs/RELEASING.md) | Building the installer, code signing, publishing updates, rollback | Before building or shipping a release |
| [docs/LEGAL_DRAFT.md](docs/LEGAL_DRAFT.md) | Draft terms and privacy notice, the verified data map, the owner's open legal questions | Before the first customer, or when data handling changes |
| [docs/BACKUP.md](docs/BACKUP.md) | Backing up and restoring the central Supabase database, the restore test, disaster recovery | Before touching migrations on the live project, or when asked about backups |

## Rules for keeping context up to date (mandatory)

The project owner switches between agents. These docs are the **only** shared memory,
so keeping them current is part of every task, not optional.

1. **End of every working session:** update `docs/PROGRESS.md`:
   tick finished items, update "Current status" and "Next steps", and add a dated
   entry to the session log (date, agent, what changed).
2. **A decision is made** (by the owner, or agreed with them): add it to
   `docs/DECISIONS.md` with date and reason. If it resolves an open question,
   move it from "Open questions" to the log.
3. **Scope or feature changes:** update `docs/PRD.md` (features, priorities, non-goals).
4. **Technical changes** (stack, schema, folder layout, flows): update `docs/TRD.md`.
5. **Never silently contradict these docs.** If the code and the docs disagree, fix
   whichever is wrong and note it in the session log.
6. Add new `.md` docs under `docs/` when a topic outgrows these files
   (e.g. `docs/SETUP.md`, `docs/PRINTING.md`), and link them from this table.
7. Use absolute dates (`2026-10-21`), never "today" or "last week".

## The code

The restaurant app lives in `app/`: **Next.js 16** (App Router, static export) inside **Electron**.
`app/AGENTS.md` is written by Next.js itself. Read it: this Next.js version has breaking changes,
and its docs ship in `app/node_modules/next/dist/docs/`.

Run these from `app/`:

| Command | What it does |
|---|---|
| `npm run dev` | UI in a browser at http://localhost:3000 |
| `npm run electron:dev` | The desktop app (Electron) on the dev server |
| `npm run build` | Static export to `app/out/` |
| `npm run electron:start` | Build, then run the production desktop app |
| `npm run dist` | Build the Windows installer into `app/dist/` (see docs/RELEASING.md) |
| `npm run dist:dir` | Build only the unpacked app (quick packaged-app test) |
| `npm test` / `npm run lint` / `npm run typecheck` | Checks. All must pass before you finish |

Sample-restaurant PINs (only if you pick the sample on the setup screen): Admin **1234**, Cashiers **1111** / **2222**.

**Data:** the desktop app stores everything in `%APPDATA%\ss-bills\ssbills.db` (SQLite). Delete that file to
start over: the setup wizard runs again (it also offers a sample restaurant). Set env `SSBILLS_DB` to use a different file (handy for testing). `npm run dev`
in a plain browser has no database and uses throwaway mock data.

**Printing rules:** receipts and kitchen tickets are HTML from `app/src/lib/receipt-html.ts`; the on-screen preview and the
paper copy must keep coming from that one file. Escape every piece of user text (`esc`). Printing goes through the Windows
printer driver in `app/electron/print.cjs` (D-023). The renderer never chooses a file path for PDFs.

**Licensing and backup (main process):** `app/electron/license*.cjs` (rules in `license-logic.cjs`), `backup.cjs`,
`machine-id.cjs`; config in `app/electron/license-config.json` (project URL + the **public** signing key). A fresh install must
be activated; set env `SSBILLS_LICENSE=off` to skip licence checks while developing or running old test scripts. `SSBILLS_API_URL`
points the app at another server (tests use a fake one). `SSBILLS_BACKUP_DIR` overrides the backup folder. **Never change or
regenerate the signing key pair once apps are installed** (D-031). The UI reaches these only through `window.ssbills.license` /
`.backup`; it never supplies file paths or talks to the network.

**Menu copy and CSV (main process):** `snapshot.cjs` (the cloud copy: build, hash, strict check), `menu-csv.cjs` (CSV parse, check, plan, export), `menu-service.cjs` (the only door: dialogs, tokens, restore). The copy never holds bills, staff or PINs (D-043); an import never deletes (D-044). The screen never supplies paths, rows or a menu copy.

**Releases:** every release needs a higher `version` in `app/package.json`; a packaged app ignores `SSBILLS_LICENSE` / `SSBILLS_API_URL`; updates are checked from `updateUrl` in `license-config.json` and installed only when the app is closed. Read docs/RELEASING.md first.

**Database rules:** the schema is in `app/electron/db/schema.cjs`. Never edit a released migration; add a new one.
Bill numbers are assigned by the database, never by the UI. Changes to `electron/db/` need tests in `db.test.ts`.

## The vendor side (`portal/` and `supabase/`)

The **Vendor Console** is a separate Next.js app in `portal/` (also read `portal/node_modules/next/dist/docs/` first).
Its backend is the SQL in `supabase/migrations/`. Run from `portal/`:

| Command | What it does |
|---|---|
| `npm run dev` | Console at http://localhost:3100. With no `.env.local` it runs the **browser demo**: sign in with the pre-filled email, any password, code `123456` |
| `npm test` | 125 tests: the migrations and the Edge Function logic against a real Postgres (PGlite), the demo adapter, CSV. No Supabase needed |
| `npm run typecheck` / `npm run lint` / `npm run build` | Checks and the static export (`portal/out/`) |

**Rules for the vendor side:**
- Every privileged action is a `vendor_*` database function that re-checks who is calling. **Never** give `anon` or `authenticated` table access, and never put the `service_role` key in the portal.
- Migrations are numbered and **never edited once applied to a real project**. Add a new one and a test in `portal/sql/`.
- `npm run dev/build/test` copy the migrations into the demo bundle automatically, so the demo runs the same SQL as production.
- New table? Enable row level security, add no policy, and expose access only through a function.
- Setting up a real Supabase project is the owner's job; the steps are in `supabase/README.md`. The Edge Functions (`supabase/functions/`, shared logic in `_shared/handler.ts`, no Deno imports there so tests can run it) are deployed by the owner with the Supabase CLI; the private signing key lives only in `supabase/.secrets/` and as a Supabase secret, never in git.

## Working conventions

- Do not change product scope without the owner's agreement; propose it and record it.
- Money is stored as integer **paise**, never floating point (see TRD).
- Bills are never hard-deleted; they are cancelled and kept for audit.
- Billing must keep working with no internet. Anything online (license check,
  summary sync) must fail gracefully and retry later.
