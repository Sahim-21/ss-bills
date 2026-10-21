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
| `migrations/…0007_regenerate_key.sql` | `vendor_regenerate_key`: replace a client's licence key (super admin) |
| `migrations/…0006_rate_limit.sql` | `rate_limits` table and `rate_limit_hit()` for the Edge Functions |
| `functions/activate`, `functions/sync` | Edge Functions the restaurant app calls (shared code in `functions/_shared`) |
| `config.toml` | Turns the platform JWT check off for those two functions (see D-032) |
| `scripts/make-signing-key.mjs` | Creates the key pair that signs licence answers |

## How access works (read this before changing anything)

- **Nothing is readable or writable directly.** `anon` and `authenticated` have no table privileges. Row level
  security is on with no policies.
- The **portal** (a signed-in vendor admin) can only call the `vendor_*` functions. Each one re-checks that the caller
  is on the vendor team, and that the login passed **two-factor** (`require_mfa` setting). Support staff are refused
  the super-admin actions (create client, suspend, plans, team, terminal limits).
- The **restaurant app** can only reach `license_activate` / `license_checkin`, and only through an Edge Function
  that uses the service role (`functions/activate`, `functions/sync`).
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

## Deploy the Edge Functions (one time, then after any change under `functions/`)

You need the [Supabase CLI](https://supabase.com/docs/guides/cli) (`npx supabase ...` works without installing) and a login.

1. Make sure migration `…0006_rate_limit.sql` has been run.
2. Create the signing key pair **once** (skip if `supabase/.secrets/license-signing.key` already exists):
   `node supabase/scripts/make-signing-key.mjs`. The public half is written into `app/electron/license-config.json` and ships
   in the app. **Never replace the pair once apps are installed**, or every app will reject the server. Keep a safe copy of the
   private file; it is git-ignored.
3. Log in and link: `npx supabase login` then `npx supabase link --project-ref <your-project-ref>`.
4. Give Supabase the private key as a secret:
   `npx supabase secrets set LICENSE_SIGNING_KEY="$(cat supabase/.secrets/license-signing.key)"`
   (or Dashboard → Edge Functions → Secrets, name `LICENSE_SIGNING_KEY`). Supabase supplies `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` to functions by itself.
5. Deploy: `npx supabase functions deploy activate` and `npx supabase functions deploy sync` (the `verify_jwt = false` setting
   comes from `config.toml`; if you deploy another way, pass `--no-verify-jwt`).
6. Check: in the portal create a client, copy its licence key, start the restaurant app with `SSBILLS_DB` pointing at a new
   file (to get the activation screen), activate, and watch the PC appear under the client's terminals.

The app finds the functions at `<project URL>/functions/v1/activate` and `/sync` (URL in `app/electron/license-config.json`).

## Replacing a client's licence key

Console → Clients → the client → **Replace this key** (super admin only; a reason is required). The old key stops working immediately. Give the client the new key
(it is shown on the page afterwards): on each of their PCs open Settings → License & sync and enter it under "Activate again". Their data and terminal slots are untouched.

## Testing the functions by hand (Windows PowerShell tip)

Windows PowerShell 5.1 **removes the inner double quotes** from an argument passed to `curl.exe`, so this sends broken JSON and gets
`400 "The request body is not valid JSON"`:

```powershell
curl.exe -X POST <url> -H "content-type: application/json" --data-raw '{"key":"...","machineId":"test"}'   # WRONG on PowerShell 5.1
```

Use one of these instead (an unknown key should answer `404` with `"code":"invalid_key"`):

```powershell
curl.exe -X POST <url> -H "content-type: application/json" --data-raw '{\"key\":\"0000-0000-0000-0000\",\"machineId\":\"test\"}'
# or put the JSON in a file:  --data-binary "@body.json"
# or Invoke-RestMethod (a 4xx is thrown as an exception; the JSON is in $_.Exception.Response):
$body = @{ key = "0000-0000-0000-0000"; machineId = "test" } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri <url> -ContentType "application/json" -Body $body
```

## Tests

The migrations are tested against a real Postgres (PGlite) without needing a Supabase project:

```bash
cd portal
npm test
```

`portal/sql/functions.test.ts` runs the Edge Function logic against the migrations (validation, rate limits, signed answers,
error hiding). `portal/sql/vendor.test.ts` covers permissions, onboarding, renewals, terminals, check-in validation, reports and the
audit log. `portal/sql/demo-seed.test.ts` and `demo-api.test.ts` cover the browser demo.

## Changing the database

Never edit a migration that has been applied to a real project. Add a new numbered file instead, and add a test.
