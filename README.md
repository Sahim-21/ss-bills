# SS Bills

Offline-first restaurant billing software with GST support, thermal-printer receipts,
menu management, reports, and central license and daily-summary sync via Supabase.

**Status:** The restaurant app works end to end with a local SQLite database, printing, backup and restore, and licence activation with offline grace. The vendor console and Supabase backend are built; the Edge Functions are written and waiting to be deployed. See [docs/PROGRESS.md](docs/PROGRESS.md).

## Run it

```bash
cd app
npm install
npm run electron:dev
```

`npm run dev` runs the UI in a normal browser at http://localhost:3000.
The first launch asks for a licence key (set `SSBILLS_LICENSE=off` to skip that while developing), then runs a setup wizard (or choose the sample restaurant, whose PINs are Admin `1234`, Cashier `1111`). Data is saved in `%APPDATA%\ss-bills\ssbills.db`.

## Build the installer

```bash
cd app
npm run dist     # app/dist/SS Bills Setup X.Y.Z.exe (Windows 64-bit)
```

See [docs/RELEASING.md](docs/RELEASING.md) for code signing and publishing updates.

## Vendor Console

The web console for the SS Bills team (clients, licenses, renewals, sales). It runs in a demo mode with sample data until
a Supabase project is connected.

```bash
cd portal
npm install
npm run dev        # http://localhost:3100  (press Continue, then code 123456)
```

See [supabase/README.md](supabase/README.md) to connect a real project.

## Documentation

- [AGENTS.md](AGENTS.md): start here (for agents and developers)
- [docs/PRD.md](docs/PRD.md): product requirements
- [docs/TRD.md](docs/TRD.md): technical requirements and design
- [docs/PROGRESS.md](docs/PROGRESS.md): progress tracker and session log
- [docs/DECISIONS.md](docs/DECISIONS.md): decision log and open questions
- [docs/RELEASING.md](docs/RELEASING.md): installer, code signing, updates
- [docs/UI_DESIGN.md](docs/UI_DESIGN.md): UI/UX direction, Stitch prompts, and design-to-code mapping
- [supabase/README.md](supabase/README.md): central backend and how to connect it
