# 📶 WIFIZONE — Your WiFi Sharing Business, Made Easy

> **Start earning with your own WiFi hotspot business — no coding needed!**

WIFIZONE is a simple, powerful hotspot management system built for Filipino entrepreneurs who want to sell WiFi access using a MikroTik router. Whether you're running a small sari-sari store, a boarding house, a waiting shed, or a neighborhood hotspot — WIFIZONE makes it easy to manage customers, sell time-based vouchers, and grow your business.

✅ Works on **any Windows PC or laptop**
✅ One-Click Installer — no technical skills needed
✅ Supports **GCash and Card payments**
✅ Connects to your **Globe modem, Starlink, or any internet source**
✅ Real-time dashboard to monitor your earnings and customers

---

## 📸 Screenshots

### Operator Cockpit (Admin Dashboard)

Your control center — see live revenue, active users, and internet health at a glance.

![Admin Dashboard](https://github.com/user-attachments/assets/f8feeff2-be27-4a39-800b-9b2c1570a1eb)

### Customer WiFi Portal (What your customers see)

A clean page where customers pick their plan and pay via GCash or card.

![Landing Page](https://github.com/user-attachments/assets/84349bcc-90d7-438f-8009-f9a80c6abf21)

### Session Activation Page

After payment, customers enter their reference number and their internet turns on automatically.

![Activation Page](https://github.com/user-attachments/assets/fbd4c2f1-faf6-4970-b1b1-116a90256ca8)

---

## ✨ Key Features

| Feature | What it does for your business |
|---|---|
| 🕐 Time-based vouchers | Sell 1-hour, 3-hour, 1-day, or any duration you want |
| 💳 GCash & Card payments | Customers pay online — no coins, no bills |
| 📊 Live earnings dashboard | See how much you've earned in real time |
| 👥 Customer management | Monitor who's connected and for how long |
| ⚡ VIP & Regular plans | Offer faster speed to customers who pay more |
| 🔄 Auto-disconnect | Customers are automatically cut off when their time is up |
| 🌐 Multi-modem support | Add multiple Globe, PLDT, or Starlink connections |
| 🖥️ Works on any Windows PC | Runs smoothly on Windows 10 and Windows 11 |
| 🔌 One-Click Installer | No complicated setup — just click and it installs itself |
| 📡 Captive Portal | Customers see your WiFi page when they connect |

---

## 🏆 Why Choose WIFIZONE Over Mikhmon?

| | WIFIZONE | Mikhmon |
|---|---|---|
| **Installer** | ✅ One-Click Windows Installer | ❌ Manual setup required |
| **Ease of use** | ✅ Beginner-friendly | ⚠️ Requires technical knowledge |
| **Payment integration** | ✅ GCash + Card (built-in) | ❌ Manual collection only |
| **Dashboard** | ✅ Real-time earnings & stats | ⚠️ Basic reporting |
| **Auto-disconnect** | ✅ Fully automatic | ⚠️ Manual management |
| **Multiple modems** | ✅ Globe, Starlink, PLDT | ⚠️ Single connection |
| **Speed profiles** | ✅ VIP / Regular tiers | ⚠️ Limited |
| **Windows compatibility** | ✅ All Windows versions | ⚠️ Depends on setup |
| **Target users** | ✅ Regular Filipinos, no coding needed | ❌ IT-savvy users |

> 💡 **Bottom line:** WIFIZONE is designed from the ground up for Filipino WiFi resellers who want something that just works — no headaches, no complicated commands.

---

## 💻 System Requirements

### Your Computer (Windows)
- **Operating System:** Windows 10 or Windows 11 *(required for the installer and Node.js LTS)*
- **RAM:** At least 2 GB
- **Storage:** At least 500 MB free space
- **Internet:** Must be connected to your MikroTik router

### Browser (Recommended)
- **Google Chrome** or **Microsoft Edge** *(recommended)*
- The **WIFIZONE browser extension** is *optional but useful* — it adds a quick-access toolbar button showing live stats and a badge alert when customers are waiting for activation
  - It does **not** affect the admin dashboard itself (which is a normal web page accessed at `http://localhost:3000/dashboard.html`)
  - To install: open Chrome (`chrome://extensions`) or Edge (`edge://extensions`), enable **Developer Mode**, click **Load Unpacked**, and select the `extension/` folder

### Router
- **MikroTik router** (any model — hAP lite, RB750, hEX, or any RouterOS device)
- MikroTik RouterOS version 6 or 7

### Internet Source (any of these)
- Globe modem (LTE or fiber)
- PLDT modem
- Starlink dish
- Any internet-sharing device

---

## 🚀 One-Click Installer (for Windows)

> **WIFIZONE includes a PowerShell installer that automates the setup on Windows 10 and Windows 11.**

You don't need to be a programmer or IT person. Just right-click the script and run it — WIFIZONE sets itself up automatically.

### What the One-Click Installer does for you:
- ✅ Installs Node.js automatically (if not already installed)
- ✅ Runs `npm install` for all backend dependencies
- ✅ Sets up the MySQL database
- ✅ Copies configuration file templates
- ✅ Creates a desktop shortcut for daily use
- ✅ Walks you through browser extension setup step-by-step

### How to run the installer:

1. **Make sure you have Git and MySQL installed** — see the [Step-by-Step Guide](#-step-by-step-installation-guide) below if you need help
2. **Clone or download** this repository to your Windows PC
3. **Open** the `scripts` folder inside the repository
4. **Right-click** `install.ps1` → **Run with PowerShell**
   *(or open PowerShell and run: `powershell -ExecutionPolicy Bypass -File scripts\install.ps1`)*
5. Follow the on-screen prompts — the installer will do the rest
6. When done, open **http://localhost:3000** in Chrome or Edge

> 💡 **Tip:** If Windows asks "Do you want to allow this app to make changes?", click **Yes**. This is normal and safe.

> 💡 **Tip:** The browser extension is *optional* — it adds a live-stats badge to your toolbar but is not required for the dashboard to work.

---

## 📋 Step-by-Step Installation Guide

*If you prefer to install manually, or if the One-Click Installer is not available yet:*

### Step 1: Install Required Programs

You need these three programs. Download and install them one by one:

1. **Node.js** (the engine that runs WIFIZONE)
   - Go to: https://nodejs.org
   - Download the "LTS" version (the one that says "Recommended for most users")
   - Install it like a normal Windows program — just click Next, Next, Finish

2. **MySQL Community Server** (stores your customer data)
   - Go to: https://dev.mysql.com/downloads/mysql/
   - Download and install the Community Edition (free)
   - During setup, set a simple password for MySQL root (write it down!)

3. **Git** (downloads WIFIZONE from the internet)
   - Go to: https://git-scm.com/download/win
   - Download and install (just click Next all the way)

### Step 2: Download WIFIZONE

1. Open the **Command Prompt** (press `Windows key + R`, type `cmd`, press Enter)
2. Type these commands one by one and press Enter after each:

```
git clone https://github.com/SolanaRemix/wifizone.git
cd wifizone
```

### Step 3: Install WIFIZONE Dependencies

Still in the Command Prompt, type:

```
npm install --prefix backend
```

Wait for it to finish (this may take 1–2 minutes).

### Step 4: Set Up the Database

```
mysql -u root -p < db/schema.sql
```

When asked for a password, type the MySQL password you set in Step 1.

### Step 5: Configure Your Router Settings

1. Go to the `config` folder inside the wifizone folder
2. Copy the file `router.json` and rename the copy to `router.local.json`
3. Open `router.local.json` with Notepad and fill in your router details:

```json
{
  "host": "192.168.88.1",
  "port": 8728,
  "user": "admin",
  "password": "YOUR_ROUTER_PASSWORD_HERE"
}
```

> 💡 Replace `YOUR_ROUTER_PASSWORD_HERE` with your actual MikroTik password.

### Step 6: Install the Browser Extension

1. Open **Google Chrome** or **Microsoft Edge**
2. Go to `chrome://extensions` (Chrome) or `edge://extensions` (Edge) in the address bar
3. Enable **Developer Mode** (toggle in the top-right corner)
4. Click **Load Unpacked**
5. Select the `extension/` folder inside your wifizone directory
6. The WIFIZONE extension icon will appear in your browser toolbar

> 💡 **Tip:** The browser extension is *optional*. The admin dashboard works normally in any browser — the extension just adds a convenient toolbar shortcut and live-stats badge.

---

## ▶️ How to Run WIFIZONE for the First Time

### Using the One-Click Bootstrap (Easiest Way)

1. Open **File Explorer** and go to the `wifizone` folder
2. Open the `scripts` folder
3. **Right-click** on `bootstrap.ps1`
4. Click **"Run with PowerShell"**
5. The script will:
   - Check that all required programs are installed
   - Set up the database automatically
   - Start the WIFIZONE server
   - Open your dashboard in the browser

### Using Command Prompt (Alternative)

1. Open Command Prompt
2. Navigate to the wifizone folder: `cd wifizone\backend`
3. Start the server: `node server.js`
4. Open your browser and go to: **http://localhost:3000**

### First-Time Setup in the Dashboard

When WIFIZONE opens in your browser for the first time:

1. **Go to your dashboard:** http://localhost:3000/dashboard.html
2. **Set your voucher plans** — add your pricing (e.g., ₱10 = 1 hour, ₱25 = 3 hours)
3. **Enter your router password** in the settings
4. **Test the connection** — click "Test Router" to make sure WIFIZONE can talk to your MikroTik

> 💡 Keep the server running in the background while your hotspot is open for business!

---

## 📡 How to Connect Your MikroTik Router

### Step 1: Connect the Router

1. Connect your MikroTik router to your computer using a **LAN cable** (ether1 or any port)
2. Connect your **Globe modem or Starlink** to the router's WAN port (usually ether1)
3. Power on the router and wait 30 seconds

### Step 2: Open WinBox

1. Download **WinBox** from the MikroTik website: https://mikrotik.com/download
2. Open WinBox and click on your router's MAC address to connect
3. Log in with username `admin` and leave the password blank (default)

### Step 3: Apply the WIFIZONE Router Script

This script automatically sets up your router for hotspot use:

1. In WinBox, go to **Files**
2. Drag and drop the `router-config.rsc` file from your wifizone folder
3. Open the **Terminal** in WinBox
4. Type: `/import router-config.rsc` and press Enter
5. Wait for it to finish (about 30 seconds)

### Step 4: Verify the Setup

After the script runs, your router will have:
- ✅ A **Hotspot** running on the WiFi and LAN ports
- ✅ **VIP and Regular** speed profiles set up
- ✅ **DHCP server** giving IPs to customers (192.168.88.10 to 192.168.88.254)
- ✅ **API access** on port 8728 (for WIFIZONE to control it)

### Step 5: Test the Connection

1. In WIFIZONE dashboard, go to **Settings → Router**
2. Enter your router's IP address (default: `192.168.88.1`)
3. Enter your router password
4. Click **"Test Connection"** — you should see a green checkmark ✅

> 💡 **Tip:** If the test fails, make sure your computer is connected to the router with a LAN cable, and that the API service is enabled in WinBox under **IP → Services → API**.

---

## 🎟️ How to Create and Sell Vouchers (Time-Based)

### Setting Up Your Voucher Plans

1. Open your WIFIZONE dashboard at **http://localhost:3000/dashboard.html**
2. Go to the **Plans** section
3. Click **"Add New Plan"**
4. Fill in the details:

| Field | Example |
|---|---|
| Plan Name | "1 Hour Unlimited" |
| Duration | 60 minutes |
| Price | ₱10 |
| Speed Profile | Regular (5 Mbps) or VIP (20 Mbps) |

5. Click **Save** — your plan is now available to customers!

### How the Sales Process Works

Here's what happens when a customer buys WiFi from you:

```
Customer connects to your WiFi
         ↓
They see your WIFIZONE portal page (like a website)
         ↓
They pick a plan (e.g., ₱10 for 1 hour)
         ↓
They pay via GCash or card
         ↓
WIFIZONE automatically activates their internet
         ↓
Their timer starts counting down
         ↓
When time is up, they are automatically disconnected
```

### Collecting Payments

**Option 1: GCash (Recommended)**
- Customers pay directly through GCash on their phone
- WIFIZONE automatically confirms payment and activates their session
- No manual verification needed!

**Option 2: Manual (Cash)**
- Customer pays you cash
- You go to your dashboard and manually activate their session
- Click on the customer's device and click **"Activate"**

### Viewing Your Sales

- Go to **Dashboard → Earnings** to see today's revenue
- Go to **Dashboard → Sessions** to see all active and past customers
- The dashboard updates in real time — no need to refresh!

---

## 🌐 How to Add Multiple Globe Modems

Running multiple Globe LTE modems gives your customers more stable internet. Here's how to add them:

### Step 1: Connect the Modems to Your Router

1. Connect **Modem 1** to your MikroTik's `ether1` port
2. Connect **Modem 2** to `ether2` (or use a USB hub for multiple LTE USB dongles)
3. For more modems, use a **managed switch** connected to your router

### Step 2: Configure Load Balancing in WinBox

1. Open **WinBox** and go to **IP → Routes**
2. Add a route for each modem:
   - Route 1: Gateway = Modem 1's IP (e.g., 192.168.1.1), Distance = 1
   - Route 2: Gateway = Modem 2's IP (e.g., 192.168.2.1), Distance = 2
3. This makes MikroTik automatically switch to Modem 2 if Modem 1 goes down

### Step 3: Set Up Failover

In WinBox:
1. Go to **IP → Routes**
2. Right-click on your secondary modem's route
3. Set **Distance** to 2 (primary modem stays at Distance 1)
4. MikroTik will automatically failover to the backup modem!

### Step 4: Test Your Setup

1. Disconnect Modem 1 (just unplug it)
2. Check if the internet still works through Modem 2
3. Reconnect Modem 1 — it should automatically become the primary again

> 💡 **Tip for Globe LTE Modems:** Each Globe modem has a SIM card. Make sure your SIM cards have enough data load, or register them to an unlimited promo to avoid unexpected disconnections.

> 💡 **Globe SIM tip:** Use different Globe promos on different SIMs (e.g., GoUnli99 on one, GoSURF299 on another) so that if one SIM's promo expires, the others keep working.

---

## 📷 Recommended Screenshots

*Add your own screenshots here to help customers and future users understand your setup!*

Here are the screenshots we recommend including in your business documentation:

### 1. Your WiFi Portal (Customer View)
> 📸 *Screenshot showing your WiFi portal with your business name and available plans*
>
> `[Add screenshot here: frontend/index.html in browser]`

### 2. Admin Dashboard — Revenue Overview
> 📸 *Screenshot of your dashboard showing today's earnings and number of connected users*
>
> `[Add screenshot here: dashboard.html - Stats section]`

### 3. Active Sessions Table
> 📸 *Screenshot showing the list of currently connected customers*
>
> `[Add screenshot here: dashboard.html - Live Users table]`

### 4. Voucher Plans List
> 📸 *Screenshot showing your pricing (e.g., ₱10/hour, ₱25/3 hours, ₱50/day)*
>
> `[Add screenshot here: dashboard.html - Plans section]`

### 5. GCash Payment Screen
> 📸 *Screenshot of the payment page that customers see when paying via GCash*
>
> `[Add screenshot here: payment screen on mobile]`

### 6. Router Connection Status
> 📸 *Screenshot showing green "Connected" status to your MikroTik router*
>
> `[Add screenshot here: Settings → Router Connection]`

---

## ❓ Frequently Asked Questions (FAQ)

### 🔧 Installation & Setup

**Q: Do I need to know programming to use WIFIZONE?**
> No! WIFIZONE is designed for regular users. The One-Click Installer handles everything for you. You just need to know how to click a mouse and type simple settings.

**Q: Will WIFIZONE work on my old laptop?**
> WIFIZONE requires Windows 10 or Windows 11 (Node.js LTS no longer supports older Windows versions). If your laptop runs Windows 10 or newer and can connect to the internet, WIFIZONE will work.

**Q: Why would I use the browser extension?**
> The browser extension (for Chrome or Edge) is an optional convenience tool. It shows live stats in your browser toolbar and alerts you with a badge when customers are waiting for activation. The main dashboard at `http://localhost:3000/dashboard.html` works without it.

**Q: I don't have a MikroTik router. Can I still use WIFIZONE?**
> WIFIZONE is designed specifically for MikroTik routers. You'll need at least a basic MikroTik router (like the hAP lite, which costs around ₱1,500–₱2,000 in the Philippines). It's a one-time investment that pays for itself quickly!

**Q: Can I use WIFIZONE with my Globe LTE modem?**
> Absolutely! Just connect your Globe modem to your MikroTik router's WAN port. WIFIZONE works with Globe, PLDT, Sky, Starlink, and any internet source.

---

### 💰 Business & Payments

**Q: How do customers pay?**
> Customers can pay via **GCash** directly from their phone, or with a credit/debit card. Everything is automatic — no need for you to manually check payments.

**Q: What happens when a customer's time runs out?**
> WIFIZONE automatically disconnects them from the internet. They'll need to buy a new voucher to reconnect. You don't have to do anything manually!

**Q: Can I offer different speeds to different customers?**
> Yes! You can create **VIP plans** (faster speed, higher price) and **Regular plans** (standard speed, lower price). Customers who pay more get faster internet automatically.

**Q: How much can I earn with WIFIZONE?**
> It depends on your location and number of customers. A typical setup in a neighborhood with 20–50 regular customers can earn ₱500–₱3,000+ per day. The more customers you have, the more you earn!

**Q: Is GCash integration free?**
> WIFIZONE itself is open source and free to use. GCash charges a small transaction fee per payment (check GCash for Biz for current rates).

---

### 🌐 Technical & Troubleshooting

**Q: WIFIZONE can't connect to my MikroTik router. What do I do?**
> 1. Make sure your computer is connected to the router with a **LAN cable**
> 2. In WinBox, go to **IP → Services** and make sure **API** is enabled (port 8728)
> 3. Check that your router password in WIFIZONE's settings matches your actual WinBox password
> 4. Try restarting the router and WIFIZONE

**Q: Customers can connect to my WiFi but they don't see the WIFIZONE portal. Why?**
> This is usually because the Hotspot is not fully configured on your router. Make sure you ran the `router-config.rsc` script in WinBox. If the portal still doesn't appear, check WinBox under **IP → Hotspot** and make sure the hotspot is running.

**Q: My Globe modem lost connection. Will WIFIZONE automatically switch to backup?**
> Yes, if you've set up multiple modems with failover routes in MikroTik (see the "Multiple Globe Modems" section above), your router will automatically switch to the backup modem.

**Q: Can multiple people access the WIFIZONE dashboard at the same time?**
> Yes! The dashboard is accessible from any device on your network by going to `http://YOUR-COMPUTER-IP:3000/dashboard.html`. Your phone, tablet, and other computers can all view it simultaneously.

**Q: How do I back up my customer data?**
> Your data is stored in a MySQL database. To back it up, open Command Prompt and run:
> ```
> mysqldump -u root -p wifizone_elite > backup.sql
> ```
> Save the `backup.sql` file to a USB drive or cloud storage.

**Q: WIFIZONE stopped working after a Windows update. What do I do?**
> Just restart the WIFIZONE server by running `bootstrap.ps1` again (right-click → Run with PowerShell). Windows updates sometimes close background programs.

---

## 📁 Directory Structure (For Technical Users)

```
wifizone/
├── admin-panel/          Operator cockpit (HTML/CSS/JS)
│   ├── dashboard.html
│   ├── dashboard.js
│   └── neon.css
├── backend/              Node.js backend
│   ├── server.js         Express API + WebSocket hub
│   ├── mikrotik.js       MikroTik API bridge
│   ├── router-control.js Queue/tree management
│   ├── starlink.js       SNMP telemetry poller
│   ├── autopilot.js      Auto bandwidth balancer
│   └── package.json
├── config/               Configuration files
│   ├── router.json       Router settings template
│   └── payment.json      Payment settings template
├── db/
│   └── schema.sql        MySQL database schema
├── frontend/             Customer-facing portal pages
│   ├── index.html        Plan picker / landing page
│   └── login.html        Session activation page
├── scripts/
│   ├── bootstrap.ps1     Windows one-click start
│   ├── bootstrap.ps2     Extended start (autopilot + dish)
│   └── deployer.py       Environment checker + launcher
└── router-config.rsc     MikroTik RouterOS setup script
```

---

## 📜 License

[MIT](LICENSE) — Free to use, modify, and share.

---

<div align="center">

**Made with ❤️ for Filipino WiFi entrepreneurs**

*Start your WiFi business today — WIFIZONE makes it easy!*

</div>
