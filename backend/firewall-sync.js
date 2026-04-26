'use strict';

/**
 * WIFIZONE ELITE — firewall-sync.js
 *
 * Zero-Drift reconciliation loop: keeps the MikroTik hotspot sessions in
 * perfect sync with the application's active-sessions database.
 *
 * Architecture
 * ────────────
 * Two overlapping timers share a single syncUsers() call per tick:
 *
 *   1. MAC-presence poller (every PRESENCE_POLL_MS, default 5 s)
 *      • Calls mikrotik.syncUsers() and feeds results into handoff-buffer.
 *      • Updates last-seen timestamps so the buffer stays fresh.
 *      • Skips the tick if the previous one is still in flight.
 *
 *   2. Full reconciliation (every RECONCILE_INTERVAL_MS, default 60 s)
 *      • Compares DB active sessions with live router sessions.
 *      • Purges unauthorised MACs from the router (present on the router
 *        but not in the DB → router has a stale/unauthorised entry).
 *      • Re-provisions MACs that are in DB but missing from the router
 *        (handles lost state after network hiccups), skipping any that are
 *        still within their handoff-buffer grace window.
 *      • Extends DB session end_time for MACs that just recovered from a
 *        satellite handoff (compensates the client for the downtime).
 *
 * All operations are idempotent: mikrotik.addUser() removes before adding,
 * so retries never create duplicate hotspot entries.
 *
 * Configuration (config/router.json):
 *   reconcileIntervalMs  — full reconciliation period (default 60 000 ms)
 *   handoffBufferMs      — MAC grace window            (default 15 000 ms)
 *   presencePollMs       — how often to poll for MAC presence (default  5 000 ms)
 *                          Must be significantly smaller than handoffBufferMs so the
 *                          buffer can detect transient absences within the grace window.
 */

const mikrotik      = require('./mikrotik');
const handoffBuffer = require('./handoff-buffer');
const logRing       = require('./log-ring');
const { loadConfig } = require('./config-loader');

const _cfg                  = loadConfig('router');
const RECONCILE_INTERVAL_MS = _cfg.reconcileIntervalMs || 60000;
// presencePollMs is intentionally decoupled from handoffBufferMs so the
// buffer can observe multiple absences within a single grace window.
// Default: 5 s (3× within the 15 s handoff window).
const PRESENCE_POLL_MS      = _cfg.presencePollMs      || 5000;

let _db            = null;
let _presenceTimer = null;
let _inFlight      = false;   // in-flight guard — skip tick if prior one is still running

// Cumulative statistics
let _runs            = 0;
let _totalAdded      = 0;
let _totalRemoved    = 0;
let _totalSkipped    = 0;
let _totalHandoffs   = 0;
let _lastRunAt       = null;
let _lastRunMetrics  = null;

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Fetch live hotspot sessions from the router and update the handoff buffer.
 * Returns the array of router sessions (or an empty array on error).
 *
 * @returns {Promise<Array>}
 */
