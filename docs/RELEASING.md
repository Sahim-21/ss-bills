# Releasing the restaurant app

How to turn the code into an installer a restaurant can use, and how updates reach them. Decisions behind this: D-037 to D-039
in [DECISIONS.md](DECISIONS.md); design notes in [TRD.md](TRD.md) §10.

## What you get

`npm run dist` (run in `app/`) produces, in `app/dist/`:

| File | What it is |
|---|---|
| `SS Bills Setup 0.1.0.exe` | The installer to give to a restaurant (about 117 MB, Windows 64-bit). Installs for the current Windows user, lets them pick the folder, adds Start menu and Desktop shortcuts |
| `SS Bills Setup 0.1.0.exe.blockmap` | Lets updates download only what changed |
| `latest.yml` | The "newest version" note the app reads to find updates |
| `win-unpacked/` | The same app as plain files (used for testing; not shipped) |

Uninstalling removes the program and shortcuts but **never the restaurant's data** (`%APPDATA%\ss-bills`).

## Build and test an installer (every release)

1. Make sure everything is green: `npm test`, `npm run lint`, `npm run typecheck` in `app/`.
2. Set the version in `app/package.json` (`"version": "0.2.0"`). **Every release needs a higher number**, or installed apps will not see it as an update.
3. `npm run dist`. (If it fails with "could not allocate memory", close other programs and retry: the build tools are memory hungry.)
4. Test the installer on a clean Windows PC or user account: install, activate with a real key, make a sale, print, take a backup, close and reopen. Uninstall and confirm the data folder is still there.

Quick local check without installing: `npm run dist:dir`, then run `dist\win-unpacked\SS Bills.exe`. An installed or packaged app **ignores**
`SSBILLS_LICENSE=off` and `SSBILLS_API_URL` (D-036), so it behaves exactly like a customer's copy.

## Code signing (do this before giving the installer to anyone)

An unsigned installer works, but Windows SmartScreen shows "Windows protected your PC" and customers will be afraid to click Run.
Signing needs a certificate that only you can buy (it proves who you are):

- **Azure Trusted Signing** (cheapest, about US$10 a month, needs a verifiable business identity), or
- an **OV/EV code-signing certificate** from a certificate authority (DigiCert, Sectigo, SSL.com; about US$200-500 a year; EV removes the SmartScreen warning at once, OV builds trust over time).

electron-builder signs automatically when it finds the certificate: set `CSC_LINK` (path to the `.pfx`) and `CSC_KEY_PASSWORD` in your
terminal before `npm run dist`. For Azure Trusted Signing add the `azureSignOptions` block described in the electron-builder docs. Never commit the certificate or password.
Verify with PowerShell: `Get-AuthenticodeSignature "dist\SS Bills Setup 0.2.0.exe"` should say `Valid`.

## Publishing updates

Installed apps check a web folder every 6 hours (first check a minute after start), download a newer version quietly, and **install it the next time the
app is closed**. It never restarts the app while someone is billing. Switched off until you set the folder:

1. Pick a place that serves plain files over HTTPS (open question O-8): Cloudflare Pages / R2, Netlify, GitHub Releases, or a **public bucket in your Supabase Storage**.
2. Put its address in `app/electron/license-config.json` as `"updateUrl": "https://.../ss-bills/"` (with the trailing slash). This must be in place **in the version customers
   already have**, so set it before the first installer you hand out.
3. For each release upload three files from `app/dist/` to that folder: `SS Bills Setup X.Y.Z.exe`, `SS Bills Setup X.Y.Z.exe.blockmap`, and `latest.yml` (replace the old `latest.yml`).
4. Check: on a PC with the previous version, Settings → License & sync shows "Update ready" after a while (or "Could not check for updates" with the reason in the console log).

Roll out slowly: upload to one test restaurant first by pointing a test copy at a staging folder.

## Rules that keep customers safe

- **Never change or regenerate the licence signing key** (`supabase/.secrets/`): every installed app has the public half and would reject your server (D-031).
- **Database changes ship as a new migration** in `app/electron/db/schema.cjs` (never edit an old one). On the first start after an update, the app first keeps a copy of the old
  database next to it (`ssbills.db.before-vN.bak`), then upgrades. An **older** app refuses to open data from a **newer** one (so an accidental downgrade cannot damage data) and says so.
- Removing the update folder or going offline never affects billing: update checks fail quietly and retry.
- Keep every installer you have released (a restaurant may need to reinstall an older one) together with its `latest.yml`.

## Rolling back a bad release

1. Remove the bad version's three files and put the previous release's `latest.yml` back, so no more PCs update.
2. PCs that already updated keep working. To return one to the older version, install the older installer over it only if the database schema did not change; otherwise
   publish a fixed, higher version instead. (Data written by a newer schema cannot be opened by the older app; use the `.before-vN.bak` copy or a backup if you must go back.)

## Known limits

- Windows 64-bit only. No macOS/Linux build.
- The installer is large because it carries the Electron runtime.
- Without a signing certificate, SmartScreen warns on download and first run.
