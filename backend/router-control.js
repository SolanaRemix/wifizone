'use strict';

/**
 * WIFIZONE ELITE — router-control.js
 * Communicates with a MikroTik RouterOS device via the API (port 8728)
 * to manage hotspot users: unlock on payment, remove on expiry.
 */

const Mikronode = require('mikronode-ng');
const cfg       = require('../config/router.json');

/**
 * Open a short-lived API connection, run a callback, then close.
 * @param {Function} work  async (connection) => result
 */
async function withConnection(work) {
  return new Promise((resolve, reject) => {
    const conn = Mikronode.getConnection(cfg.host, cfg.user, cfg.password, cfg.port);
    conn.connect((err, connection) => {
      if (err) return reject(new Error(`Router connect failed: ${err.message}`));

      connection.closeOnDone(true);

      work(connection)
        .then(resolve)
        .catch(reject);
    });
  });
}

/**
 * Unlock a hotspot user immediately after payment.
 * Creates (or updates) the hotspot user record so the MAC is admitted.
 *
 * @param {string} macAddress       Client MAC address
 * @param {number} durationMinutes  Session length in minutes
 */
async function unlockUser(macAddress, durationMinutes) {
  await withConnection(async connection => {
    return new Promise((resolve, reject) => {
      const channel = connection.openChannel('unlock');

      channel.on('error', reject);
      channel.on('done', resolve);

      // Remove stale entry if present (ignore errors)
      channel.write([
        '/ip/hotspot/user/remove',
        `=.id=[find where mac-address=${macAddress}]`,
      ]);

      // Add fresh entry with session limit
      channel.write([
        '/ip/hotspot/user/add',
        `=mac-address=${macAddress}`,
        `=profile=REGULAR`,
        `=limit-uptime=${Math.floor(durationMinutes / 60)}h${durationMinutes % 60}m`,
        `=comment=wifizone-auto`,
      ]);

      channel.close();
    });
  });

  console.log(`[RouterControl] Unlocked ${macAddress} for ${durationMinutes} min`);
}

/**
 * Remove a hotspot user entry (e.g. session expired or quota exceeded).
 * @param {string} macAddress
 */
async function removeUser(macAddress) {
  await withConnection(async connection => {
    return new Promise((resolve, reject) => {
      const channel = connection.openChannel('remove');

      channel.on('error', reject);
      channel.on('done', resolve);

      channel.write([
        '/ip/hotspot/user/remove',
        `=.id=[find where mac-address=${macAddress}]`,
      ]);

      channel.close();
    });
  });

  console.log(`[RouterControl] Removed ${macAddress} from hotspot`);
}

/**
 * Adjust queue max-limits on the router.
 * @param {{ vipMax: string, regularMax: string }} limits  e.g. { vipMax: '15M', regularMax: '4M' }
 */
async function setQueueLimits({ vipMax, regularMax }) {
  await withConnection(async connection => {
    return new Promise((resolve, reject) => {
      const channel = connection.openChannel('queue');

      channel.on('error', reject);
      channel.on('done', resolve);

      const vipName     = cfg.queues.vip.name;
      const regularName = cfg.queues.regular.name;

      channel.write([
        '/queue/tree/set',
        `=.id=[find where name=${vipName}]`,
        `=max-limit=${vipMax}`,
      ]);

      channel.write([
        '/queue/tree/set',
        `=.id=[find where name=${regularName}]`,
        `=max-limit=${regularMax}`,
      ]);

      channel.close();
    });
  });

  console.log(`[RouterControl] Queues → VIP:${vipMax}  REGULAR:${regularMax}`);
}

module.exports = { unlockUser, removeUser, setQueueLimits };
