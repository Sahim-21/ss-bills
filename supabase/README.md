# SS Bills: Supabase backend

The central, vendor-side database. It holds **restaurants, licenses, terminals, payments, and daily sales
summaries only**. Restaurants' bills never leave their PCs. See [docs/TRD.md](../docs/TRD.md) §7.

## What is here

| File | What it does |
|---|---|
| `migrations/…0001_core.sql` | Tables, plans (seeded), settings, license state rules |
| `migrations/…0002_vendor_actions.sql` | Everything the vendor team can **change** (create client, renew, suspend, reset terminal, plans, team) |
| `migrations/…0003_vendor_reports.sql` | Everything the portal **reads** (overview, clients, licenses, insights, activity) |
| `migrations/…0004_device_api.sql` | `license_activate` and `license_checkin`, called by the restaurant app through Edge Functions |
| `migrations/…0005_security.sql` | Row level security and grants. Locks everything down |

## How access works (read this before changing anything)

- **Nothing is readable or writable directly.** `anon` and `authenticated` have no table privileges. Row level
  security is on with no policies.
- The **portal** (a signed-in vendor admin) can only call the `vendor_*` functions. Each one re-checks that the caller
  is on the vendor team, and that the login passed **two-factor** (`require_mfa` setting). Support staff are refused
  the super-admin actions (create client, suspend, plans, team, terminal limits).
- The **restaurant app** can only reach `license_activate` / `license_checkin`, and only through an Edge Function
  that uses the service role. (The Edge Functions are not written yet. See docs/PROGRESS.md.)
- The activity log (`license_events`) is **append-only**: a trigger blocks updates and deletes.
- Adding a table? Enable row level security on it and add no policy. Add a function for any access it needs.

## Set it up (one time)

1. Create a project at https://supabase.com (the free plan is enough to start). Pick the **Mumbai (ap-south-1)** region.
2. **Run the migrations in order.** Either paste each file from `migrations/` into *SQL Editor → New query* and run it, or use
   the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`.
3. **Check two-factor is on:** *Authentication → Providers → Multi-Factor* (TOTP) must be enabled (it is by default).
4. **Create your login:** *Authentication → Users → Add user*, with your email and a strong password.
5. **Make yourself the first super admin.** In the SQL Editor run (with your email):

   ```sql
   insert into public.vendor_admins (user_id, name, role)
   select id, 'Your Name', 'super_admin' from auth.users where email = 'you@example.com';
   ```

   Later team members are added from the console (Settings → Vendor team) after you create their login the same way.
6. **Connect the portal.** Copy `portal/.env.example` to `portal/.env.local` and fill in your project's URL and **anon**
   key (*Project settings → API*). Never put the `service_role` key in the portal.
7. Build and host the portal anywhere that serves static files: `cd portal && npm run build`, then upload `portal/out/`.
8. On first sign-in you scan a QR code with an authenticator app (Google Authenticator, Authy, …).

## Tests

The migrations are tested against a real Postgres (PGlite) without needing a Supabase project:

```bash
cd portal
npm test
```

`portal/sql/vendor.test.ts` covers permissions, onboarding, renewals, terminals, check-in validation, reports and the
audit log. `portal/sql/demo-seed.test.ts` and `demo-api.test.ts` cover the browser demo.

## Changing the database

Never edit a migration that has been applied to a real project. Add a new numbered file instead, and add a test.