async function _fetchAndUpdateBuffer() {
  try {
    const sessions = await mikrotik.syncUsers();
    for (const s of sessions) {
      if (s.mac) {
        const { wasHandoff, downMs } = handoffBuffer.seen(s.mac);
        if (wasHandoff) {
          logRing.push({
            level:  'info',
            module: 'HandoffBuffer',
            msg:    `Satellite handoff detected — MAC ${s.mac} was offline ${downMs} ms`,
            meta:   { mac: s.mac, downMs },
          });
        }
      }
    }
    return sessions;
  } catch (err) {
    logRing.push({
      level:  'warn',
      module: 'FirewallSync',
      msg:    `MAC presence poll failed: ${err.message}`,
    });
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Inject the mysql2 pool.  Must be called before start().
 *
 * @param {object} pool  mysql2/promise connection pool
 */
function init(pool) {
  _db = pool;
}

/**
 * Perform one full reconciliation pass.
 *
 * @param {Array} [cachedRouterSessions]  Pre-fetched router sessions (avoids
 *        an extra syncUsers() call when invoked from the combined tick loop).
 * @returns {Promise<{ added: number, removed: number, skipped: number,
 *                     handoffs: number, errors: number }>}
 */
async function reconcile(cachedRouterSessions) {
  if (!_db) throw new Error('[FirewallSync] DB pool not initialised — call init(pool) first');

  const t0 = Date.now();
  let added = 0, removed = 0, skipped = 0, handoffs = 0, errors = 0;

  // ── 1. Fetch ground truth from DB ─────────────────────────────────────────
  const [dbRows] = await _db.query(
    `SELECT s.id AS session_id, u.mac_address, s.end_time, p.name AS profile
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN plans p ON p.id = s.plan_id
      WHERE s.status = 'active'
        AND (s.end_time IS NULL OR s.end_time > NOW())`
  );

  // ── 2. Fetch ground truth from router ─────────────────────────────────────
  let routerSessions = cachedRouterSessions;
  if (!routerSessions) {
    try {
      routerSessions = await mikrotik.syncUsers();
    } catch (err) {
      logRing.push({
        level:  'error',
        module: 'FirewallSync',
        msg:    `Cannot reconcile — router fetch failed: ${err.message}`,
      });
      return { added: 0, removed: 0, skipped: 0, handoffs: 0, errors: 1 };
    }
  }

  // Build normalised lookup structures
  const dbMacs     = new Map(dbRows.map(r => [r.mac_address.toLowerCase(), r]));
  const routerMacs = new Map(routerSessions.map(r => [r.mac.toLowerCase(), r]));

  // ── 3. Purge router MACs that are NOT in the DB ────────────────────────────
  for (const [routerMac, routerSession] of routerMacs) {
    if (!dbMacs.has(routerMac)) {
      // Use the original MAC casing from the router session so the RouterOS
      // user name lookup matches exactly what was created at provisioning time.
      const originalMac = routerSession.mac;
      try {
        await mikrotik.removeUser(originalMac);
        handoffBuffer.forget(routerMac);
        logRing.push({
          level:  'info',
          module: 'FirewallSync',
          msg:    `Purged unauthorised MAC from router: ${originalMac}`,
          meta:   { mac: originalMac },
        });
        removed++;
      } catch (err) {
        logRing.push({
          level:  'error',
          module: 'FirewallSync',
          msg:    `Failed to remove ${originalMac}: ${err.message}`,
          meta:   { mac: originalMac },
        });
        errors++;
      }
    }
  }

  // ── 4. Re-provision DB MACs not present in the router ────────────────────
  for (const [mac, row] of dbMacs) {
    if (routerMacs.has(mac)) {
      // Both sides have this MAC — check for handoff recovery
      const { wasHandoff, downMs } = handoffBuffer.seen(mac);
      if (wasHandoff && downMs > 0) {
        const extendSecs = Math.ceil(downMs / 1000);
        try {
          await _db.query(
            'UPDATE sessions SET end_time = DATE_ADD(end_time, INTERVAL ? SECOND) WHERE id = ?',
            [extendSecs, row.session_id]
          );
          logRing.push({
            level:  'info',
            module: 'FirewallSync',
            msg:    `Handoff recovery: extended session ${row.session_id} for ${mac} by ${extendSecs}s`,
            meta:   { mac, sessionId: row.session_id, extendSecs, downMs },
          });
          handoffs++;
          _totalHandoffs++;
        } catch (err) {
          logRing.push({
            level:  'error',
            module: 'FirewallSync',
            msg:    `Failed to extend session for handoff MAC ${mac}: ${err.message}`,
            meta:   { mac },
          });
        }
      }
      continue;
    }

    // MAC is in DB but NOT in router — decide whether to re-provision

    // If MAC went absent very recently (within buffer window), skip this cycle
    // to give Starlink time to complete the satellite switch.
    if (handoffBuffer.isInBuffer(mac)) {
      handoffBuffer.recordBufferedDrop();
      logRing.push({
        level:  'info',
        module: 'FirewallSync',
        msg:    `Handoff buffer active for ${mac} — deferring re-provision`,
        meta:   { mac },
      });
      skipped++;
      continue;
    }

    // Calculate remaining paid time
    const remaining = row.end_time
      ? Math.max(0, Math.floor((new Date(row.end_time) - Date.now()) / 1000))
      : 3600;

    if (remaining <= 0) {
      // Session end_time has passed — will be cleaned up by status update
      skipped++;
      continue;
    }

    // Re-provision: idempotent addUser removes any stale entry first.
    // Use row.mac_address (canonical DB value) to keep RouterOS name casing
    // consistent with the original provisioning done by confirmPayment().
    try {
      await mikrotik.addUser(row.mac_address, remaining, row.profile || 'REGULAR');
      logRing.push({
        level:  'info',
        module: 'FirewallSync',
        msg:    `Re-provisioned missing MAC: ${row.mac_address} (${remaining}s remaining)`,
        meta:   { mac: row.mac_address, sessionId: row.session_id, remaining },
      });
      handoffBuffer.recordConfirmedLoss();
      added++;
    } catch (err) {
      logRing.push({
        level:  'error',
        module: 'FirewallSync',
        msg:    `Failed to re-provision ${row.mac_address}: ${err.message}`,
        meta:   { mac: row.mac_address },
      });
      errors++;
    }
  }

  const durationMs = Date.now() - t0;

  _lastRunAt = new Date().toISOString();
  _lastRunMetrics = {
    added,
    removed,
    skipped,
    handoffs,
    errors,
    durationMs,
    dbSessions:     dbMacs.size,
    routerSessions: routerMacs.size,
  };

  _runs++;
  _totalAdded   += added;
  _totalRemoved += removed;
  _totalSkipped += skipped;

  logRing.push({
    level:  'info',
    module: 'FirewallSync',
    msg:    `Reconciliation #${_runs} complete`,
    meta:   _lastRunMetrics,
  });

  return { added, removed, skipped, handoffs, errors };
}

/**
 * Start the presence poller and the reconciliation loop.
 * Idempotent — safe to call multiple times.
 */
function start() {
  if (_presenceTimer) return;

  console.log(
    `[FirewallSync] Zero-Drift sync started` +
    ` — presence ${PRESENCE_POLL_MS} ms, reconcile ${RECONCILE_INTERVAL_MS} ms`
  );

  // How many presence ticks fit in one reconciliation interval (minimum 1).
  // Use Math.floor to ensure reconciliation never runs more frequently than
  // the configured interval when intervals are not evenly divisible.
  const ticksPerReconcile = Math.max(1, Math.floor(RECONCILE_INTERVAL_MS / PRESENCE_POLL_MS));
  let tick = 0;

  _presenceTimer = setInterval(async () => {
    // Skip this tick entirely if the previous one hasn't finished yet.
    // This prevents concurrent MikroTik calls and DB updates under slow
    // router/network conditions (e.g. Starlink congestion).
    if (_inFlight) {
      logRing.push({
        level:  'warn',
        module: 'FirewallSync',
        msg:    'Skipping presence tick — previous tick still in flight',
      });
      return;
    }

    tick++;
    _inFlight = true;
    try {
      // Always update the handoff buffer
      const sessions = await _fetchAndUpdateBuffer();

      // Full reconciliation every ticksPerReconcile ticks
      if (tick % ticksPerReconcile === 0) {
        await reconcile(sessions);
      }
    } catch (err) {
      console.error('[FirewallSync]', err.message);
    } finally {
      _inFlight = false;
    }
  }, PRESENCE_POLL_MS);
}

/**
 * Stop all timers.
 */
function stop() {
  if (_presenceTimer) {
    clearInterval(_presenceTimer);
    _presenceTimer = null;
  }
}

/**
 * Return cumulative statistics for the firewall sync module.
 *
 * @returns {object}
 */
function stats() {
  return {
    runs:              _runs,
    totalAdded:        _totalAdded,
    totalRemoved:      _totalRemoved,
    totalSkipped:      _totalSkipped,
    totalHandoffs:     _totalHandoffs,
    lastRunAt:         _lastRunAt,
    lastRunMetrics:    _lastRunMetrics,
    reconcileIntervalMs: RECONCILE_INTERVAL_MS,
    presencePollMs:    PRESENCE_POLL_MS,
  };
}

module.exports = { init, start, stop, reconcile, stats };
