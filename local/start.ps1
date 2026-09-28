<#
    Persona Intelligence - start the application locally (Windows, PowerShell)

    Starts two things: the Next.js application and the background worker that
    runs ingestion and simulation jobs. Both are needed - without the worker a
    run will sit in the queue and never complete.

    Press Ctrl+C to stop. The worker window closes with it.
#>

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path (Join-Path $root '.env'))) {
  Write-Host "`nNo .env found. Run .\local\setup.ps1 first.`n" -ForegroundColor Red
  exit 1
}
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Write-Host "`nDependencies are not installed. Run .\local\setup.ps1 first.`n" -ForegroundColor Red
  exit 1
}

# Make sure the database is up if it is the Docker one.
try {
  docker inspect -f '{{.State.Running}}' rfpi-postgres 2>$null | Out-String -OutVariable running | Out-Null
  if ($running -match 'false') {
    Write-Host 'Starting the database container...' -ForegroundColor Cyan
    docker compose -f "$root\local\docker-compose.yml" up -d | Out-Null
    Start-Sleep -Seconds 4
  }
} catch { }

# Bring the database schema and the generated client up to date. Both are no-ops when nothing
# changed, and they are what makes "extract the new source, run start.ps1" enough after an update.
Write-Host 'Checking the database schema...' -ForegroundColor Cyan
npx prisma generate | Out-Null
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) {
  Write-Host "`nThe database migration failed. Is PostgreSQL running?`n" -ForegroundColor Red
  exit 1
}

Write-Host "`nStarting the background worker in a second window..." -ForegroundColor Cyan
$worker = Start-Process powershell -PassThru -ArgumentList @(
  '-NoExit', '-Command',
  "Set-Location '$root'; Write-Host 'Persona Intelligence - worker' -ForegroundColor Cyan; npm run worker"
)

Write-Host @"

------------------------------------------------------------------
  Application:  http://localhost:3000
  Worker:       running in the second window

  Your sign-in code is printed HERE, in this window, when you
  request one. There is no email provider configured locally.
------------------------------------------------------------------

"@ -ForegroundColor Green

try {
  npm run dev
} finally {
  if ($worker -and -not $worker.HasExited) {
    Write-Host 'Stopping the worker...' -ForegroundColor Cyan
    Stop-Process -Id $worker.Id -Force -ErrorAction SilentlyContinue
  }
}
