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
 * Configuration is read from config/router.json.
 */

const MikroNode = require('mikronode');
const cfg       = require('../config/router.json');

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
        if (err2) return reject(new Error(`MikroTik login failed: ${err2.message}`));
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
    const chan = connection.openChannel('add-user');

    await new Promise((resolve, reject) => {
      chan.on('trap',  reject);
      chan.on('error', reject);
      chan.on('done',  resolve);

      // Remove any stale entry first (fire-and-forget; trap is ignored if not found).
      // RouterOS `numbers` accepts the item name, and we name users by their MAC.
      chan.write(['/ip/hotspot/user/remove', `=numbers=${mac}`], false);

      // Add the new time-limited entry
      chan.write([
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
    const chan = connection.openChannel('per-user-speed');

    await new Promise((resolve, reject) => {
      chan.on('trap',  reject);
      chan.on('error', reject);
      chan.on('done',  resolve);

      // Remove existing rule for this IP (fire-and-forget; trap ignored if absent).
      // RouterOS `numbers` accepts item names; queues are named wifizone-<ip>.
      chan.write(['/queue/simple/remove', `=numbers=${queueName}`], false);

      // Add new rule
      chan.write([
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

module.exports = { addUser, removeUser, syncUsers, setPerUserSpeed, secondsToUptime };
