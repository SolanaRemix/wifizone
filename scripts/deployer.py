#!/usr/bin/env python3
"""
WIFIZONE ELITE — deployer.py
Orchestrates environment checks, applies MikroTik router config,
starts the Node.js backend, and opens the admin dashboard.
"""

import os
import sys
import subprocess
import time
import webbrowser
import json
from pathlib import Path

ROOT      = Path(__file__).resolve().parent.parent
BACKEND   = ROOT / "backend"
CONFIG    = ROOT / "config" / "router.json"
RSC       = ROOT / "router-config.rsc"
SERVER_URL = "http://localhost:3000"


def step(msg: str) -> None:
    print(f"\n\033[96m▶ {msg}\033[0m")


def ok(msg: str) -> None:
    print(f"  \033[92m✔ {msg}\033[0m")


def warn(msg: str) -> None:
    print(f"  \033[93m⚠ {msg}\033[0m", file=sys.stderr)


def fail(msg: str) -> None:
    print(f"  \033[91m✘ {msg}\033[0m", file=sys.stderr)


# ── 1. Check Node.js ──────────────────────────────────────────────────────────
step("Checking Node.js")
try:
    result = subprocess.run(["node", "--version"], capture_output=True, text=True, check=True)
    ok(f"Node.js {result.stdout.strip()} found")
except (subprocess.CalledProcessError, FileNotFoundError):
    fail("Node.js not found. Install from https://nodejs.org")
    sys.exit(1)


# ── 2. Install npm dependencies ───────────────────────────────────────────────
step("Installing backend dependencies")
try:
    subprocess.run(["npm", "install", "--prefer-offline"], cwd=BACKEND, check=True)
    ok("Dependencies installed")
except subprocess.CalledProcessError:
    fail("npm install failed")
    sys.exit(1)


# ── 3. Load router config ─────────────────────────────────────────────────────
step("Loading router config")
try:
    with open(CONFIG) as f:
        router_cfg = json.load(f)
    ok(f"Router: {router_cfg['host']}:{router_cfg['port']}")
except Exception as e:
    warn(f"Could not read router.json: {e}")
    router_cfg = {}


# ── 4. Print RSC reminder ─────────────────────────────────────────────────────
step("Router config reminder")
if RSC.exists():
    warn(
        f"Apply MikroTik config manually:\n"
        f"  1. Upload the file to the router first:\n"
        f"       sftp admin@{router_cfg.get('host','192.168.88.1')}  then  put {RSC} router-config.rsc\n"
        f"  2. In WinBox / RouterOS terminal run:\n"
        f"       /import router-config.rsc"
    )
else:
    warn("router-config.rsc not found")


# ── 5. Start Node.js backend ──────────────────────────────────────────────────
step("Starting backend server")
proc = subprocess.Popen(
    ["node", "server.js"],
    cwd=BACKEND,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
)
ok(f"Backend started (PID {proc.pid})")


# ── 6. Wait for server to be ready ───────────────────────────────────────────
step("Waiting for server…")
import urllib.request, urllib.error
for attempt in range(15):
    time.sleep(1)
    try:
        urllib.request.urlopen(f"{SERVER_URL}/api/plans", timeout=2)
        ok("Server is up!")
        break
    except Exception:
        print(f"  … attempt {attempt + 1}/15")
else:
    warn("Server did not respond in time — check logs above")


# ── 7. Open dashboard ─────────────────────────────────────────────────────────
step("Opening operator cockpit")
try:
    webbrowser.open(SERVER_URL)
    ok(f"Dashboard opened at {SERVER_URL}")
except Exception as e:
    warn(f"Could not open browser: {e}. Navigate to {SERVER_URL} manually.")


# ── 8. Tail server output ─────────────────────────────────────────────────────
step("Backend output (Ctrl-C to stop)")
try:
    for line in proc.stdout:
        print("  " + line, end="")
except KeyboardInterrupt:
    print("\nStopping…")
    proc.terminate()
    proc.wait()
    ok("Backend stopped")
