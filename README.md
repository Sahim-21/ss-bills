# SS Bills

Offline-first restaurant billing software with GST support, thermal-printer receipts,
menu management, reports, and central license and daily-summary sync via Supabase.

**Status:** The restaurant app works end to end with a local SQLite database. Printing, backup and licensing are next. See [docs/PROGRESS.md](docs/PROGRESS.md).

## Run it

```bash
cd app
npm install
npm run electron:dev
```

`npm run dev` runs the UI in a normal browser at http://localhost:3000.
The first launch runs a setup wizard (or choose the sample restaurant, whose PINs are Admin `1234`, Cashier `1111`). Data is saved in `%APPDATA%\ss-bills\ssbills.db`.

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
- [docs/UI_DESIGN.md](docs/UI_DESIGN.md): UI/UX direction, Stitch prompts, and design-to-code mapping
- [supabase/README.md](supabase/README.md): central backend and how to connect it
