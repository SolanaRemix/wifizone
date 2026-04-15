'use strict';

/**
 * WIFIZONE ELITE — autopilot.js
 * Monitors router CPU load and Starlink telemetry, then dynamically
 * adjusts MikroTik queue limits so heavy load doesn't saturate the link.
 *
 * Logic:
 *   - Every autopilotIntervalMs (default 30 s) read latest telemetry.
 *   - If CPU > threshold OR latency > threshold → throttle queues.
 *   - Otherwise restore to full speed.
 */

'use strict';

const routerControl = require('./router-control');
const starlink      = require('./starlink');
const cfg           = require('../config/router.json');

let _timer     = null;
let _throttled = false;

async function evaluate() {
  const snapshot = starlink.getSnapshot();
  if (!snapshot) return; // No telemetry yet

  const shouldThrottle =
    snapshot.cpuLoad  > cfg.thresholds.cpuLoadPercent ||
    snapshot.latencyMs > cfg.thresholds.latencyMs     ||
    snapshot.jitterMs  > cfg.thresholds.jitterMs;

  if (shouldThrottle && !_throttled) {
    console.log('[Autopilot] Throttling queues — load:', snapshot.cpuLoad,
                'latency:', snapshot.latencyMs, 'ms');
    await routerControl.setQueueLimits({
      vipMax:     cfg.queues.vip.throttledMax,
      regularMax: cfg.queues.regular.throttledMax,
    });
    _throttled = true;
  } else if (!shouldThrottle && _throttled) {
    console.log('[Autopilot] Restoring full queue limits');
    await routerControl.setQueueLimits({
      vipMax:     cfg.queues.vip.normalMax,
      regularMax: cfg.queues.regular.normalMax,
    });
    _throttled = false;
  }
}

function start() {
  if (_timer) return;
  console.log('[Autopilot] Started — interval', cfg.autopilotIntervalMs, 'ms');
  _timer = setInterval(async () => {
    try {
      await evaluate();
    } catch (err) {
      console.error('[Autopilot]', err.message);
    }
  }, cfg.autopilotIntervalMs);
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = { start, stop, evaluate };
