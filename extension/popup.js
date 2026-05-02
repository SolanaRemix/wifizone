'use strict';

// ── Default server URL ────────────────────────────────────────────────────────
const DEFAULT_URL = 'http://localhost:3000';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const statusDot      = document.getElementById('status-dot');
const revenueEl      = document.getElementById('revenue');
const totalClients   = document.getElementById('total-clients');
const liveUsers      = document.getElementById('live-users');
const pendingCount   = document.getElementById('pending-count');
const pendingBadge   = document.getElementById('pending-badge');
const serverVer      = document.getElementById('server-version');
const errorMsg       = document.getElementById('error-msg');
const serverInput    = document.getElementById('server-url');
const tokenInput     = document.getElementById('operator-token');
const saveUrlBtn     = document.getElementById('btn-save-url');
const saveTokenBtn   = document.getElementById('btn-save-token');
const dashBtn        = document.getElementById('btn-dashboard');
const portalBtn      = document.getElementById('btn-portal');
const refreshBtn     = document.getElementById('btn-refresh');

// ── Utilities ─────────────────────────────────────────────────────────────────
function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.style.display = 'block';
}

function clearError() {
  errorMsg.style.display = 'none';
}

function setStatus(state) {
  statusDot.className   = state;
  statusDot.textContent =
    state === 'online'  ? '● ONLINE'  :
    state === 'offline' ? '● OFFLINE' :
                          '● CONNECTING';
}

// ── Stored settings ───────────────────────────────────────────────────────────
function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['serverUrl', 'operatorToken'], result => {
      resolve({
        serverUrl:     result.serverUrl     || DEFAULT_URL,
        operatorToken: result.operatorToken || '',
      });
    });
  });
}

function buildAuthHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Fetch data from WIFIZONE server ──────────────────────────────────────────
async function loadData() {
  refreshBtn.disabled = true;
  clearError();

  let settings;
  try {
    settings = await getSettings();
    serverInput.value = settings.serverUrl;
    // Reflect token presence in the placeholder without exposing the value
    tokenInput.placeholder = settings.operatorToken
      ? '● ● ● ● (saved)'
      : 'Operator token (optional)';
  } catch (_) {
    settings = { serverUrl: DEFAULT_URL, operatorToken: '' };
  }

  const { serverUrl: base, operatorToken: token } = settings;
  const authHeaders = buildAuthHeaders(token);

  try {
    // Fetch stats and pending sessions in parallel
    const [statsRes, pendingRes] = await Promise.allSettled([
      fetch(`${base}/api/stats`,            { headers: authHeaders, signal: AbortSignal.timeout(5000) }),
      fetch(`${base}/api/sessions/pending`, { headers: authHeaders, signal: AbortSignal.timeout(5000) }),
    ]);

    // ── Stats ──────────────────────────────────────────────────────────────
    if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
      const stats = await statsRes.value.json();
      revenueEl.textContent    = `₱${parseFloat(stats.total_revenue || 0).toFixed(2)}`;
      totalClients.textContent = stats.total_clients ?? '0';
      setStatus('online');
      serverVer.textContent = '● RUNNING';
      serverVer.className   = 'value green';
    } else {
      const statusCode = statsRes.status === 'fulfilled' ? statsRes.value.status : null;
      setStatus('offline');
      serverVer.textContent = '● OFFLINE';
      serverVer.className   = 'value red';
      if (statusCode === 401) {
        showError('Auth required. Enter your Operator Token below and save.');
      } else {
        showError('Cannot reach WIFIZONE server. Is it running?');
      }
    }

    // ── Pending sessions ───────────────────────────────────────────────────
    if (pendingRes.status === 'fulfilled' && pendingRes.value.ok) {
      const pending = await pendingRes.value.json();
      const count   = Array.isArray(pending) ? pending.length : 0;
      pendingCount.textContent = count;
      if (count > 0) {
        pendingBadge.style.display = 'inline-block';
        pendingBadge.textContent   = count;
        pendingCount.className     = 'value yellow';
      } else {
        pendingBadge.style.display = 'none';
        pendingCount.className     = 'value';
      }
    } else {
      pendingCount.textContent = '—';
    }

    // ── Live hotspot users ─────────────────────────────────────────────────
    try {
      const usersRes = await fetch(`${base}/api/hotspot/users`,
        { headers: authHeaders, signal: AbortSignal.timeout(5000) });
      if (usersRes.ok) {
        const users = await usersRes.json();
        liveUsers.textContent = Array.isArray(users) ? users.length : '—';
        liveUsers.className   = 'value green';
      }
    } catch (_) {
      liveUsers.textContent = '—';
    }

  } catch (err) {
    setStatus('offline');
    serverVer.textContent = '● OFFLINE';
    serverVer.className   = 'value red';
    showError(`Cannot reach server: ${err.message}`);
  } finally {
    refreshBtn.disabled = false;
  }
}

// ── Button handlers ───────────────────────────────────────────────────────────
dashBtn.addEventListener('click', async () => {
  const { serverUrl } = await getSettings();
  chrome.tabs.create({ url: `${serverUrl}/dashboard.html` });
  window.close();
});

portalBtn.addEventListener('click', async () => {
  const { serverUrl } = await getSettings();
  chrome.tabs.create({ url: `${serverUrl}/portal/` });
  window.close();
});

refreshBtn.addEventListener('click', loadData);

saveUrlBtn.addEventListener('click', async () => {
  const url = serverInput.value.trim().replace(/\/$/, '');
  if (!url.startsWith('http')) {
    showError('URL must start with http:// or https://');
    return;
  }
  await new Promise(resolve => chrome.storage.local.set({ serverUrl: url }, resolve));
  loadData();
});

saveTokenBtn.addEventListener('click', async () => {
  const tok = tokenInput.value.trim();
  await new Promise(resolve => chrome.storage.local.set({ operatorToken: tok }, resolve));
  tokenInput.value = '';
  tokenInput.placeholder = tok ? '● ● ● ● (saved)' : 'Operator token (optional)';
  loadData();
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadData();
