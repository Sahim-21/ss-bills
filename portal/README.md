# SS Bills Console (vendor portal)

The web console for the SS Bills team: onboard restaurants, issue and renew licenses, suspend or reactivate them, reset
terminals, and see sales from the daily summaries every restaurant uploads.

Next.js (static export) talking straight to Supabase. All privileged actions are database functions
(`../supabase/migrations`). See [../supabase/README.md](../supabase/README.md) to connect a real project.

```bash
npm install
npm run dev        # http://localhost:3100  (runs the built-in demo unless .env.local is set)
npm test           # database + demo tests (real Postgres in-process, no Supabase needed)
npm run build      # static site in out/
```

**Demo mode** (no `.env.local`): the real migrations run in your browser (PGlite) with sample restaurants, stored in
IndexedDB. Sign in with the pre-filled email, any password, and code `123456`. Settings → Reset demo data rebuilds it.

Layout: `src/app/(console)/` the screens · `src/lib/api.ts` method → database function mapping ·
`src/lib/supabase-api.ts` real backend + two-factor sign-in · `src/lib/demo/` browser demo · `sql/` database tests.

`next` here is a newer version than most docs describe. Read `node_modules/next/dist/docs/` before changing Next.js code.
