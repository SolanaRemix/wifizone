'use strict';

/**
 * WIFIZONE ELITE — handoff-buffer.js
 *
 * Tracks per-MAC last-seen timestamps to provide a graceful "Handoff Buffer"
 * during Starlink satellite switching events (~10–15 s connectivity drops).
 *
 * How it works:
 *   1. Call seen(mac) whenever a MAC is observed in the router's active session list.
 *   2. If the gap between two consecutive seen() calls exceeds HANDOFF_BUFFER_MS
 *      the MAC is treated as a genuine disconnect.
 *   3. If the gap is within the buffer window (but long enough to be real absence,
 *      > 200 ms) → a satellite handoff is detected and the caller can extend the
 *      DB session end_time to compensate.
 *   4. isInBuffer(mac) lets the reconciliation loop skip re-provisioning for MACs
 *      that went absent VERY recently (still within the grace window).
 *   5. forget(mac) is called when a MAC is intentionally purged from the router.
 *
 * Configuration (config/router.json):
 *   handoffBufferMs  — grace window in ms (default 15 000)
 */

const { loadConfig } = require('./config-loader');

const _cfg              = loadConfig('router');
const HANDOFF_BUFFER_MS = _cfg.handoffBufferMs || 15000;

// Map<normalised-mac, { lastSeen: number, handoffCount: number }>
const _seen = new Map();

// Telemetry counters
let _handoffEvents   = 0;
let _bufferedDrops   = 0;   // re-add operations skipped due to active buffer
let _confirmedLosses = 0;   // MACs that exceeded the buffer window

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Record that a MAC address is currently visible in the router's hotspot.
 * If the gap since the previous seen() call falls within the handoff window
 * this is considered a satellite-handoff recovery event.
 *
 * @param {string} mac
 * @returns {{ wasHandoff: boolean, downMs: number }}
 */
function seen(mac) {
  const key = mac.toLowerCase();
  const now = Date.now();
  const entry = _seen.get(key);

  if (!entry) {
    _seen.set(key, { lastSeen: now, handoffCount: 0 });
    return { wasHandoff: false, downMs: 0 };
  }

  const downMs = now - entry.lastSeen;
  // A gap > 200 ms but < HANDOFF_BUFFER_MS indicates a transient satellite switch.
  // 200 ms lower-bound avoids false positives from back-to-back fast polls.
  const wasHandoff = downMs > 200 && downMs < HANDOFF_BUFFER_MS;

  if (wasHandoff) {
    entry.handoffCount++;
    _handoffEvents++;
  }

  entry.lastSeen = now;
  return { wasHandoff, downMs: wasHandoff ? downMs : 0 };
}

/**
 * Check whether a MAC is still within its handoff grace window.
 * Returns true when the MAC was seen recently (lastSeen < HANDOFF_BUFFER_MS ago),
 * meaning we should NOT yet act on its absence from the router (satellite may still
 * be switching).
 *
 * @param {string} mac
 * @returns {boolean}
 */
function isInBuffer(mac) {
  const entry = _seen.get(mac.toLowerCase());
  if (!entry) return false;
  return (Date.now() - entry.lastSeen) < HANDOFF_BUFFER_MS;
}

/**
 * Record that a re-add operation was skipped because the MAC was still buffered.
 */
function recordBufferedDrop() {
  _bufferedDrops++;
}

/**
 * Record that a MAC exceeded the handoff window (genuine loss).
 */
function recordConfirmedLoss() {
  _confirmedLosses++;
}

/**
 * Remove a MAC from the tracker (session expired or operator-kicked).
 *
 * @param {string} mac
 */
function forget(mac) {
  _seen.delete(mac.toLowerCase());
}

/**
 * Return current telemetry metrics.
 *
 * @returns {{ bufferMs, trackedMacs, handoffEvents, bufferedDrops, confirmedLosses }}
 */
function metrics() {
  return {
    bufferMs:        HANDOFF_BUFFER_MS,
    trackedMacs:     _seen.size,
    handoffEvents:   _handoffEvents,
    bufferedDrops:   _bufferedDrops,
    confirmedLosses: _confirmedLosses,
  };
}

module.exports = { seen, isInBuffer, recordBufferedDrop, recordConfirmedLoss, forget, metrics };
