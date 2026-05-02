# WIFIZONE ELITE — One-Click Windows Installer
# install.ps1 — Downloads all prerequisites, sets up the database,
#               configures the server, installs the browser extension,
#               and creates a desktop shortcut.
#
# Works on Windows 7, 8, 10, and Windows 11.
# Run as Administrator for best results.
#
# Usage:
#   Right-click install.ps1 → Run with PowerShell
#   OR: powershell -ExecutionPolicy Bypass -File install.ps1

Set-StrictMode -Version 1
$ErrorActionPreference = 'Stop'

$HOST_PORT  = 3000
$REPO_ROOT  = Split-Path -Parent $PSScriptRoot
$BACKEND    = Join-Path $REPO_ROOT 'backend'
$DB_SCHEMA  = Join-Path $REPO_ROOT 'db\schema.sql'
$CONFIG_DIR = Join-Path $REPO_ROOT 'config'

function Write-Step($msg) { Write-Host "`n► $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  ✅ $msg" -ForegroundColor Green  }
function Write-Warn($msg) { Write-Host "  ⚠️  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  ❌ $msg" -ForegroundColor Red    }

# ── Banner ────────────────────────────────────────────────────────────────────
Clear-Host
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║          ⚡  WIFIZONE ELITE  —  INSTALLER           ║" -ForegroundColor Cyan
Write-Host "  ║      Your WiFi Sharing Business, Made Easy           ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "  This installer will set up everything you need." -ForegroundColor White
Write-Host "  Works on Windows 7, 8, 10, and Windows 11." -ForegroundColor White
Write-Host ""

# ── 1. Check Node.js ──────────────────────────────────────────────────────────
Write-Step "Checking for Node.js..."
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $nodeVer = & node --version 2>&1
    Write-Ok "Node.js found: $nodeVer"
} else {
    Write-Warn "Node.js not found. Attempting to install via winget..."
    try {
        winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                    [System.Environment]::GetEnvironmentVariable('Path', 'User')
        Write-Ok "Node.js installed successfully."
    } catch {
        Write-Fail "Could not auto-install Node.js."
        Write-Host ""
        Write-Host "  Please download and install Node.js manually from:" -ForegroundColor Yellow
        Write-Host "  https://nodejs.org  (choose the LTS version)" -ForegroundColor White
        Write-Host ""
        Write-Host "  After installing Node.js, run this installer again." -ForegroundColor Yellow
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# ── 2. Check MySQL ────────────────────────────────────────────────────────────
Write-Step "Checking for MySQL..."
$mysqlCmd = Get-Command mysql -ErrorAction SilentlyContinue
if ($mysqlCmd) {
    Write-Ok "MySQL found."
} else {
    Write-Warn "MySQL not found."
    Write-Host ""
    Write-Host "  Please download and install MySQL Community Server:" -ForegroundColor Yellow
    Write-Host "  https://dev.mysql.com/downloads/mysql/" -ForegroundColor White
    Write-Host "  (Choose 'MySQL Community Server' — it's free)" -ForegroundColor White
    Write-Host ""
    $choice = Read-Host "  Have you already installed MySQL? (y/n)"
    if ($choice -ne 'y') {
        Write-Host "  Opening MySQL download page in your browser..." -ForegroundColor Cyan
        Start-Process "https://dev.mysql.com/downloads/mysql/"
        Read-Host "  Press Enter after you have installed MySQL, then we will continue"
    }
    # Check again
    $mysqlCmd = Get-Command mysql -ErrorAction SilentlyContinue
    if (-not $mysqlCmd) {
        Write-Warn "MySQL still not detected. You may need to restart this installer after MySQL is set up."
    }
}

# ── 3. Install Node.js dependencies ──────────────────────────────────────────
Write-Step "Installing backend dependencies (npm install)..."
Set-Location $BACKEND
try {
    npm install --prefer-offline
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    Write-Ok "Dependencies installed."
} catch {
    Write-Fail "npm install failed: $_"
    Read-Host "Press Enter to exit"
    exit 1
}

# ── 4. Set up configuration files ────────────────────────────────────────────
Write-Step "Setting up configuration files..."
Set-Location $CONFIG_DIR

$routerLocal  = Join-Path $CONFIG_DIR 'router.local.json'
$paymentLocal = Join-Path $CONFIG_DIR 'payment.local.json'

if (-not (Test-Path $routerLocal)) {
    Copy-Item (Join-Path $CONFIG_DIR 'router.json') $routerLocal
    Write-Ok "Created config/router.local.json"
    Write-Warn "Edit config/router.local.json with your MikroTik router IP and password."
} else {
    Write-Ok "config/router.local.json already exists — skipping."
}

if (-not (Test-Path $paymentLocal)) {
    Copy-Item (Join-Path $CONFIG_DIR 'payment.json') $paymentLocal
    Write-Ok "Created config/payment.local.json"
} else {
    Write-Ok "config/payment.local.json already exists — skipping."
}

# ── 5. Set up database ────────────────────────────────────────────────────────
Write-Step "Setting up MySQL database..."

if ($mysqlCmd) {
    Write-Host "  Enter your MySQL root password (press Enter if none):" -ForegroundColor Yellow
    $dbPassword = Read-Host -AsSecureString "  MySQL root password"
    $dbPlain    = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbPassword))

    $mysqlArgs = @('-u', 'root')
    if ($dbPlain -ne '') { $mysqlArgs += "-p$dbPlain" }

    try {
        Get-Content -Raw $DB_SCHEMA | mysql @mysqlArgs
        if ($LASTEXITCODE -ne 0) { throw "MySQL error" }
        Write-Ok "Database 'wifizone_elite' created with all tables and default plans."
    } catch {
        Write-Warn "Database setup failed. This may be okay if the database already exists."
        Write-Warn "Error: $_"
    }
} else {
    Write-Warn "MySQL not found — skipping database setup."
    Write-Warn "Run this command manually after installing MySQL:"
    Write-Warn "  mysql -u root -p < db\schema.sql"
}

