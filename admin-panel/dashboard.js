/* WIFIZONE ELITE — dashboard.js
   WebSocket client for the operator cockpit. */

(function () {
  'use strict';

  const WS_URL       = `ws://${location.host}`;
  const PING_MS      = 15000;
  const RECONNECT_MS = 3000;

  const wsStatus     = document.getElementById('ws-status');
  const revEl        = document.getElementById('revenue-value');
  const clientEl     = document.getElementById('client-count');
  const sessionTbody = document.getElementById('session-tbody');
  const apStatus     = document.getElementById('autopilot-status');
  const barVip       = document.getElementById('bar-vip');
  const barRegular   = document.getElementById('bar-regular');

  const gaugeLatency = document.getElementById('gauge-latency');
  const gaugeJitter  = document.getElementById('gauge-jitter');
  const gaugeCpu     = document.getElementById('gauge-cpu');
  const valLatency   = document.getElementById('val-latency');
  const valJitter    = document.getElementById('val-jitter');
  const valCpu       = document.getElementById('val-cpu');
  const telemetryTs  = document.getElementById('telemetry-ts');

  let ws;
  let pingTimer;
  let sessions = [];

  // Thresholds (mirrors config/router.json values)
  const T = { latencyMs: 150, jitterMs: 30, cpuLoad: 80 };

  // ── WebSocket ──────────────────────────────────────────────────────────────
  function connect() {
    ws = new WebSocket(WS_URL);

    ws.addEventListener('open', () => {
      wsStatus.textContent = '● LIVE';
      wsStatus.className   = 'connected';
      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, PING_MS);
    });

    ws.addEventListener('close', () => {
      wsStatus.textContent = '● OFFLINE';
      wsStatus.className   = 'error';
      clearInterval(pingTimer);
      setTimeout(connect, RECONNECT_MS);
    });

    ws.addEventListener('error', () => {
      wsStatus.textContent = '● ERROR';
      wsStatus.className   = 'error';
    });

    ws.addEventListener('message', event => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch (_) { /* ignore */ }
    });
  }

  // ── Message handler ────────────────────────────────────────────────────────
  function handleMessage(msg) {
    switch (msg.type) {
      case 'TELEMETRY':     renderTelemetry(msg.data);  break;
      case 'SESSION_UNLOCK': onUnlock(msg.session);     break;
      case 'STATS':         renderStats(msg.stats);     break;
      case 'pong':          /* heartbeat ack */         break;
    }
  }

  // ── Telemetry ──────────────────────────────────────────────────────────────
  function renderTelemetry(data) {
    if (!data) return;

    valLatency.textContent  = data.latencyMs  ?? '—';
    valJitter.textContent   = data.jitterMs   ?? '—';
    valCpu.textContent      = data.cpuLoad    ?? '—';
    telemetryTs.textContent = data.timestamp  ? new Date(data.timestamp).toLocaleTimeString() : '—';

    setGaugeState(gaugeLatency, data.latencyMs, T.latencyMs);
    setGaugeState(gaugeJitter,  data.jitterMs,  T.jitterMs);
    setGaugeState(gaugeCpu,     data.cpuLoad,   T.cpuLoad);

    // Autopilot indicator
    const throttled =
      data.latencyMs > T.latencyMs ||
      data.jitterMs  > T.jitterMs  ||
      data.cpuLoad   > T.cpuLoad;

    apStatus.textContent = throttled ? '⚡ THROTTLING ACTIVE' : '● NORMAL SPEED';
    apStatus.className   = throttled ? 'throttled' : 'normal';

    // Queue bars — 100 % = normal, 75 % = throttled
    barVip.style.width     = throttled ? '75%' : '100%';
    barRegular.style.width = throttled ? '80%' : '100%';
  }

  function setGaugeState(el, value, limit) {
    el.classList.remove('ok', 'warn', 'danger');
    if (value === undefined || value === null) { el.classList.add('ok'); return; }
    if (value < limit * 0.75)     el.classList.add('ok');
    else if (value < limit)       el.classList.add('warn');
    else                          el.classList.add('danger');
  }

  // ── Session unlock ─────────────────────────────────────────────────────────
  function onUnlock(session) {
    sessions.unshift({
      id:  session.id,
      mac: session.mac,
      plan: session.plan,
      ts:  new Date().toLocaleTimeString(),
    });
    // Keep last 50 only
    if (sessions.length > 50) sessions.length = 50;
    renderSessions();
  }

  function renderSessions() {
    if (sessions.length === 0) {
      sessionTbody.innerHTML = '<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:20px;">No sessions yet.</td></tr>';
      return;
    }

    sessionTbody.innerHTML = sessions.map((s, i) =>
      `<tr class="${i === 0 ? 'pulse' : ''}">
        <td>#${s.id}</td>
        <td>${escHtml(s.mac)}</td>
        <td>${escHtml(s.plan)}</td>
        <td>${escHtml(s.ts)}</td>
      </tr>`
    ).join('');
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  function renderStats(stats) {
    if (!stats) return;
    revEl.textContent    = `₱${parseFloat(stats.total_revenue || 0).toFixed(2)}`;
    clientEl.textContent = stats.total_clients ?? 0;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  connect();

  // Fetch initial stats on load
  fetch('/api/stats')
    .then(r => r.json())
    .then(renderStats)
    .catch(() => {});
})();
