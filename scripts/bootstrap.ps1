# WIFIZONE ELITE — Bootstrap Script (Windows PowerShell)
# bootstrap.ps1 — Scaffolds backend, installs dependencies,
#                  initialises the database, and launches the cockpit.

Write-Host "🚀 Bootstrapping WIFIZONE ELITE SaaS Panel..." -ForegroundColor Cyan

# ── 1. Verify Node.js ──────────────────────────────────────────────────────────
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is not installed. Download from https://nodejs.org"
    exit 1
}

# ── 2. Install backend dependencies ───────────────────────────────────────────
Set-Location "$PSScriptRoot\..\backend"
Write-Host "📦 Installing Node dependencies…" -ForegroundColor Yellow
npm install --prefer-offline
if ($LASTEXITCODE -ne 0) { Write-Error "npm install failed"; exit 1 }

# ── 3. Initialise database ─────────────────────────────────────────────────────
Write-Host "🗄️  Initialising database…" -ForegroundColor Yellow
$dbPassword = Read-Host -Prompt "MySQL root password (leave blank for none)"
$sqlFile    = "$PSScriptRoot\..\db\schema.sql"

if ($dbPassword -eq "") {
    mysql -u root --execute "source $sqlFile"
} else {
    mysql -u root -p$dbPassword --execute "source $sqlFile"
}

if ($LASTEXITCODE -ne 0) {
    Write-Warning "Database init failed — ensure MySQL is running and accessible."
}

# ── 4. Start backend ───────────────────────────────────────────────────────────
Write-Host "🟢 Starting backend server…" -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$PSScriptRoot\..\backend'; node server.js"

# ── 5. Start Python deployer ───────────────────────────────────────────────────
if (Get-Command python -ErrorAction SilentlyContinue) {
    Write-Host "🐍 Starting Python deployer…" -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "python '$PSScriptRoot\deployer.py'"
}

# ── 6. Open admin dashboard ───────────────────────────────────────────────────
Start-Sleep -Seconds 2
Write-Host "🌐 Opening operator cockpit…" -ForegroundColor Cyan
Start-Process "http://localhost:3000"

Write-Host "✅ WIFIZONE ELITE backend + cockpit running." -ForegroundColor Green
