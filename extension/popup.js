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
      if (statusCode === 401) {
        // Server is reachable but credentials are missing/wrong — show as online but unauthorized
        setStatus('online');
        serverVer.textContent = '● UNAUTHORIZED';
        serverVer.className   = 'value yellow';
        showError('Auth required. Enter your Operator Token below and save.');
      } else {
        setStatus('offline');
        serverVer.textContent = '● OFFLINE';
        serverVer.className   = 'value red';
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
  const raw = serverInput.value.trim().replace(/\/$/, '');
  let parsedUrl;
  try {
    parsedUrl = new URL(raw);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('wrong protocol');
    }
  } catch (_) {
    showError('URL must start with http:// or https:// and be a valid address');
    return;
  }
  // Store only the origin (protocol + host + port) so that appending /api/... paths works correctly.
  // Reject URLs with extra paths — the server URL should be the root of the WIFIZONE server.
  if (parsedUrl.pathname && parsedUrl.pathname !== '/') {
    showError('Enter only the server root URL (e.g. http://192.168.88.1:3000), without a path');
    return;
  }
  const url    = parsedUrl.origin;
  const origin = parsedUrl.origin + '/*';
  chrome.permissions.request({ origins: [origin] }, () => {
    // Proceed regardless — operator may decline and still want to save the URL
    chrome.storage.local.set({ serverUrl: url }, loadData);
  });
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
