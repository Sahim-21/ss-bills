# Backing up and restoring the central database (Supabase)

This is about the **vendor side** only: licences, clients, payments, daily sales summaries and the activity log, all in your Supabase project.
(A restaurant's own bills are backed up by the restaurant app on its own PC, see TRD §8.)

**Why it matters.** If this database is lost, you lose every licence key, every payment record and the audit log. Restaurant apps keep working
offline for 7 days and then lock, and you could not tell who had paid. On Supabase's **free plan there are no automatic backups**, so until you choose
to pay for a plan that has them, **these scripts are your only backup**.

Decisions behind this: D-040 and open question O-9 in [DECISIONS.md](DECISIONS.md).

## What is and is not in a backup

| Included | Not included (on purpose) |
|---|---|
| Everything in the `public` schema: all 10 tables, their data, the functions, row level security, grants, the append-only log trigger | **Supabase Auth**: the console logins, their passwords and authenticator (2FA) secrets. Keeping password hashes and 2FA secrets out of backup files makes a stolen backup much less dangerous |
| A list of console team members (name, role, login email, no secrets) in `manifest.json`, so logins can be re-created | **Edge Function code and secrets**: the code is in git; the signing key is in `supabase/.secrets/` (back that up separately, see below) |
| Checksums of every file and row counts per table, to prove a restore is complete | Supabase dashboard settings (MFA on, sign-ups off): see the checklist in "Restoring for real" |

**A backup file is sensitive.** It holds licence keys, client names, phones, emails and payment records. Store it only on an encrypted drive or folder (for example a
BitLocker-protected USB stick). Never email it, never put it in git, never put it on an unencrypted cloud folder.

## What you need (one time)

| Need | Where it is |
|---|---|
| PostgreSQL client tools (`pg_dump`, `pg_restore`, `psql`) | Already installed on this PC: `C:\Program Files\PostgreSQL\18\bin`. A newer `pg_dump` can read Supabase's Postgres 17. Other PC? Install PostgreSQL 17 or 18 and choose only "Command Line Tools" |
| The **database password** | Supabase dashboard → project `ss-bills` → Project Settings → Database. It is the password you chose when creating the project. If you do not remember it, use "Reset database password" there. In this project **nothing else uses that password** (the Edge Functions use the service-role key, the console uses the anon key and a user login), so resetting it breaks nothing in SS Bills |
| The project's connection address | Already saved by the Supabase CLI in `supabase/.temp/pooler-url`. The scripts read it. It is the **session pooler** (`aws-0-ap-southeast-2.pooler.supabase.com`, port 5432, user `postgres.yjvyxjrafeenyovxzzpi`) |

**Why the pooler, not the "direct" address:** the direct address `db.<ref>.supabase.co` is **IPv6-only**, and most home and office networks (including this PC's) cannot reach it. The pooler works on every network.
If you ever see "connection timed out" with the direct address, this is why.

## Making a backup

Run in PowerShell, from anywhere:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\sahim\Projects\SS Bills\supabase\scripts\backup.ps1"
```

1. It asks **"Database password for postgres.yjvyxjrafeenyovxzzpi (typing is hidden)"**. Type the password and press Enter. It is kept only while the script runs and is never written anywhere.
2. It prints the server, the tool version and the server version, then **"Backup complete."** with the folder, e.g. `C:\Users\<you>\SS-Bills-Backups\supabase\ssbills-2026-11-01_101500`.
3. Inside that folder:

| File | What it is |
|---|---|
| `public.dump` | The real backup (compressed, restorable with `pg_restore`) |
| `schema.sql` | The same structure as readable text, for humans |
| `manifest.json` | When, from where, row counts per table (taken before and after the dump), file checksums, the console team list |

The script **only reads** from your database. It cannot change or delete anything on Supabase.

**If it fails:**

| Message | Meaning and fix |
|---|---|
| `password authentication failed` | Wrong password. Retype it, or reset it in the dashboard |
| `Tenant or user not found` | The user name is wrong. It must be `postgres.yjvyxjrafeenyovxzzpi` (with the project ref). Run `npx supabase link --project-ref yjvyxjrafeenyovxzzpi` again so the saved address is fresh |
| `connection timed out` | You are using the IPv6-only direct address. Let the script use the pooler (do not pass `-DbHost` yourself) |
| `No tables found in schema public` | Wrong database or project |
| `Missing ...pg_dump.exe` | Install the PostgreSQL client tools or pass `-PgBin "<folder>"` |

### How often, and where to keep them
- **Weekly**, and **always before** you apply a new migration, deploy a function change, or do anything unusual (renaming, bulk edits).
- Keep the **newest 8 weekly** backups plus **one per month for a year**. Delete older ones.
- Keep **two copies in two places**: this PC and an encrypted USB stick or another computer. A backup on the same disk as the original protects against nothing but mistakes.
- Also keep a safe copy of `supabase\.secrets\license-signing.key` (it is the one thing a database backup cannot recreate; see AGENTS.md).

## Proving a backup works (do this after your first backup, then monthly)

A backup you have never restored is a hope, not a backup. This test restores into a **brand-new, temporary database on your PC** and never touches Supabase or any existing database:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\sahim\Projects\SS Bills\supabase\scripts\restore-test.ps1" -Backup "C:\Users\sahim\SS-Bills-Backups\supabase\ssbills-2026-11-01_101500"
```

(Use your real folder name.) It takes about a minute. What it does, and what you must see:

1. Checks every file against the checksums in `manifest.json`. A changed or damaged file stops here with **CHECKSUM MISMATCH**.
2. Starts a private temporary server on port 54329 (no password, local only).
3. Restores exactly the way a real recovery must (see below), then recreates the console team from the manifest.
4. Prints **PASS** for every table's row count, row level security on every table, no table access for the public roles, the `vendor_*` functions, the device functions, the append-only log, the foreign keys, and that the licence rules actually run.
5. Ends with **`RESTORE TEST PASSED`** (exit code 0) and deletes the temporary server and files. **Any FAIL** ends with `RESTORE TEST FAILED` and a non-zero exit code: do not trust that backup, make a new one and tell whoever maintains this project.

## Restoring for real (disaster recovery)

**Read this whole section first. Do not restore into a project that already holds data.** A restore into the live project would fail on existing objects or, worse, duplicate rows.
Recover into a **new, empty** Supabase project. (Recovering "in place" means first deleting everything in the live project's `public` schema; do not do that unless you are certain the data is lost.)

> **Important: the project address is baked into installed apps** (`apiUrl` in `app/electron/license-config.json`). A new project has a **new address**, so installed restaurant
> apps would keep calling the dead one. This is open question **O-9** and must be settled before the first customer: use a Supabase **custom domain** as the stable address,
> or accept that a recovery needs an app update (apps stay usable for 7 days offline, then lock until updated). Until O-9 is decided, assume a recovery means shipping a new app version.

1. **Create a new Supabase project** (same region), and note its reference, the database password and its address (Project Settings → Database → Connection string → *Session pooler*).
2. **Dashboard settings** (they are not part of a backup): Authentication → disable "Allow new users to sign up"; enable TOTP multi-factor.
3. **Re-create the console logins.** Open the backup's `manifest.json` and look at `vendorAdmins`. For each person: Authentication → Users → Add user (their email, a new password). They set up their authenticator app again at first sign-in.
4. **Prepare the restore list**, which leaves out the `public` schema itself (the new project already has it) and the old team rows (they point at logins that no longer exist):

```powershell
$bin  = "C:\Program Files\PostgreSQL\18\bin"
$dump = "C:\Users\sahim\SS-Bills-Backups\supabase\ssbills-2026-11-01_101500\public.dump"
$list = & "$bin\pg_restore.exe" --list $dump | Where-Object { $_ -and ($_ -notmatch "\sSCHEMA\s(-\s)?public\s") -and ($_ -notmatch "\sTABLE DATA\spublic\svendor_admins\s") }
Set-Content "$env:TEMP\restore.list" $list -Encoding ASCII
```

5. **Restore into the NEW project** in three sections. Replace `<NEWREF>` and the host with the new project's values; you will be asked for nothing, so set the password first for this window only:

```powershell
$env:PGPASSWORD = "<new project's database password>"
$env:PGSSLMODE  = "require"
$target = @("-h", "aws-0-ap-southeast-2.pooler.supabase.com", "-p", "5432", "-U", "postgres.<NEWREF>", "-d", "postgres", "--no-password", "--no-owner", "-L", "$env:TEMP\restore.list", "--exit-on-error")
& "$bin\pg_restore.exe" @target --section=pre-data  $dump
& "$bin\pg_restore.exe" @target --section=data      $dump
& "$bin\pg_restore.exe" @target --section=post-data $dump
Remove-Item Env:PGPASSWORD
```

   Each command must finish without an error message. If one fails, stop: nothing is half-trusted until all three succeed. Fix the cause (usually a wrong host or password) and start again on a **fresh** project, because a partly restored project is not clean.
6. **Re-create the team rows.** In the new project's SQL Editor, for each person in the manifest (the logins from step 3 must exist):

```sql
insert into public.vendor_admins (user_id, name, role)
select id, 'Their Name', 'super_admin'   -- or 'support', exactly as in the manifest
from auth.users where email = 'their@email';
```

7. **Re-deploy the Edge Functions with the SAME signing key.** `npx supabase link --project-ref <NEWREF>`, then `npx supabase secrets set LICENSE_SIGNING_KEY="..."` using the key from your backed-up copy of `license-signing.key` (**never generate a new one**: installed apps only trust the old one), then `npx supabase functions deploy activate` and `sync`.
8. **Point everything at the new address:** `portal/.env.local` (URL and anon key), and for the restaurant apps see the O-9 note above.
9. **Check:** sign in to the console; the client count and recent activity match `manifest.json`; open one client and confirm its terminals and last check-in; have one real restaurant press "Sync now" and watch the check-in time update.
10. Make a **fresh backup** of the recovered project straight away.

## Options that cost money (not done; your decision)

- **Supabase Pro plan** (roughly US$25 a month; check Supabase's current pricing page): daily automatic backups kept for a few days, and no pausing for inactivity. Point-in-Time Recovery and a **custom domain** (which would settle O-9) are paid add-ons.
  These scripts remain useful on Pro (they give you a copy you control, outside Supabase).
- Nothing in this repository upgrades, buys or enables anything automatically.

## Quick reference

| I want to… | Run |
|---|---|
| Make a backup | `backup.ps1` (asks for the database password) |
| Prove a backup works | `restore-test.ps1 -Backup <folder>` |
| Restore for real | the numbered steps above, into a **new** project |
| See what a backup contains | open `manifest.json`; `schema.sql` is the readable structure |
