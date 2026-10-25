# Backs up the SS Bills central database (licences, clients, payments, daily summaries) to files on this PC.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File supabase\scripts\backup.ps1
#
# It only READS from the database (pg_dump). It never writes to, restores into, or changes anything on Supabase.
# The database password is never stored: set it for this window only (`$env:PGPASSWORD = "..."`), or type it when asked.
# Output: <OutDir>\ssbills-<date-time>\  with  public.dump (restorable), schema.sql (readable), manifest.json (counts + checksums).
# What is NOT included: Supabase Auth (the console logins and their authenticator apps). Re-create those after a disaster
# (see docs/BACKUP.md). Keeping password hashes and 2FA secrets out of backups is deliberate.
param(
  [string]$OutDir = (Join-Path $HOME "SS-Bills-Backups\supabase"),
  [string]$DbHost,
  [int]$Port = 0,
  [string]$User,
  [string]$Database = "postgres",
  [string]$SslMode = "require",
  [string]$PgBin = "C:\Program Files\PostgreSQL\18\bin"
)

$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")

# Where to connect: explicit parameters win, otherwise the pooler address the Supabase CLI saved when the project was linked.
# (The direct host db.<ref>.supabase.co is IPv6-only and unreachable on many home networks; the session pooler works everywhere.)
$poolerFile = Join-Path $repo "supabase\.temp\pooler-url"
if ((-not $DbHost -or -not $User -or $Port -eq 0) -and (Test-Path $poolerFile)) {
  $u = (Get-Content $poolerFile -Raw).Trim()
  if ($u -match "^postgres(?:ql)?://([^:@/]+)@([^:/]+):(\d+)/(\w+)") {
    if (-not $User) { $User = $Matches[1] }
    if (-not $DbHost) { $DbHost = $Matches[2] }
    if ($Port -eq 0) { $Port = [int]$Matches[3] }
  }
}
if (-not $DbHost -or -not $User -or $Port -eq 0) {
  throw "Could not work out where to connect. Pass -DbHost, -Port and -User, or run 'npx supabase link' first."
}

$pgDump = Join-Path $PgBin "pg_dump.exe"
$pgRestore = Join-Path $PgBin "pg_restore.exe"
$psql = Join-Path $PgBin "psql.exe"
foreach ($t in @($pgDump, $pgRestore, $psql)) { if (-not (Test-Path $t)) { throw "Missing $t. Install the PostgreSQL client tools or pass -PgBin." } }

# The password: from the environment, or typed (hidden). Kept only in this process.
$askedForPassword = $false
if (-not $env:PGPASSWORD) {
  $secure = Read-Host "Database password for $User (typing is hidden)" -AsSecureString
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  $askedForPassword = $true
}
$env:PGSSLMODE = $SslMode
$env:PGCONNECT_TIMEOUT = "20"
$conn = @("-h", $DbHost, "-p", "$Port", "-U", $User, "-d", $Database, "--no-password")

function Invoke-Native {
  param([string]$Exe, [string[]]$ArgList)
  # Windows PowerShell 5.1 turns any text a program writes to stderr into an error when $ErrorActionPreference is Stop,
  # even harmless notices. Only the program's exit code decides here.
  $old = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { $out = & $Exe @ArgList 2>&1 } finally { $ErrorActionPreference = $old }
  if ($LASTEXITCODE -ne 0) { throw "$([IO.Path]::GetFileName($Exe)) failed (exit $LASTEXITCODE): $($out -join ' ')" }
  return $out
}

