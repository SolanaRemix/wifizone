'use strict';

/**
 * WIFIZONE ELITE — router-control.js
 * Communicates with a MikroTik RouterOS device via the API (port 8728)
 * to manage hotspot users: unlock on payment, remove on expiry.
 */

const Mikronode      = require('mikronode-ng');
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

      channel.on('trap',  reject);
      channel.on('error', reject);
      channel.on('done',  resolve);

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

      channel.on('trap',  reject);
      channel.on('error', reject);
      channel.on('done',  resolve);

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
 * Run a single RouterOS command on its own channel and collect returned rows.
 * @param {*} connection
 * @param {string[]} sentence
 * @returns {Promise<object[]>}
 */
function runRouterCommand(connection, sentence) {
  return new Promise((resolve, reject) => {
    const channel = connection.openChannel('queue');
    const rows = [];
    let settled = false;

    const finishReject = err => {
      if (settled) return;
      settled = true;
      channel.close();
      reject(err);
    };

    const finishResolve = () => {
      if (settled) return;
      settled = true;
      channel.close();
      resolve(rows);
    };

    channel.on('data', data => {
      rows.push(data);
    });
    channel.on('trap', finishReject);
    channel.on('error', finishReject);
    channel.on('done', finishResolve);

    channel.write(sentence);
  });
}

/**
 * Resolve a queue tree item's RouterOS `.id` by its configured name.
 * @param {*} connection
 * @param {string} queueName
 * @returns {Promise<string>}
 */
async function getQueueTreeIdByName(connection, queueName) {
  const rows = await runRouterCommand(connection, [
    '/queue/tree/print',
    `?name=${queueName}`,
  ]);

  const match = rows.find(row => row && row['.id'] && row.name === queueName);
  if (!match) {
    throw new Error(`Queue tree item not found: ${queueName}`);
  }

  return match['.id'];
}

/**
 * Adjust queue max-limits on the router.
 * @param {{ vipMax: string, regularMax: string }} limits  e.g. { vipMax: '15M', regularMax: '4M' }
 */
async function setQueueLimits({ vipMax, regularMax }) {
  await withConnection(async connection => {
    const vipName     = cfg.queues.vip.name;
    const regularName = cfg.queues.regular.name;

    const vipId = await getQueueTreeIdByName(connection, vipName);
    const regularId = await getQueueTreeIdByName(connection, regularName);

    await runRouterCommand(connection, [
      '/queue/tree/set',
      `=.id=${vipId}`,
      `=max-limit=${vipMax}`,
    ]);

    await runRouterCommand(connection, [
      '/queue/tree/set',
      `=.id=${regularId}`,
      `=max-limit=${regularMax}`,
    ]);
  });

  console.log(`[RouterControl] Queues → VIP:${vipMax}  REGULAR:${regularMax}`);
}

module.exports = { unlockUser, removeUser, setQueueLimits };
