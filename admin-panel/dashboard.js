/* WIFIZONE ELITE — dashboard.js
   WebSocket client for the operator cockpit. */

(function () {
  'use strict';

  const WS_URL       = `ws://${location.host}`;
  const PING_MS      = 15000;
  const RECONNECT_MS = 3000;
  const HOTSPOT_AUTO_REFRESH_MS = 30000;

  const wsStatus      = document.getElementById('ws-status');
  const revEl         = document.getElementById('revenue-value');
  const clientEl      = document.getElementById('client-count');
  const sessionTbody  = document.getElementById('session-tbody');
  const sessionCount  = document.getElementById('session-count');
  const apStatus      = document.getElementById('autopilot-status');
  const barVip        = document.getElementById('bar-vip');
  const barRegular    = document.getElementById('bar-regular');

  const gaugeLatency  = document.getElementById('gauge-latency');
  const gaugeJitter   = document.getElementById('gauge-jitter');
  const gaugeCpu      = document.getElementById('gauge-cpu');
  const valLatency    = document.getElementById('val-latency');
  const valJitter     = document.getElementById('val-jitter');
  const valCpu        = document.getElementById('val-cpu');
  const telemetryTs   = document.getElementById('telemetry-ts');

  const hotspotTbody  = document.getElementById('hotspot-tbody');
  const hotspotCount  = document.getElementById('hotspot-count');
  const hotspotTs     = document.getElementById('hotspot-last-updated');
  const refreshBtn    = document.getElementById('refresh-hotspot');

  const clockEl       = document.getElementById('clock');

  let ws;
  let pingTimer;
  let sessions = [];

  // Thresholds (mirrors config/router.json values)
  const T = { latencyMs: 150, jitterMs: 30, cpuLoad: 80 };

  // ── Clock ──────────────────────────────────────────────────────────────────
  function tickClock() {
    if (clockEl) clockEl.textContent = new Date().toLocaleTimeString();
  }
  tickClock();
  setInterval(tickClock, 1000);

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
      case 'TELEMETRY':      renderTelemetry(msg.data);  break;
      case 'SESSION_UNLOCK': onUnlock(msg.session);      break;
      case 'STATS':          renderStats(msg.stats);     break;
      case 'pong':           /* heartbeat ack */         break;
    }
  }

  // ── Telemetry ──────────────────────────────────────────────────────────────
  function renderTelemetry(data) {
    if (!data) return;

    valLatency.textContent  = data.latencyMs  ?? '—';
    valJitter.textContent   = data.jitterMs   ?? '—';
    valCpu.textContent      = data.cpuLoad    ?? '—';
    telemetryTs.textContent = data.timestamp
      ? `Last update: ${new Date(data.timestamp).toLocaleTimeString()}`
      : '—';

    setGaugeState(gaugeLatency, data.latencyMs, T.latencyMs);
    setGaugeState(gaugeJitter,  data.jitterMs,  T.jitterMs);
    setGaugeState(gaugeCpu,     data.cpuLoad,   T.cpuLoad);

    const throttled =
      data.latencyMs > T.latencyMs ||
      data.jitterMs  > T.jitterMs  ||
      data.cpuLoad   > T.cpuLoad;

    apStatus.textContent = throttled ? '⚡ THROTTLING ACTIVE' : '● NORMAL SPEED';
    apStatus.className   = throttled ? 'throttled' : 'normal';

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
      id:   session.id,
      mac:  session.mac,
      plan: session.plan,
      ts:   new Date().toLocaleTimeString(),
    });
    if (sessions.length > 50) sessions.length = 50;
    renderSessions();
  }

  function renderSessions() {
    sessionCount.textContent = sessions.length;
    sessionTbody.innerHTML   = '';

    if (sessions.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan   = 4;
      td.className = 'empty-row';
      td.textContent = 'No sessions yet.';
      tr.appendChild(td);
      sessionTbody.appendChild(tr);
      return;
    }

    sessions.forEach((s, i) => {
      const tr = document.createElement('tr');
      if (i === 0) tr.classList.add('pulse');
      [String('#' + s.id), String(s.mac), String(s.plan), String(s.ts)].forEach(text => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      sessionTbody.appendChild(tr);
    });
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  function renderStats(stats) {
    if (!stats) return;
    revEl.textContent    = `₱${parseFloat(stats.total_revenue || 0).toFixed(2)}`;
    clientEl.textContent = stats.total_clients ?? 0;
  }

  // ── Live hotspot users ─────────────────────────────────────────────────────
  function fmtBytes(n) {
    if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
    if (n >= 1048576)    return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024)       return (n / 1024).toFixed(1) + ' KB';
    return n + ' B';
  }

  async function refreshHotspotUsers() {
    refreshBtn.disabled  = true;
    hotspotTs.textContent = 'Loading…';

    try {
      const res   = await fetch('/api/hotspot/users');
      const users = await res.json();

      hotspotCount.textContent  = Array.isArray(users) ? users.length : '—';
      hotspotTs.textContent     = `Last synced: ${new Date().toLocaleTimeString()} · ${Array.isArray(users) ? users.length : 0} user(s)`;
      hotspotTbody.innerHTML    = '';

      if (!Array.isArray(users) || users.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan   = 6;
        td.className = 'empty-row';
        td.textContent = 'No active hotspot users.';
        tr.appendChild(td);
        hotspotTbody.appendChild(tr);
        return;
      }

      users.forEach(u => {
        const tr = document.createElement('tr');
        [u.mac, u.ip, u.uptime, fmtBytes(u.bytesIn), fmtBytes(u.bytesOut), u.idleTime]
          .forEach(text => {
            const td = document.createElement('td');
            td.textContent = text || '—';
            tr.appendChild(td);
          });
        hotspotTbody.appendChild(tr);
      });
    } catch (err) {
      hotspotTs.textContent  = `Error: ${err.message}`;
      hotspotTbody.innerHTML = `<tr><td colspan="6" class="empty-row" style="color:var(--red);">Failed to load hotspot users.</td></tr>`;
    } finally {
      refreshBtn.disabled = false;
    }
  }

  refreshBtn.addEventListener('click', refreshHotspotUsers);

  // Auto-refresh hotspot users every 30 s
  setInterval(refreshHotspotUsers, HOTSPOT_AUTO_REFRESH_MS);

  // ── Init ───────────────────────────────────────────────────────────────────
  connect();

  fetch('/api/stats')
    .then(r => r.json())
    .then(renderStats)
    .catch(() => {});

  // Initial hotspot load
  refreshHotspotUsers();
})();