try {
  Write-Host ""
  Write-Host "=== SS Bills database backup ===" -ForegroundColor Cyan
  Write-Host "server  : $DbHost`:$Port as $User (database $Database, ssl $SslMode)"
  Write-Host "tool    : $((Invoke-Native $pgDump @('--version')) -join '')"

  # 1. Can we connect, and what are we talking to?
  $serverVersion = (Invoke-Native $psql ($conn + @("-At", "-c", "show server_version"))) -join ""
  Write-Host "server version: $serverVersion"

  # 2. Row counts per table (one statement = one consistent snapshot). Taken before AND after the dump: a restaurant may
  #    sync while the dump runs, so the restored data must land between the two readings.
  $tables = @(Invoke-Native $psql ($conn + @("-At", "-c", "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1")))
  if ($tables.Count -eq 0) { throw "No tables found in schema public. Wrong database or wrong project?" }
  $countSql = ($tables | ForEach-Object { "select '$_' as t, count(*) as n from public.""$_""" }) -join " union all "
  function Get-RowCounts {
    $c = [ordered]@{}
    foreach ($line in @(Invoke-Native $psql ($conn + @("-At", "-F", "|", "-c", "$countSql order by 1")))) {
      $p = "$line".Split("|"); $c[$p[0]] = [int64]$p[1]
    }
    return $c
  }
  $countsBefore = Get-RowCounts

  # 3. The dump itself.
  $stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
  $dest = Join-Path $OutDir "ssbills-$stamp"
  New-Item -ItemType Directory -Force $dest | Out-Null
  $dumpFile = Join-Path $dest "public.dump"
  $schemaFile = Join-Path $dest "schema.sql"
  Write-Host "writing : $dest"
  Invoke-Native $pgDump ($conn + @("--format=custom", "--schema=public", "--no-owner", "--file=$dumpFile")) | Out-Null
  Invoke-Native $pgDump ($conn + @("--schema-only", "--schema=public", "--no-owner", "--file=$schemaFile")) | Out-Null

  $countsAfter = Get-RowCounts

  # Who was on the console team (names, roles, login emails; no secrets). The dump keeps vendor_admins but NOT the logins
  # they point at, so a recovery re-creates each person's login and then their team row from this list.
  $admins = @(@(Invoke-Native $psql ($conn + @("-At", "-F", "|", "-c", "select a.name, a.role, coalesce(u.email, '') from public.vendor_admins a left join auth.users u on u.id = a.user_id order by a.created_at"))) |
    Where-Object { $_ } | ForEach-Object { $q = "$_".Split("|"); [ordered]@{ name = $q[0]; role = $q[1]; email = $q[2] } })

  # 4. Is the dump readable at all? (pg_restore --list only reads the file.)
  $entries = @(Invoke-Native $pgRestore @("--list", $dumpFile) | Where-Object { $_ -and $_ -notmatch "^;" }).Count
  if ($entries -lt 20) { throw "The dump looks too small ($entries entries). Not trusting it." }

  # 5. Manifest: what was backed up, from where, and checksums to detect corruption or tampering later.
  $files = @($dumpFile, $schemaFile) | ForEach-Object {
    [ordered]@{ name = (Split-Path $_ -Leaf); bytes = (Get-Item $_).Length; sha256 = (Get-FileHash $_ -Algorithm SHA256).Hash }
  }
  $manifest = [ordered]@{
    createdAt = (Get-Date).ToString("o")
    serverVersion = $serverVersion
    pgDump = ((Invoke-Native $pgDump @("--version")) -join "")
    source = "$DbHost`:$Port"
    schemas = @("public")
    dumpEntries = $entries
    rowCountsBefore = $countsBefore
    rowCountsAfter = $countsAfter
    vendorAdmins = $admins
    files = $files
  }
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $dest "manifest.json") -Encoding UTF8

  Write-Host ""
  Write-Host "Backup complete." -ForegroundColor Green
  Write-Host "folder  : $dest"
  foreach ($f in $files) { Write-Host ("  {0,-14} {1,10:N0} bytes" -f $f.name, $f.bytes) }
  Write-Host "rows    : $(($countsAfter.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ', ')"
  Write-Host ""
  Write-Host "These files contain licence keys, client contact details and payment records." -ForegroundColor Yellow
  Write-Host "Keep them on an encrypted drive or folder. Never email them or put them in git." -ForegroundColor Yellow
}
finally {
  # never leave the password behind in this window
  if ($askedForPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  Remove-Item Env:PGSSLMODE, Env:PGCONNECT_TIMEOUT -ErrorAction SilentlyContinue
}
