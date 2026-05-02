/* WIFIZONE ELITE — dashboard.js
   WebSocket client for the operator cockpit. */

(function () {
  'use strict';

  // Derive WebSocket scheme from the page protocol so wss:// is used over HTTPS.
  const wsScheme     = location.protocol === 'https:' ? 'wss' : 'ws';
  const PING_MS      = 15000;
  const RECONNECT_MS = 3000;
  const HOTSPOT_AUTO_REFRESH_MS = 30000;

  // Operator API token — stored in sessionStorage so operators don't have to
  // re-enter on every page reload within the same session.
  // Set OPERATOR_API_TOKEN on the server to enable auth.
  let OPERATOR_TOKEN = sessionStorage.getItem('OPERATOR_TOKEN') || '';

  function getAuthHeaders() {
    return OPERATOR_TOKEN ? { Authorization: `Bearer ${OPERATOR_TOKEN}` } : {};
  }

  // Include the operator token as a ?token= query param so the server can
  // authenticate the WebSocket upgrade the same way as Bearer-token REST calls.
  function buildWsUrl() {
    const base = `${wsScheme}://${location.host}`;
    return OPERATOR_TOKEN ? `${base}?token=${encodeURIComponent(OPERATOR_TOKEN)}` : base;
  }

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

  // Pending sessions elements
  const pendingTbody  = document.getElementById('pending-tbody');
  const pendingCount  = document.getElementById('pending-count');
  const pendingTs     = document.getElementById('pending-ts');
  const refreshPending = document.getElementById('refresh-pending');

  // Plans elements
  const plansTbody    = document.getElementById('plans-tbody');
  const refreshPlans  = document.getElementById('refresh-plans');
  const addPlanForm   = document.getElementById('add-plan-form');
  const planFormMsg   = document.getElementById('plan-form-msg');

  // WAN elements
  const wanList       = document.getElementById('wan-list');
  const refreshWan    = document.getElementById('refresh-wan');

  let ws;
  let pingTimer;
  let sessions = [];

  // Thresholds — defaults used until the backend config is fetched on load.
  // Fetched from /api/config/thresholds so the UI reflects the actual autopilot
  // behaviour configured in config/router(.local).json.
  let T = { latencyMs: 150, jitterMs: 30, cpuLoad: 80 };

  fetch('/api/config/thresholds', { headers: getAuthHeaders() })
    .then(r => r.ok ? r.json() : null)
    .then(data => { if (data) T = data; })
    .catch(err => console.warn('[Dashboard] Failed to load thresholds:', err));

  // ── Clock ──────────────────────────────────────────────────────────────────
  function tickClock() {
    if (clockEl) clockEl.textContent = new Date().toLocaleTimeString();
  }
  tickClock();
  setInterval(tickClock, 1000);

  // ── WebSocket ──────────────────────────────────────────────────────────────
  function connect() {
    ws = new WebSocket(buildWsUrl());

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
    // Refresh pending list since an activation may have just happened
    refreshPendingSessions();
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
      const res   = await fetch('/api/hotspot/users', { headers: getAuthHeaders() });
      if (res.status === 401) {
        promptToken();
        hotspotTs.textContent = 'Authentication required.';
        return;
      }
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

  // ── Pending Sessions ───────────────────────────────────────────────────────
  async function refreshPendingSessions() {
    if (refreshPending) refreshPending.disabled = true;
    try {
      const res  = await fetch('/api/sessions/pending', { headers: getAuthHeaders() });
      if (res.status === 401) { promptToken(); return; }
      const rows = await res.json();

      pendingCount.textContent = Array.isArray(rows) ? rows.length : '0';
      pendingTs.textContent    = `Last checked: ${new Date().toLocaleTimeString()} · ${Array.isArray(rows) ? rows.length : 0} pending`;
      pendingTbody.innerHTML   = '';

      if (!Array.isArray(rows) || rows.length === 0) {
        pendingTbody.innerHTML = '<tr><td colspan="7" class="empty-row">No pending payments.</td></tr>';
        return;
      }

      rows.forEach(row => {
        const tr = document.createElement('tr');

        const cells = [
          '#' + row.id,
          row.mac_address,
          row.plan_name,
          '₱' + parseFloat(row.price_pesos).toFixed(2),
          row.reference_txn,
          new Date(row.start_time).toLocaleString(),
        ];
        cells.forEach(text => {
          const td = document.createElement('td');
          td.textContent = text || '—';
          tr.appendChild(td);
        });

        // Activate button
        const tdBtn = document.createElement('td');
        const btn   = document.createElement('button');
        btn.className   = 'refresh-btn';
        btn.textContent = '✔ Activate';
        btn.style.borderColor = 'var(--green)';
        btn.style.color       = 'var(--green)';
        btn.addEventListener('click', () => activateSession(row.id, row.reference_txn, btn));
        tdBtn.appendChild(btn);
        tr.appendChild(tdBtn);

        pendingTbody.appendChild(tr);
      });
    } catch (err) {
      pendingTs.textContent  = `Error: ${err.message}`;
      pendingTbody.innerHTML = '<tr><td colspan="7" class="empty-row" style="color:var(--red);">Failed to load pending sessions.</td></tr>';
    } finally {
      if (refreshPending) refreshPending.disabled = false;
    }
  }

  async function activateSession(sessionId, txnRef, btn) {
    if (!txnRef) {
      alert('No reference number found for this session.');
      return;
    }
    if (!confirm(`Activate session #${sessionId} with reference: ${txnRef}?`)) return;
    btn.disabled    = true;
    btn.textContent = '…';

    try {
      const res  = await fetch(`/api/session/${sessionId}/activate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body:    JSON.stringify({ txn_id: txnRef }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`Activation failed: ${data.error}`);
        btn.disabled    = false;
        btn.textContent = '✔ Activate';
      } else {
        btn.textContent = '✅ Done';
        // Refresh pending list after short delay
        setTimeout(refreshPendingSessions, 800);
      }
    } catch (err) {
      alert(`Network error: ${err.message}`);
      btn.disabled    = false;
      btn.textContent = '✔ Activate';
    }
  }

  if (refreshPending) refreshPending.addEventListener('click', refreshPendingSessions);
  // Auto-refresh pending every 30 s
  setInterval(refreshPendingSessions, 30000);

  // ── Plans Management ───────────────────────────────────────────────────────
  const MINS_PER_MONTH = 43200;
  const MINS_PER_WEEK  = 10080;
  const MINS_PER_DAY   = 1440;
  const MINS_PER_HOUR  = 60;

  function fmtDuration(mins) {
    if (mins >= MINS_PER_MONTH) return `${Math.round(mins / MINS_PER_MONTH)} Month`;
    if (mins >= MINS_PER_WEEK)  return `${Math.round(mins / MINS_PER_WEEK)} Week(s)`;
    if (mins >= MINS_PER_DAY)   return `${Math.round(mins / MINS_PER_DAY)} Day(s)`;
    if (mins >= MINS_PER_HOUR)  return `${Math.round(mins / MINS_PER_HOUR)} Hour(s)`;
    return `${mins} Min`;
  }

  async function loadPlans() {
    try {
      const res   = await fetch('/api/plans', { headers: getAuthHeaders() });
      const plans = await res.json();
      plansTbody.innerHTML = '';

      if (!Array.isArray(plans) || plans.length === 0) {
        plansTbody.innerHTML = '<tr><td colspan="5" class="empty-row">No plans configured.</td></tr>';
        return;
      }

      plans.forEach(plan => {
        const tr = document.createElement('tr');
        [
          String(plan.id),
          plan.name,
          fmtDuration(plan.duration_minutes),
          '₱' + parseFloat(plan.price_pesos).toFixed(2),
        ].forEach(text => {
          const td = document.createElement('td');
          td.textContent = text;
          tr.appendChild(td);
        });

        // Delete button
        const tdBtn = document.createElement('td');
        const delBtn = document.createElement('button');
        delBtn.className   = 'refresh-btn';
        delBtn.textContent = '✕ Delete';
        delBtn.style.borderColor = 'var(--red)';
        delBtn.style.color       = 'var(--red)';
        delBtn.addEventListener('click', () => deletePlan(plan.id, plan.name, delBtn));
        tdBtn.appendChild(delBtn);
        tr.appendChild(tdBtn);

        plansTbody.appendChild(tr);
      });
    } catch (err) {
      plansTbody.innerHTML = `<tr><td colspan="5" class="empty-row" style="color:var(--red);">Error: ${err.message}</td></tr>`;
    }
  }

  async function deletePlan(planId, planName, btn) {
    if (!confirm(`Delete plan "${planName}"? This cannot be undone.`)) return;
    btn.disabled = true;
    try {
      const res  = await fetch(`/api/plans/${planId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`Delete failed: ${data.error}`);
        btn.disabled = false;
      } else {
        loadPlans();
      }
    } catch (err) {
      alert(`Network error: ${err.message}`);
      btn.disabled = false;
    }
  }

  if (addPlanForm) {
    addPlanForm.addEventListener('submit', async e => {
      e.preventDefault();
      planFormMsg.textContent = '';
      const name    = document.getElementById('plan-name').value.trim();
      const minutes = parseInt(document.getElementById('plan-minutes').value, 10);
      const price   = parseFloat(document.getElementById('plan-price').value);

      if (!name || isNaN(minutes) || minutes <= 0 || isNaN(price) || price <= 0) {
        planFormMsg.textContent = '⚠ Fill in all fields correctly.';
        planFormMsg.style.color = 'var(--red)';
        return;
      }

      try {
        const res  = await fetch('/api/plans', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body:    JSON.stringify({ name, duration_minutes: minutes, price_pesos: price }),
        });
        const data = await res.json();
        if (!res.ok) {
          planFormMsg.textContent = `⚠ ${data.error}`;
          planFormMsg.style.color = 'var(--red)';
        } else {
          planFormMsg.textContent = '✅ Plan added!';
          planFormMsg.style.color = 'var(--green)';
          addPlanForm.reset();
          loadPlans();
          setTimeout(() => { planFormMsg.textContent = ''; }, 3000);
        }
      } catch (err) {
        planFormMsg.textContent = `⚠ Network error: ${err.message}`;
        planFormMsg.style.color = 'var(--red)';
      }
    });
  }

  if (refreshPlans) refreshPlans.addEventListener('click', loadPlans);

  // ── Multi-WAN Status ───────────────────────────────────────────────────────
  async function loadWanStatus() {
    if (refreshWan) refreshWan.disabled = true;
    wanList.innerHTML = '<p class="ts-line">Loading…</p>';
    try {
      const res  = await fetch('/api/wan/status', { headers: getAuthHeaders() });
      if (res.status === 401) { promptToken(); return; }
      const ifaces = await res.json();

      if (!Array.isArray(ifaces) || ifaces.length === 0) {
        wanList.innerHTML = '<p class="ts-line">No WAN interfaces configured.</p>';
        return;
      }

      wanList.innerHTML = '';
      ifaces.forEach(iface => {
        const statusColor = iface.running === null ? 'var(--muted)'
          : iface.running ? 'var(--green)' : 'var(--red)';
        const statusText  = iface.running === null ? '— UNKNOWN'
          : iface.running ? '● ONLINE' : '○ OFFLINE';

        const item = document.createElement('div');
        item.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.82rem;';
        item.innerHTML =
          `<span style="color:var(--text);">` +
            `<span style="color:var(--cyan);">${escHtml(iface.name)}</span> ` +
            `<span style="color:var(--muted);font-size:0.72rem;">(${escHtml(iface.interface)})</span>` +
          `</span>` +
          `<span style="color:${statusColor};font-size:0.78rem;letter-spacing:1px;">${statusText}</span>`;
        wanList.appendChild(item);

        if (iface.running) {
          const stats = document.createElement('div');
          stats.style.cssText = 'display:flex;gap:16px;padding:2px 0 6px 0;font-size:0.72rem;color:var(--muted);';
          stats.innerHTML =
            `<span>↓ ${fmtBytes(iface.rxBytes)}</span>` +
            `<span>↑ ${fmtBytes(iface.txBytes)}</span>` +
            `<span style="color:var(--muted);">${escHtml(iface.provider || '')}</span>`;
          wanList.appendChild(stats);
        }
      });
    } catch (err) {
      wanList.innerHTML = `<p class="ts-line" style="color:var(--red);">Error: ${err.message}</p>`;
    } finally {
      if (refreshWan) refreshWan.disabled = false;
    }
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;');
  }

  if (refreshWan) refreshWan.addEventListener('click', loadWanStatus);
  // Auto-refresh WAN every 60 s
  setInterval(loadWanStatus, 60000);

  // ── Init ───────────────────────────────────────────────────────────────────
  function promptToken() {
    const tok = window.prompt('Enter OPERATOR_API_TOKEN to access dashboard:');
    if (tok) {
      OPERATOR_TOKEN = tok.trim();
      sessionStorage.setItem('OPERATOR_TOKEN', OPERATOR_TOKEN);
      // Re-connect the WebSocket with the updated token in the URL.
      if (ws) ws.close();
    }
  }

  connect();

  fetch('/api/stats', { headers: getAuthHeaders() })
    .then(r => {
      if (r.status === 401) { promptToken(); return null; }
      return r.json();
    })
    .then(d => { if (d) renderStats(d); })
    .catch(() => {});

  // Initial loads
  refreshHotspotUsers();
  refreshPendingSessions();
  loadPlans();
  loadWanStatus();
})();
