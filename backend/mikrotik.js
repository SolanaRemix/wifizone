'use strict';

/**
 * WIFIZONE ELITE — mikrotik.js
 * High-level MikroTik API bridge using the `mikronode` package (port 8728).
 *
 * Responsibilities:
 *   • addUser(mac, durationSeconds, profile)  — admit a client after payment
 *   • removeUser(mac)                          — revoke access (expiry / manual)
 *   • syncUsers()                              — pull live hotspot sessions
 *   • setPerUserSpeed(ip, maxLimit)            — apply per-IP queue simple rule
 *
 * Configuration is read from config/router.json (or config/router.local.json
 * when present).  Environment variables ROUTER_HOST, ROUTER_USER,
 * ROUTER_PASSWORD, and ROUTER_PORT take highest precedence.
 */

const MikroNode    = require('mikronode');
const { loadConfig } = require('./config-loader');

const _fileCfg = loadConfig('router');
const cfg = {
  ..._fileCfg,
  host:     process.env.ROUTER_HOST     || _fileCfg.host,
  port:     process.env.ROUTER_PORT     ? parseInt(process.env.ROUTER_PORT, 10) : _fileCfg.port,
  user:     process.env.ROUTER_USER     || _fileCfg.user,
  password: process.env.ROUTER_PASSWORD || _fileCfg.password,
};

/**
 * Return a connected, ready-to-use MikroNode connection.
 * The caller is responsible for calling connection.close() when done.
 *
 * @returns {Promise<object>} Resolved MikroNode connection
 */
function openConnection() {
  return new Promise((resolve, reject) => {
    const device = new MikroNode(cfg.host, cfg.port);
    device.connect((err, connection) => {
      if (err) return reject(new Error(`MikroTik connect failed: ${err.message}`));
      connection.login(cfg.user, cfg.password, (err2) => {
        if (err2) {
          // Close the socket to avoid leaking file descriptors on repeated failures.
          try { connection.close(); } catch (_) { /* ignore close errors */ }
          return reject(new Error(`MikroTik login failed: ${err2.message}`));
        }
        resolve(connection);
      });
    });
  });
}

/**
 * Format an uptime string from seconds, e.g. 3600 → "1h", 7200 → "2h", 90 → "1m30s".
 * MikroTik `limit-uptime` accepts "Xh", "Xm", "XhYmZs" etc.
 *
 * @param {number} seconds
 * @returns {string}
 */
function secondsToUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  let out = '';
  if (h) out += `${h}h`;
  if (m) out += `${m}m`;
  if (s || !out) out += `${s}s`;
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Admit a client to the MikroTik hotspot after a successful payment.
 * Any previous entry for the same MAC is removed first to avoid duplicates.
 *
 * @param {string} mac             Client MAC address (e.g. "AA:BB:CC:DD:EE:FF")
 * @param {number} durationSeconds Session length in seconds
 * @param {string} [profile]       Hotspot user profile ("REGULAR" | "VIP"). Defaults to "REGULAR".
 * @returns {Promise<void>}
 */
async function addUser(mac, durationSeconds, profile = 'REGULAR') {
  const connection = await openConnection();
  try {
    // Step 1: Remove any stale entry — fire-and-forget.
    // "No such item" traps are expected on first activation and must not fail.
    // Using a dedicated channel isolates the trap handler from the add step.
    await new Promise((resolve, reject) => {
      const removeChan = connection.openChannel('add-user-remove');
      removeChan.on('trap',  () => resolve()); // ignore "not found" traps
      removeChan.on('error', reject);
      removeChan.on('done',  resolve);
      // RouterOS `numbers` accepts item names; users are named by their MAC.
      removeChan.write(['/ip/hotspot/user/remove', `=numbers=${mac}`], true);
    });

    // Step 2: Add the new time-limited entry.
    await new Promise((resolve, reject) => {
      const addChan = connection.openChannel('add-user-add');
      addChan.on('trap',  reject);
      addChan.on('error', reject);
      addChan.on('done',  resolve);
      addChan.write([
        '/ip/hotspot/user/add',
        `=name=${mac}`,
        `=mac-address=${mac}`,
        `=password=auto`,
        `=profile=${profile}`,
        `=limit-uptime=${secondsToUptime(durationSeconds)}`,
        `=comment=wifizone-auto`,
      ], true);
    });

    console.log(`[MikroTik] addUser ${mac} profile=${profile} uptime=${secondsToUptime(durationSeconds)}`);
  } finally {
    connection.close();
  }
}

/**
 * Remove a client from the MikroTik hotspot (session expired, manual kick, etc.).
 *
 * @param {string} mac  Client MAC address
 * @returns {Promise<void>}
 */
