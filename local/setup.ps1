<#
    Persona Intelligence - one-time local setup (Windows, PowerShell)

    Run this once. It checks what you have, starts a Postgres container,
    writes a local .env, installs dependencies, applies migrations, seeds the
    first administrator and builds a demonstration project with a completed run.

    Nothing here touches a deployed environment and nothing leaves your machine.
#>

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($n, $text) { Write-Host "`n[$n] $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "    $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    $text" -ForegroundColor Yellow }
function Die($text)  { Write-Host "`n$text`n" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- prerequisites
Step 1 'Checking what is installed'

try { $nodeVersion = (node --version) } catch {
  Die "Node.js is not on your PATH.`nInstall Node 22 LTS from https://nodejs.org, close this window, open a new PowerShell and run this script again."
}
$major = [int](($nodeVersion -replace '^v', '') -split '\.')[0]
if ($major -lt 20) { Die "Node $nodeVersion is too old. This application needs Node 20 or newer; 22 LTS is what it was built against." }
Ok "Node $nodeVersion"

$dockerOk = $false
try { docker info *> $null; if ($LASTEXITCODE -eq 0) { $dockerOk = $true } } catch { }

if ($dockerOk) {
  Ok 'Docker is running'
} else {
  Warn 'Docker is not running.'
  Warn 'Either start Docker Desktop and run this script again, or, if you already have'
  Warn 'PostgreSQL 16 installed locally, set DATABASE_URL in .env by hand and skip step 2.'
  $answer = Read-Host '    Continue without Docker and use an existing PostgreSQL? (y/N)'
  if ($answer -ne 'y') { Die 'Stopped. Start Docker Desktop, then run this script again.' }
}

# ---------------------------------------------------------------- database
Step 2 'Starting PostgreSQL'

if ($dockerOk) {
  docker compose -f "$root\local\docker-compose.yml" up -d
  if ($LASTEXITCODE -ne 0) { Die 'Docker could not start the database container. The output above says why.' }

  Write-Host '    waiting for the database to accept connections' -NoNewline
  $ready = $false
  foreach ($i in 1..40) {
    docker exec rfpi-postgres pg_isready -U postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Write-Host '.' -NoNewline
    Start-Sleep -Seconds 2
  }
  Write-Host ''
  if (-not $ready) { Die 'The database did not come up within 80 seconds. Check Docker Desktop.' }
  Ok 'PostgreSQL 16 listening on 127.0.0.1:55432'

  # The app, its shadow database and its test database.
  foreach ($db in @('rfpi_shadow', 'rfpi_test')) {
    docker exec rfpi-postgres psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='$db'" | Out-String -OutVariable exists | Out-Null
    if ($exists -notmatch '1') { docker exec rfpi-postgres createdb -U postgres $db *> $null }
  }
  Ok 'Databases rfpi, rfpi_shadow and rfpi_test ready'
} else {
  Warn 'Skipped. Make sure DATABASE_URL in .env points at your own PostgreSQL 16.'
}

# ---------------------------------------------------------------- environment
Step 3 'Writing .env'

# The Mintel databooks preloaded behind the demonstration credential. Point this somewhere else
# if the folder has moved; leave it blank and the demonstration simply starts with no data.
$mintelDir = "C:\Users\chungkai.lim\Ruder Finn Group\RFAsia AI - Documents\General\Projects\Asia_CBGA Outlook 2027\Mintel Data\Final Data"
if (-not (Test-Path -LiteralPath $mintelDir)) {
  Warn "The Mintel folder was not found at:"
  Warn "  $mintelDir"
  Warn 'The demonstration will still run, but with no data preloaded.'
  Warn 'Edit DEMO_DATASET_DIR in .env once you know the right path.'
}

$envPath = Join-Path $root '.env'
if (Test-Path $envPath) {
  # An existing .env is kept, but reconciled: a file written by an earlier version of this script
  # has no demonstration credential in it, and the sign-in endpoints are deliberately silent about
  # why a code did not work. Adding the missing keys here is the difference between "it works" and
  # an unexplainable failure at the sign-in screen.
  $envText = Get-Content $envPath -Raw
  $added = @()

  if ($envText -notmatch '(?m)^\s*DEMO_SIGN_IN_EMAIL\s*=\s*\S') {
    Add-Content $envPath "`n# Demonstration sign-in. Development only; the app refuses to start in production with these set."
    Add-Content $envPath 'DEMO_SIGN_IN_EMAIL=admin@rfcomms.com'
    $added += 'DEMO_SIGN_IN_EMAIL'
  }
  if ($envText -notmatch '(?m)^\s*DEMO_SIGN_IN_CODE\s*=\s*\S') {
    Add-Content $envPath 'DEMO_SIGN_IN_CODE=010101'
    $added += 'DEMO_SIGN_IN_CODE'
  }
  if ($envText -notmatch '(?m)^\s*DEMO_DATASET_DIR\s*=\s*\S') {
    Add-Content $envPath ('DEMO_DATASET_DIR="' + $mintelDir + '"')
    $added += 'DEMO_DATASET_DIR'
  }

  # The demo domain must be approved or no code is ever issued for that address.
  if ($envText -match '(?m)^\s*BOOTSTRAP_APPROVED_DOMAINS\s*=\s*(.*)$') {
    $domains = $Matches[1].Trim()
    if ($domains -notmatch '(^|,)\s*rfcomms\.com\s*(,|$)') {
      $merged = if ([string]::IsNullOrWhiteSpace($domains)) { 'rfcomms.com' } else { "$domains,rfcomms.com" }
      (Get-Content $envPath) -replace '^\s*BOOTSTRAP_APPROVED_DOMAINS\s*=.*$', "BOOTSTRAP_APPROVED_DOMAINS=$merged" |
        Set-Content $envPath -Encoding UTF8
      $added += 'rfcomms.com in BOOTSTRAP_APPROVED_DOMAINS'
    }
  } else {
    Add-Content $envPath 'BOOTSTRAP_APPROVED_DOMAINS=rfcomms.com'
    $added += 'BOOTSTRAP_APPROVED_DOMAINS'
  }

  if ($added.Count -eq 0) {
    Ok '.env already complete, left alone'
  } else {
    Ok ".env kept, and these were added: $($added -join ', ')"
    Warn 'Restart the app afterwards - a running dev server holds the old environment.'
  }
} else {
  # Two long random values. These are local development secrets and are not
  # shared with, or valid in, any deployed environment.
  function New-Secret {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLower()
  }

  Write-Host '    A demonstration account is always created:'
  Write-Host '        admin@rfcomms.com    code 010101' -ForegroundColor Green
  Write-Host '    You can also add your own address, which gets a random code printed'
  Write-Host '    in the terminal. Press Enter to skip that and use the demo account only.'
  $adminEmail = Read-Host '    Your email address (optional)'

  if ([string]::IsNullOrWhiteSpace($adminEmail)) {
    $bootstrapDomains = 'rfcomms.com'
    $bootstrapAdmin = 'admin@rfcomms.com'
  } else {
    $adminEmail = $adminEmail.Trim().ToLower()
    $bootstrapDomains = "rfcomms.com,$(($adminEmail -split '@')[-1])"
    $bootstrapAdmin = $adminEmail
  }

@"
# Local development only. Not committed. No real credentials.
NODE_ENV=development
APP_BASE_URL=http://localhost:3000

DATABASE_URL="postgresql://postgres:postgres@localhost:55432/rfpi"
SHADOW_DATABASE_URL="postgresql://postgres:postgres@localhost:55432/rfpi_shadow"
DATABASE_URL_TEST="postgresql://postgres:postgres@localhost:55432/rfpi_test"

SESSION_SECRET=$(New-Secret)
IP_HASH_PEPPER=$(New-Secret)

# No AI model is consulted while this is 'mock'. Every run is labelled as mock
# on screen and in every export, and no export can be released without an
# explicit written override. Set a real provider only when you mean to.
MODEL_PROVIDER=mock

# Sign-in codes are printed to the terminal running 'npm run dev'.
# This adapter refuses to start when NODE_ENV is production.
EMAIL_PROVIDER=dev

OBJECT_STORAGE_PROVIDER=local
SCAN_PROVIDER=none
QUEUE_DRIVER=postgres

BOOTSTRAP_APPROVED_DOMAINS=$bootstrapDomains
BOOTSTRAP_SUPER_ADMIN_EMAIL=$bootstrapAdmin

# Demonstration sign-in: a fixed code for one nominated address, so a demo does
# not depend on reading a terminal. The code is still salted and hashed before
# storage, still expires in 10 minutes, and is still capped at 5 attempts - it
# is simply predictable, which is why the application REFUSES TO START when
# NODE_ENV=production and either of these is set. Delete both lines to turn it off.
DEMO_SIGN_IN_EMAIL=admin@rfcomms.com
DEMO_SIGN_IN_CODE=010101

# Signing in as the demonstration account loads every Mintel databook in this folder
# through the ordinary ingest, governance and persona pipeline, so a demo does not start
# on an empty upload screen. It runs once, in the background, and takes a couple of
# minutes. Blank it out to start with no data. Refused in production.
DEMO_DATASET_DIR="$mintelDir"
"@ | Set-Content -Path $envPath -Encoding UTF8

  Ok ".env written. Administrator: $bootstrapAdmin"
  Ok 'Demonstration account: admin@rfcomms.com / 010101'
}

# ---------------------------------------------------------------- dependencies
Step 4 'Installing dependencies (a few minutes the first time)'
npm install
if ($LASTEXITCODE -ne 0) { Die 'npm install failed. The output above says why.' }
Ok 'Dependencies installed'

# ---------------------------------------------------------------- schema
Step 5 'Applying the database schema'
npx prisma generate
if ($LASTEXITCODE -ne 0) { Die 'prisma generate failed.' }
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { Die 'prisma migrate deploy failed. Is the database running?' }
Ok 'Schema applied'

Step 6 'Seeding the administrator, approved domains and demonstration account'
npm run db:seed
if ($LASTEXITCODE -ne 0) { Die 'Seed failed.' }
Ok 'Seeded'

Step 7 'Checking that sign-in will actually work'
npm run doctor
if ($LASTEXITCODE -ne 0) { Die 'The checks above found a problem. Fix it and run this script again.' }

# ---------------------------------------------------------------- done
Write-Host @"

------------------------------------------------------------------
Setup complete.

Next:  .\local\start.ps1        (starts the app and the worker)
Then:  http://localhost:3000

Sign in with:

    admin@rfcomms.com     code 010101

Any other approved address gets a random code, printed in the terminal
running start.ps1 - no email provider is configured locally.

To create the demonstration project with a completed run, leave
start.ps1 running and, in a second PowerShell window:

    npx tsx scripts\walkthrough4.ts

------------------------------------------------------------------
"@ -ForegroundColor Green
