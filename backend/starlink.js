'use strict';

/**
 * WIFIZONE ELITE — starlink.js
 * Polls the MikroTik router's SNMP OIDs every 5 seconds to obtain
 * Starlink dish telemetry (latency, jitter, CPU load).  If thresholds
 * are exceeded the autopilot is notified and, as a last resort, the
 * dish is rebooted via the router API.
 *
 * Events emitted:
 *   'telemetry'  { latencyMs, jitterMs, cpuLoad, timestamp }
 *   'threshold'  { reason, value, limit }
 */

const EventEmitter   = require('events');
const snmp           = require('net-snmp');
const { loadConfig } = require('./config-loader');

const _fileCfg = loadConfig('router');
const cfg = {
  ..._fileCfg,
  host: process.env.ROUTER_HOST || _fileCfg.host,
};

// ── OIDs (MikroTik RouterOS SNMP) ────────────────────────────────────────────
// These are standard MikroTik OIDs; adjust if using Starlink SNMP directly.
const OID_PING_RTT    = '1.3.6.1.4.1.14988.1.1.7.4.0';  // approximate latency
const OID_JITTER      = '1.3.6.1.4.1.14988.1.1.7.5.0';  // approximate jitter
const OID_CPU_LOAD    = '1.3.6.1.2.1.25.3.3.1.2.1';     // hrProcessorLoad

const POLL_INTERVAL_MS = 5000;

class StarlinkMonitor extends EventEmitter {
  constructor() {
    super();
    this._snapshot    = null;
    this._timer       = null;
    this._rebootCooldown = false;
  }

  /** Return last known telemetry snapshot (or null). */
  getSnapshot() {
    return this._snapshot;
  }

  /** Start periodic SNMP polling. */
  startPolling() {
    if (this._timer) return;
    console.log('[Starlink] SNMP polling started');
    this._poll();
    this._timer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
  }

  /** Stop polling. */
  stopPolling() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _poll() {
    const session = snmp.createSession(cfg.host, cfg.snmp.community, {
      version: snmp.Version2c,
      port:    cfg.snmp.port,
      timeout: 4000,
      retries: 1,
    });

    session.get([OID_PING_RTT, OID_JITTER, OID_CPU_LOAD], (err, varbinds) => {
      session.close();

      if (err) {
        console.warn('[Starlink] SNMP error:', err.message);
        return;
      }

      const latencyMs  = this._val(varbinds, 0);
      const jitterMs   = this._val(varbinds, 1);
      const cpuLoad    = this._val(varbinds, 2);

      const snapshot = {
        latencyMs,
        jitterMs,
        cpuLoad,
        timestamp: new Date().toISOString(),
      };

      this._snapshot = snapshot;
      this.emit('telemetry', snapshot);

      // Threshold checks
      if (latencyMs > cfg.thresholds.latencyMs) {
        this.emit('threshold', { reason: 'latency', value: latencyMs, limit: cfg.thresholds.latencyMs });
        this._handleDishIssue('high latency');
      }

      if (jitterMs > cfg.thresholds.jitterMs) {
        this.emit('threshold', { reason: 'jitter', value: jitterMs, limit: cfg.thresholds.jitterMs });
        this._handleDishIssue('high jitter');
      }
    });
  }

  /**
   * When telemetry exceeds thresholds, attempt to reboot the Starlink dish
   * via the MikroTik RouterOS API (subject to cooldown).
   */
  _handleDishIssue(reason) {
    if (this._rebootCooldown) return;

    console.warn(`[Starlink] Dish issue detected: ${reason}. Scheduling reboot.`);
    this._rebootCooldown = true;

    // Cool-down: don't reboot again for 10 minutes
    setTimeout(() => { this._rebootCooldown = false; }, 10 * 60 * 1000);

    // Trigger reboot via RouterOS script (Starlink is connected to ether1)
    this._rebootDish().catch(err => {
      console.error('[Starlink] Reboot failed:', err.message);
    });
  }

  async _rebootDish() {
    // We reboot the Starlink dish by momentarily toggling the PoE output
    // on the MikroTik port connected to it using a RouterOS script.
    // MikroNode is required lazily here to avoid a circular dependency:
    // server.js → starlink.js and server.js → router-control.js both load at
    // startup, so a top-level require inside starlink would create a cycle.
    // The lazy require resolves safely after all modules load.
    const MikroNode = require('mikronode');
    const host     = cfg.host     || '192.168.88.1';
    const port     = cfg.port     || 8728;
    const user     = cfg.user     || 'admin';
    const password = cfg.password || '';

    console.log('[Starlink] Issuing dish reboot via RouterOS API /system/script/run...');

    await new Promise((resolve, reject) => {
      const device = new MikroNode(host, port);
      device.connect((err, connection) => {
        if (err) return reject(new Error(`Router connect failed: ${err.message}`));
        connection.login(user, password, (err2) => {
          if (err2) {
            try { connection.close(); } catch (_) {}
            return reject(new Error(`Router login failed: ${err2.message}`));
          }

          const chan = connection.openChannel('dish-reboot');
          chan.on('trap',  e  => { connection.close(); reject(new Error(`Reboot script error: ${e}`)); });
          chan.on('error', e  => { connection.close(); reject(e); });
          chan.on('done',  () => { connection.close(); resolve(); });

          // Run a RouterOS script named "dish-reboot" that has been pre-created on
          // the router.  The script should toggle PoE on the Starlink-facing port,
          // e.g.:  /interface/ethernet/poe/set [find name=ether1] poe-out=off;
          //        :delay 5; /interface/ethernet/poe/set [find name=ether1] poe-out=auto-on;
          chan.write(['/system/script/run', '=name=dish-reboot'], true);
        });
      });
    });

    console.log('[Starlink] Dish reboot command issued successfully.');
  }

  _val(varbinds, idx) {
    if (!varbinds[idx] || snmp.isVarbindError(varbinds[idx])) return 0;
    return parseInt(varbinds[idx].value, 10) || 0;
  }
}

const monitor = new StarlinkMonitor();

module.exports = {
  on:           (event, fn) => monitor.on(event, fn),
  startPolling: ()          => monitor.startPolling(),
  stopPolling:  ()          => monitor.stopPolling(),
  getSnapshot:  ()          => monitor.getSnapshot(),
};
