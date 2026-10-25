# Launches SS Bills on a throw-away database so a licence test can never touch real restaurant data.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-isolated-test.ps1
# Licensing stays ENFORCED: the dev switches SSBILLS_LICENSE and SSBILLS_API_URL are removed for this run.
# -Resume   reopen an existing test database (for example after closing the app mid-test)
# -NoLaunch print the checks only, do not start the app
# -Name     use another test folder name (default ssbills-zz-test, under %TEMP%)
param([switch]$Resume, [switch]$NoLaunch, [string]$Name = "ssbills-zz-test")

$ErrorActionPreference = "Stop"
$test = Join-Path $env:TEMP $Name
$db = Join-Path $test "ssbills.db"
$real = Join-Path $env:APPDATA "ss-bills\ssbills.db"

New-Item -ItemType Directory -Force $test | Out-Null
Remove-Item Env:SSBILLS_LICENSE, Env:SSBILLS_API_URL -ErrorAction SilentlyContinue
$env:SSBILLS_DB = $db

$exists = Test-Path $db
$licenseSwitches = (Get-ChildItem Env: | Where-Object { $_.Name -like "SSBILLS_LICENSE*" } | Measure-Object).Count
$apiOverride = (Get-ChildItem Env: | Where-Object { $_.Name -like "SSBILLS_API_URL*" } | Measure-Object).Count

Write-Host ""
Write-Host "=== SS Bills isolated test: pre-launch checks ===" -ForegroundColor Cyan
Write-Host "DATABASE FOR THIS RUN     : $db"
Write-Host "test database already there: $exists   (a fresh test must say False)"
Write-Host "licensing switch set       : $licenseSwitches   (must be 0)"
Write-Host "API override set           : $apiOverride   (must be 0)"
Write-Host "your REAL database present : $(Test-Path $real)   ($real)"
Write-Host ""

if ($licenseSwitches -ne 0 -or $apiOverride -ne 0) {
  Write-Host "STOP: a licensing override is still set. Not launching." -ForegroundColor Red
  exit 1
}
if ($exists -and -not $Resume) {
  Write-Host "STOP: the test database already exists, so this is not a fresh start." -ForegroundColor Yellow
  Write-Host "      To continue that test, run again with -Resume. To start over, tell Claude first (nothing is deleted automatically)."
  exit 1
}
if ($NoLaunch) {
  Write-Host "Checks passed. -NoLaunch given, so the app was not started." -ForegroundColor Green
  exit 0
}

Write-Host "Checks passed. Starting SS Bills (this window stays busy while the app is open)..." -ForegroundColor Green
Set-Location (Join-Path $PSScriptRoot "..")
npx electron . "--user-data-dir=$test\profile"
Write-Host ""
Write-Host "SS Bills has closed." -ForegroundColor Cyan
