# Proves that a backup made by backup.ps1 can really be restored, WITHOUT touching Supabase or any existing database.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File supabase\scripts\restore-test.ps1 -Backup <ssbills-... folder>
#
# It creates a brand-new, throw-away PostgreSQL server in a temporary folder (own port, no password, localhost only), restores
# the backup into it, compares every table's row count with the manifest, checks the security set-up came back (row level
# security on, no table access for the public roles, the vendor_* functions present), then deletes the server again.
# Nothing is ever restored into Supabase by this script. Restoring for real is a deliberate manual step (docs/BACKUP.md).
param(
  [Parameter(Mandatory = $true)][string]$Backup,
  [int]$Port = 54329,
  [string]$PgBin = "C:\Program Files\PostgreSQL\18\bin",
  [switch]$Keep   # leave the test server running and its folder in place for inspection (you must stop and delete it yourself)
)

$ErrorActionPreference = "Stop"
$bin = $PgBin
foreach ($t in "initdb", "pg_ctl", "pg_restore", "psql") { if (-not (Test-Path (Join-Path $bin "$t.exe"))) { throw "Missing $t.exe in $bin" } }
$dump = Join-Path $Backup "public.dump"
$manifestFile = Join-Path $Backup "manifest.json"
if (-not (Test-Path $dump) -or -not (Test-Path $manifestFile)) { throw "$Backup is not a backup folder (needs public.dump and manifest.json)." }
$manifest = Get-Content $manifestFile -Raw | ConvertFrom-Json

# 0. Is the backup itself intact? (Checksums were written at backup time.)
Write-Host ""
Write-Host "=== Restore test ===" -ForegroundColor Cyan
Write-Host "backup  : $Backup  (made $($manifest.createdAt))"
$bad = @()
foreach ($f in $manifest.files) {
  $actual = (Get-FileHash (Join-Path $Backup $f.name) -Algorithm SHA256).Hash
  if ($actual -ne $f.sha256) { $bad += $f.name }
}
if ($bad.Count -gt 0) { throw "CHECKSUM MISMATCH for: $($bad -join ', '). The backup is damaged or was changed. Do not use it." }
Write-Host "checksums match the manifest" -ForegroundColor Green

if ((Test-NetConnection 127.0.0.1 -Port $Port -WarningAction SilentlyContinue).TcpTestSucceeded) { throw "Port $Port is already in use. Pass another -Port." }

