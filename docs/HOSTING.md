# Hosting the Vendor Console (Cloudflare Pages)

The console (`portal/`) is a **static site** (Next.js `output: "export"`, folder `portal/out/`). It has no server of its own: the browser talks straight to Supabase, and every privileged action is a `vendor_*` database function that re-checks who is calling. So the right Cloudflare product is **Cloudflare Pages** (static assets). No Workers, no server functions, no `wrangler.toml` is needed.

## What is already in the repo

| File | Purpose |
|---|---|
| `portal/public/_headers` | Security headers sent by Cloudflare: strict Content-Security-Policy (the page may only talk to itself and the SS Bills Supabase project), no framing, no referrer, HSTS, `noindex` |
| `portal/public/robots.txt` | Asks search engines not to index the console |
| `portal/.node-version` | Node 22 for the Cloudflare build |
| `portal/scripts/check-env.mjs` | Runs before every build. On Cloudflare (or with `PORTAL_REQUIRE_LIVE=1`) the build **fails** if the two Supabase values are missing, so the browser demo can never be published by accident. It also fails if the key is a `service_role` or secret key, or the URL has a path such as `/rest/v1/` |

If the Supabase project address ever changes, update the `connect-src` host in `portal/public/_headers` too, or the console will stop connecting.

## What the browser can and cannot see

Only two values go into the site, both public by design: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the anon/publishable key). Checked on 2026-10-25 against a hosted-mode production build: no private signing key, no `service_role`, no `sb_secret_` key in `portal/out/`; the only JWT in the bundle has role `anon`; git history contains none of these either. The private licence signing key lives only in `supabase/.secrets/` and as the Supabase secret `LICENSE_SIGNING_KEY`. **Never put the service_role key, the signing key or the database password in Cloudflare variables that start with `NEXT_PUBLIC_`.** Do not put them in Cloudflare at all.

## Owner steps (Cloudflare account)

Needs your Cloudflare login, so these are yours.

1. Create a free Cloudflare account. Workers & Pages → Create → Pages → **Connect to Git** and pick the private GitHub repo (or **Upload assets** with the contents of `portal/out/` if you prefer no Git link).
2. Build settings (Git route):
   - Root directory: `portal`
   - Build command: `npm run build`
   - Build output directory: `out`
   - Environment variables (Production): `NEXT_PUBLIC_SUPABASE_URL` = `https://<ref>.supabase.co` (no path), `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the anon/publishable key.
   The build copies `../supabase/migrations`, so keep the whole repository connected, not only the `portal` folder. (Cloudflare sets `CF_PAGES=1`, which switches the build guard on.)
3. After the first deploy you get `https://<name>.pages.dev`. In Supabase → Authentication → URL Configuration set **Site URL** to that address and add it under Redirect URLs.
4. **Strongly recommended:** put the console behind **Cloudflare Access** (Zero Trust, free for up to 50 users): allow only your email. Then the login page is not even reachable by strangers, on top of password + authenticator code.
5. Optional later: a custom domain (also helps O-9, a stable address for the apps).

For a Git-less route, from `portal/`: `CF_PAGES=1 npm run build`, then upload `out/` in the dashboard.

## Verified locally

A hosted-mode build was served with the real `_headers` policy: the login page loaded in live mode (not demo), with no policy violations, the Supabase address was reachable, and a request to any other site was blocked.

## Not done / needs the owner

- The Cloudflare account, connection and Access policy (steps above).
- Supabase Auth URL settings (step 3).
- Real prices are not set (see `docs/PRICING.md`).