async function removeUser(mac) {
  const connection = await openConnection();
  try {
    const chan = connection.openChannel('remove-user');

    await new Promise((resolve, reject) => {
      chan.on('trap',  reject);
      chan.on('error', reject);
      chan.on('done',  resolve);

      // RouterOS `numbers` accepts item names; user names are set to the MAC address.
      chan.write(['/ip/hotspot/user/remove', `=numbers=${mac}`], true);
    });

    console.log(`[MikroTik] removeUser ${mac}`);
  } finally {
    connection.close();
  }
}

/**
 * Pull the list of currently active hotspot sessions from the router.
 * Used to synchronise the dashboard with ground truth.
 *
 * @returns {Promise<Array<{
 *   id: string,
 *   mac: string,
 *   ip: string,
 *   uptime: string,
 *   bytesIn: number,
 *   bytesOut: number,
 *   idleTime: string
 * }>>}
 */
async function syncUsers() {
  const connection = await openConnection();
  try {
    const chan = connection.openChannel('sync-users');

    const rows = await new Promise((resolve, reject) => {
      const results = [];

      chan.on('trap',  reject);
      chan.on('error', reject);
      chan.on('read',  data => results.push(data));
      chan.on('done',  () => resolve(results));

      chan.write(['/ip/hotspot/active/print'], true);
    });

    return rows.map(row => ({
      id:       row['.id']       || '',
      mac:      row['mac-address'] || '',
      ip:       row['address']   || '',
      uptime:   row['uptime']    || '',
      bytesIn:  parseInt(row['bytes-in']  || '0', 10),
      bytesOut: parseInt(row['bytes-out'] || '0', 10),
      idleTime: row['idle-time'] || '',
    }));
  } finally {
    connection.close();
  }
}

/**
 * Add (or replace) a `queue simple` rule that caps bandwidth for a specific IP.
 * This enables per-client speed tiers (e.g. VIP vs Regular).
 *
 * The queue name is derived from the IP so it can be identified and replaced.
 *
 * @param {string} ip        Target IP address (e.g. "192.168.88.10")
 * @param {string} maxLimit  MikroTik rate string (e.g. "2M/2M", "10M/10M")
 * @returns {Promise<void>}
 */
async function setPerUserSpeed(ip, maxLimit) {
  const queueName = `wifizone-${ip}`;
  const connection = await openConnection();
  try {
    // Step 1: Remove existing rule for this IP — fire-and-forget.
    // Trap is resolved (not rejected) because the queue may not exist yet.
    await new Promise((resolve, reject) => {
      const removeChan = connection.openChannel('per-user-speed-remove');
      removeChan.on('trap',  () => resolve()); // ignore "not found" traps
      removeChan.on('error', reject);
      removeChan.on('done',  resolve);
      // RouterOS `numbers` accepts item names; queues are named wifizone-<ip>.
      removeChan.write(['/queue/simple/remove', `=numbers=${queueName}`], true);
    });

    // Step 2: Add new rule.
    await new Promise((resolve, reject) => {
      const addChan = connection.openChannel('per-user-speed-add');
      addChan.on('trap',  reject);
      addChan.on('error', reject);
      addChan.on('done',  resolve);
      addChan.write([
        '/queue/simple/add',
        `=name=${queueName}`,
        `=target=${ip}`,
        `=max-limit=${maxLimit}`,
        `=comment=wifizone-auto`,
      ], true);
    });

    console.log(`[MikroTik] setPerUserSpeed ${ip} → ${maxLimit}`);
  } finally {
    connection.close();
  }
}

/**
 * Pull the status of all network interfaces from the router.
 * Used by the multi-WAN dashboard panel.
 *
 * @returns {Promise<Array<{
 *   name: string,
 *   running: boolean,
 *   disabled: boolean,
 *   txBytes: number,
 *   rxBytes: number
 * }>>}
 */
async function getInterfaceStatus() {
  const connection = await openConnection();
  try {
    const chan = connection.openChannel('iface-status');
    const rows = await new Promise((resolve, reject) => {
      const results = [];
      chan.on('trap',  reject);
      chan.on('error', reject);
      chan.on('read',  data => results.push(data));
      chan.on('done',  () => resolve(results));
      chan.write(['/interface/print', '=stats='], true);
    });
    return rows.map(row => ({
      name:     row['name']     || '',
      running:  row['running']  === 'true',
      disabled: row['disabled'] === 'true',
      txBytes:  parseInt(row['tx-byte'] || '0', 10),
      rxBytes:  parseInt(row['rx-byte'] || '0', 10),
    }));
  } finally {
    connection.close();
  }
}

module.exports = { addUser, removeUser, syncUsers, setPerUserSpeed, secondsToUptime, getInterfaceStatus };