$root = Join-Path $env:TEMP ("ssbills-restore-test-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$data = Join-Path $root "data"
$log = Join-Path $root "server.log"
New-Item -ItemType Directory -Force $root | Out-Null
$started = $false
$failures = New-Object System.Collections.Generic.List[string]

function Run([string]$exe, [string[]]$a) {
  # Windows PowerShell 5.1 turns any stderr text from a program into an error under Stop; only the exit code should decide.
  $old = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { $o = & $exe @a 2>&1 } finally { $ErrorActionPreference = $old }
  return [pscustomobject]@{ Code = $LASTEXITCODE; Out = (($o | ForEach-Object { "$_" }) -join "`n") }
}
function Q([string]$sql, [string]$db = "restore_test") {
  $r = Run (Join-Path $bin "psql.exe") @("-h", "127.0.0.1", "-p", "$Port", "-U", "postgres", "-d", $db, "--no-password", "-At", "-v", "ON_ERROR_STOP=1", "-c", $sql)
  if ($r.Code -ne 0) { throw "psql failed: $($r.Out)" }
  return $r.Out.Trim()
}
function Check([string]$name, [bool]$ok, [string]$detail = "") {
  if ($ok) { Write-Host ("  PASS  {0}  {1}" -f $name, $detail) -ForegroundColor Green }
  else { Write-Host ("  FAIL  {0}  {1}" -f $name, $detail) -ForegroundColor Red; $failures.Add($name) }
}

try {
  # 1. A private, throw-away server.
  $r = Run (Join-Path $bin "initdb.exe") @("-D", $data, "-U", "postgres", "--auth=trust", "--encoding=UTF8", "--locale=C")
  if ($r.Code -ne 0) { throw "initdb failed: $($r.Out)" }
  # Started in a hidden process, NOT through a captured pipe: the server keeps running in the background, and a pipe it
  # inherited would make this script wait for it forever.
  $argLine = "-D `"$data`" -o `"-p $Port -c listen_addresses=127.0.0.1`" -l `"$log`" -w start"
  # (No -Wait either: Start-Process -Wait also waits for the server it launched, which never ends. Poll until it answers.)
  Start-Process -FilePath (Join-Path $bin "pg_ctl.exe") -ArgumentList $argLine -WindowStyle Hidden | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
    Start-Sleep -Milliseconds 500
    $ready = ((Run (Join-Path $bin "pg_isready.exe") @("-h", "127.0.0.1", "-p", "$Port")).Code -eq 0)
  }
  if (-not $ready) { throw "the test server did not start within 30 seconds; see $log" }
  $started = $true
  Write-Host "test server started on 127.0.0.1:$Port (temporary, no password)"
  Q "create database restore_test" "postgres" | Out-Null

  # 2. What Supabase provides and the schema relies on: the three API roles, and the auth schema with its users table.
  Q @"
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as `$`$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid `$`$;
create function auth.jwt() returns jsonb language sql stable as `$`$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb `$`$;
grant usage on schema public to anon, authenticated, service_role;
"@ | Out-Null

  # 3. Restore the way a REAL recovery has to (Supabase's own `postgres` role is not a superuser, so triggers cannot be
  #    switched off). This is exactly the recipe in docs/BACKUP.md:
  #      - skip the dump's "CREATE SCHEMA public": a fresh Supabase project already has that schema;
  #      - skip the vendor_admins rows: they point at console logins (Supabase Auth) that will not exist in a new project;
  #      - load everything with foreign keys enforced, in the three sections pg_restore supports;
  #      - afterwards re-create each console person's login and team row from the list in manifest.json.
  $restore = Join-Path $bin "pg_restore.exe"
  $listing = Run $restore @("--list", $dump)
  if ($listing.Code -ne 0) { throw "pg_restore --list failed: $($listing.Out)" }
  $listLines = $listing.Out -split "`r?`n" | Where-Object { $_ -and ($_ -notmatch "\sSCHEMA\s(-\s)?public\s") -and ($_ -notmatch "\sTABLE DATA\spublic\svendor_admins\s") }
  $listFile = Join-Path $root "restore.list"
  Set-Content -Path $listFile -Value $listLines -Encoding ASCII
  Write-Host "restore list: $(@($listLines | Where-Object { $_ -notmatch '^;' }).Count) of the dump's entries (schema 'public' and the vendor_admins rows skipped)"
  $common = @("-h", "127.0.0.1", "-p", "$Port", "-U", "postgres", "-d", "restore_test", "--no-password", "--no-owner", "-L", $listFile)
  foreach ($section in "pre-data", "data", "post-data") {
    $r = Run $restore ($common + @("--section=$section", "--exit-on-error", $dump))
    if ($r.Code -ne 0) { throw "pg_restore ($section) failed: $($r.Out)" }
    Write-Host "restored section: $section"
  }
  foreach ($a in @($manifest.vendorAdmins)) {
    if (-not $a.name) { continue }
    $nm = "$($a.name)" -replace "'", "''"
    $em = "$($a.email)" -replace "'", "''"
    Q "with u as (insert into auth.users (id, email) values (gen_random_uuid(), '$em') returning id) insert into public.vendor_admins (user_id, name, role) select id, '$nm', '$($a.role)' from u" | Out-Null
  }
  Write-Host "re-created $(@($manifest.vendorAdmins | Where-Object { $_.name }).Count) console team member(s) from the manifest"

  # 4. Did it come back correctly?
  Write-Host ""
  Write-Host "Checks:"
  foreach ($prop in $manifest.rowCountsAfter.PSObject.Properties) {
    $t = $prop.Name
    $lo = [int64]$manifest.rowCountsBefore.$t
    $hi = [int64]$manifest.rowCountsAfter.$t
    if ($lo -gt $hi) { $lo, $hi = $hi, $lo }
    $n = [int64](Q "select count(*) from public.""$t""")
    Check "rows in $t" (($n -ge $lo) -and ($n -le $hi)) "restored $n (backup saw $lo..$hi)"
  }
  $tableCount = [int](Q "select count(*) from pg_tables where schemaname='public'")
  $rlsCount = [int](Q "select count(*) from pg_tables where schemaname='public' and rowsecurity")
  Check "row level security on every table" ($tableCount -gt 0 -and $tableCount -eq $rlsCount) "$rlsCount of $tableCount"
  $grants = [int](Q "select count(*) from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')")
  Check "no table access for anon / authenticated" ($grants -eq 0) "$grants grants"
  $vendorFns = [int](Q "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'vendor\_%'")
  Check "vendor_* functions present" ($vendorFns -ge 19) "$vendorFns"
  $anonFn = [int](Q "select count(*) from information_schema.routine_privileges where routine_schema='public' and grantee='anon'")
  Check "anon can run no function" ($anonFn -eq 0) "$anonFn grants"
  $deviceFns = [int](Q "select count(*) from information_schema.routine_privileges where routine_schema='public' and grantee='service_role' and routine_name in ('license_activate','license_checkin','rate_limit_hit')")
  Check "service_role can run the device functions" ($deviceFns -ge 3) "$deviceFns of 3"
  $trigger = [int](Q "select count(*) from pg_trigger where tgname='license_events_append_only'")
  Check "activity log still append-only (trigger present)" ($trigger -eq 1)
  $fk = [int](Q "select count(*) from pg_constraint where contype='f' and connamespace='public'::regnamespace")
  Check "foreign keys restored" ($fk -ge 7) "$fk"
  # the restored database must actually WORK, not just contain rows
  $state = Q "select public.license_state('active', null, null)"
  Check "licence rules run on the restored database" ($state -eq "active") "license_state -> $state"
}
finally {
  if ($started -and -not $Keep) {
    Run (Join-Path $bin "pg_ctl.exe") @("-D", $data, "-m", "immediate", "stop") | Out-Null
  }
  if (-not $Keep) {
    Start-Sleep -Milliseconds 800
    Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    Write-Host "Kept: server on port $Port, folder $root (stop with pg_ctl -D `"$data`" stop, then delete the folder)." -ForegroundColor Yellow
  }
}

Write-Host ""
if ($failures.Count -eq 0) {
  Write-Host "RESTORE TEST PASSED: this backup restores completely and correctly." -ForegroundColor Green
  exit 0
} else {
  Write-Host "RESTORE TEST FAILED: $($failures -join '; ')" -ForegroundColor Red
  exit 1
}