# ── 6. Install browser extension ──────────────────────────────────────────────
Write-Step "Browser Extension Setup..."
$extPath = Join-Path $REPO_ROOT 'extension'

Write-Host ""
Write-Host "  WIFIZONE includes a browser extension for Chrome and Edge." -ForegroundColor White
Write-Host "  The extension shows live stats in your browser toolbar." -ForegroundColor White
Write-Host ""
Write-Host "  To install it:" -ForegroundColor Yellow
Write-Host "  1. Open Chrome (go to chrome://extensions)" -ForegroundColor White
Write-Host "     OR Open Edge (go to edge://extensions)" -ForegroundColor White
Write-Host "  2. Turn ON 'Developer mode' (toggle in the top-right corner)" -ForegroundColor White
Write-Host "  3. Click 'Load unpacked'" -ForegroundColor White
Write-Host "  4. Select this folder:" -ForegroundColor White
Write-Host "     $extPath" -ForegroundColor Cyan
Write-Host ""

# Auto-open Chrome extensions page if Chrome is installed
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$edgePath   = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

if (Test-Path $chromePath) {
    $openBrowser = Read-Host "  Open Chrome extensions page now? (y/n)"
    if ($openBrowser -eq 'y') {
        Start-Process $chromePath 'chrome://extensions'
    }
} elseif (Test-Path $edgePath) {
    $openBrowser = Read-Host "  Open Edge extensions page now? (y/n)"
    if ($openBrowser -eq 'y') {
        Start-Process $edgePath 'edge://extensions'
    }
}

# ── 7. Create desktop shortcut ────────────────────────────────────────────────
Write-Step "Creating desktop shortcut..."
try {
    $desktopPath = [Environment]::GetFolderPath('Desktop')
    $shortcutFile = Join-Path $desktopPath 'WIFIZONE ELITE.lnk'
    $shell     = New-Object -ComObject WScript.Shell
    $shortcut  = $shell.CreateShortcut($shortcutFile)
    $shortcut.TargetPath       = 'powershell.exe'
    $shortcut.Arguments        = "-ExecutionPolicy Bypass -File `"$(Join-Path $REPO_ROOT 'scripts\bootstrap.ps1')`""
    $shortcut.WorkingDirectory = $REPO_ROOT
    $shortcut.Description      = 'Start WIFIZONE ELITE server'
    $shortcut.Save()
    Write-Ok "Desktop shortcut created: 'WIFIZONE ELITE'"
} catch {
    Write-Warn "Could not create desktop shortcut: $_"
}

# ── 8. Done! ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║         ✅  INSTALLATION COMPLETE!                  ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "  1. Edit config\router.local.json with your router details" -ForegroundColor Yellow
Write-Host "  2. Double-click 'WIFIZONE ELITE' on your desktop to start" -ForegroundColor Yellow
Write-Host "  3. Open http://localhost:$HOST_PORT in Chrome or Edge" -ForegroundColor Yellow
Write-Host "  4. Install the browser extension from the 'extension' folder" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Your customer portal will be at:" -ForegroundColor White
Write-Host "  http://localhost:$HOST_PORT/portal/" -ForegroundColor Cyan
Write-Host ""

$startNow = Read-Host "  Start WIFIZONE ELITE now? (y/n)"
if ($startNow -eq 'y') {
    Set-Location $REPO_ROOT
    Start-Process powershell -ArgumentList "-ExecutionPolicy", "Bypass", "-File", "`"$(Join-Path $REPO_ROOT 'scripts\bootstrap.ps1')`""
    Start-Sleep -Seconds 3
    Start-Process "http://localhost:$HOST_PORT"
}
