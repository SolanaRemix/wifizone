'use strict';

/**
 * WIFIZONE ELITE — server.js
 * Express REST API + WebSocket broadcast hub.
 *
 * Endpoints
 *   GET  /api/plans                   — list all plans
 *   POST /api/session/start           — create unpaid session
 *   POST /api/payment/gcash/callback  — GCash payment webhook
 *   POST /api/payment/stripe/webhook  — Stripe payment webhook
 *   GET  /api/telemetry               — latest SNMP telemetry snapshot
 *   GET  /api/stats                   — operator stats (clients + revenue)
 *   GET  /api/hotspot/users           — live active sessions from MikroTik
 *   GET  /api/session/:id/status      — current status of a session (for client polling)
 *
 * WebSocket events broadcast to admin-panel:
 *   { type: 'SESSION_UNLOCK', session }
 *   { type: 'TELEMETRY',      data    }
 *   { type: 'STATS',          stats   }
 */

const express    = require('express');
const bodyParser = require('body-parser');
const http       = require('http');
const WebSocket  = require('ws');
const mysql      = require('mysql2/promise');
const path       = require('path');
const rateLimit  = require('express-rate-limit');

const mikrotik      = require('./mikrotik');
const starlinkMod   = require('./starlink');
const autopilot     = require('./autopilot');
const { loadConfig } = require('./config-loader');

// ── Config ────────────────────────────────────────────────────────────────────
const paymentCfg = loadConfig('payment');
const PORT       = process.env.PORT || 3000;

// Resolve Stripe credentials (env vars take precedence over config file).
// On startup, warn clearly when neither source has a value.
const STRIPE_SECRET_KEY  = process.env.STRIPE_SECRET_KEY  || paymentCfg.stripe.secretKey;
const STRIPE_WEBHOOK_SEC = process.env.STRIPE_WEBHOOK_SEC || paymentCfg.stripe.webhookSecret;
if (!STRIPE_SECRET_KEY)  console.warn('[WIFIZONE] WARNING: Stripe secret key not configured (set STRIPE_SECRET_KEY env var).');
if (!STRIPE_WEBHOOK_SEC) console.warn('[WIFIZONE] WARNING: Stripe webhook secret not configured (set STRIPE_WEBHOOK_SEC env var).');

// Operator API token guards dashboard-only endpoints.
// Set OPERATOR_API_TOKEN env var in production.  Omitting it logs a startup
// warning and leaves those endpoints unprotected (dev-mode convenience only).
const OPERATOR_API_TOKEN = process.env.OPERATOR_API_TOKEN || '';
if (!OPERATOR_API_TOKEN) {
  console.warn('[WIFIZONE] WARNING: OPERATOR_API_TOKEN not set — operator endpoints are unprotected!');
}

// MAC address regex (colon or hyphen separated, case-insensitive)
const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;

// ── DB Pool ───────────────────────────────────────────────────────────────────
const db = mysql.createPool({
  host:     process.env.DB_HOST     || '127.0.0.1',
  port:     parseInt(process.env.DB_PORT || '3306', 10),
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'wifizone_elite',
  waitForConnections: true,
  connectionLimit: 10,
});

// ── Express ───────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

// Stripe webhook path constant — used by both body-parser registration
// and the route definition so they stay in sync if the path ever changes.
const STRIPE_WEBHOOK_PATH = '/api/payment/stripe/webhook';

// Stripe webhook requires raw (unparsed) bytes for signature verification.
// This path-scoped middleware must be registered BEFORE the global JSON parser.
app.use(STRIPE_WEBHOOK_PATH, bodyParser.raw({ type: 'application/json' }));

app.use(bodyParser.json({
  // Exclude the Stripe webhook path (needs raw bytes for sig verification).
  // Only parse requests that declare application/json to avoid unexpected 400s
  // on form-data or other content types.
  type: req => req.path !== STRIPE_WEBHOOK_PATH && Boolean(req.is('application/json')),
}));

// `/` → operator dashboard; client portal served under `/portal/`
app.get('/', (_req, res) => res.redirect(302, '/dashboard.html'));
app.use(express.static(path.join(__dirname, '..', 'admin-panel')));
app.use('/portal', express.static(path.join(__dirname, '..', 'frontend')));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment requests, please try again later.' },
});

// ── Auth ──────────────────────────────────────────────────────────────────────
/**
 * Middleware that gates operator-only endpoints behind a Bearer token.
 * Set OPERATOR_API_TOKEN env var to enable.  When the var is unset the
 * middleware passes through (with a startup warning already logged above).
 */
function requireOperatorAuth(req, res, next) {
  if (!OPERATOR_API_TOKEN) return next(); // dev mode — token not configured
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (authHeader.slice('Bearer '.length) !== OPERATOR_API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
// When OPERATOR_API_TOKEN is configured, gate WS upgrades by requiring
// the token as a `?token=` query parameter on the upgrade request URL.
// Clients that don't provide a valid token receive a 401 close.
const wss = new WebSocket.Server({
  server,
  verifyClient: (info, cb) => {
    if (!OPERATOR_API_TOKEN) { cb(true); return; }
    try {
      const url   = new URL(info.req.url, `http://${info.req.headers.host}`);
      const token = url.searchParams.get('token') || '';
      if (token === OPERATOR_API_TOKEN) {
        cb(true);
      } else {
        cb(false, 401, 'Unauthorized');
      }
    } catch (_) {
      cb(false, 400, 'Bad Request');
    }
  },
});

/**
 * Broadcast a JSON message to every connected WebSocket client.
 * @param {object} payload
 */
function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

wss.on('connection', ws => {
  // Send latest telemetry snapshot on connect
  const snapshot = starlinkMod.getSnapshot();
  if (snapshot) ws.send(JSON.stringify({ type: 'TELEMETRY', data: snapshot }));

  ws.on('error', err => console.error('[WS]', err.message));

  // Heartbeat pong
  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    } catch (_) { /* ignore non-JSON */ }
  });
});

// ── REST: Plans ───────────────────────────────────────────────────────────────
app.get('/api/plans', apiLimiter, async (_req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM plans ORDER BY duration_minutes');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── REST: Start Session ───────────────────────────────────────────────────────
app.post('/api/session/start', apiLimiter, async (req, res) => {
  const { mac_address, device_name, plan_id } = req.body;
  if (!mac_address || !plan_id) {
    return res.status(400).json({ error: 'mac_address and plan_id required' });
  }
  // Validate MAC format and reject placeholder fallbacks such as 'unknown'.
  if (!MAC_REGEX.test(mac_address)) {
    return res.status(400).json({ error: 'Invalid MAC address format' });
  }

  try {
    // Upsert user
    await db.query(
      'INSERT INTO users (mac_address, device_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE device_name = VALUES(device_name)',
      [mac_address, device_name || null]
    );
    const [[user]] = await db.query('SELECT id FROM users WHERE mac_address = ?', [mac_address]);

    // Check for existing active session for this MAC (not yet expired)
    const [[existingSession]] = await db.query(
      "SELECT id FROM sessions WHERE user_id = ? AND status = 'active' AND (end_time IS NULL OR end_time > NOW())",
      [user.id]
    );
    if (existingSession) {
      return res.status(409).json({ error: 'Active session already exists for this device' });
    }

    // Create unpaid session
    const [result] = await db.query(
      "INSERT INTO sessions (user_id, plan_id, status) VALUES (?, ?, 'unpaid')",
      [user.id, plan_id]
    );
    const sessionId = result.insertId;

    res.json({ session_id: sessionId, user_id: user.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Periodic job: expire unpaid sessions that exceed the configured timeout.
// This replaces per-session setTimeout timers, which are unreliable across
// process restarts and create one timer per session under load.
const UNPAID_EXPIRY_MS  = paymentCfg.unpaidSessionExpiryMs || 300000;
// Run the cleanup at most every minute; no more frequently than the expiry window.
const EXPIRY_POLL_MS    = Math.min(UNPAID_EXPIRY_MS, 60_000);

setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - UNPAID_EXPIRY_MS);
    await db.query(
      "UPDATE sessions SET status = 'expired' WHERE status = 'unpaid' AND start_time < ?",
      [cutoff]
    );
  } catch (err) {
    console.error('[Session] Periodic unpaid-session expiry failed:', err.message);
  }
}, EXPIRY_POLL_MS);

// ── Helper: Confirm Payment ───────────────────────────────────────────────────
async function confirmPayment(sessionId, txnId, amount, method) {
  const connection = await db.getConnection();
  let plan, user;

  try {
    await connection.beginTransaction();

    // Reject duplicate transaction IDs
    const [[existing]] = await connection.query('SELECT id FROM payments WHERE txn_id = ?', [txnId]);
    if (existing) throw new Error('Duplicate transaction ID');

    const [[session]] = await connection.query('SELECT * FROM sessions WHERE id = ?', [sessionId]);
    if (!session) throw new Error('Session not found');
    if (session.status !== 'unpaid') throw new Error('Session already processed');

    [[plan]] = await connection.query('SELECT * FROM plans WHERE id = ?', [session.plan_id]);
    if (!plan) throw new Error('Plan not found for session');

    [[user]] = await connection.query('SELECT * FROM users WHERE id = ?', [session.user_id]);
    if (!user) throw new Error('User not found for session');

    // Calculate session end time
    const endTime = new Date(Date.now() + plan.duration_minutes * 60 * 1000);

    await connection.query(
      "UPDATE sessions SET status = 'active', start_time = NOW(), end_time = ? WHERE id = ?",
      [endTime, sessionId]
    );

    await connection.query(
      "INSERT INTO payments (session_id, txn_id, amount, method, status, paid_at) VALUES (?, ?, ?, ?, 'success', NOW())",
      [sessionId, txnId, amount, method]
    );

    // Update operator stats — row is always id=1 (seeded by schema.sql)
    await connection.query(
      'UPDATE operator_stats SET total_clients = total_clients + 1, total_revenue = total_revenue + ? WHERE id = 1',
      [amount]
    );

    // Upsert quota row
    await connection.query(
      'INSERT INTO quotas (user_id) VALUES (?) ON DUPLICATE KEY UPDATE used_mb = 0, reset_at = NOW()',
      [session.user_id]
    );

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  // ── Side effects after DB commit ──────────────────────────────────────────
  // MikroTik provisioning and broadcasts run outside the transaction.
  // Failures here do NOT roll back the payment — the session is already active.
  // Operators can re-provision manually if needed.
  try {
    const durationSeconds = plan.duration_minutes * 60;
    await mikrotik.addUser(user.mac_address, durationSeconds);

    // Broadcast unlock event
    broadcast({ type: 'SESSION_UNLOCK', session: { id: sessionId, mac: user.mac_address, plan: plan.name } });

    // Broadcast updated stats
    const [[stats]] = await db.query('SELECT * FROM operator_stats WHERE id = 1');
    broadcast({ type: 'STATS', stats });
  } catch (err) {
    console.error(
      `[confirmPayment] Post-commit side effect failed for session ${sessionId}, txn ${txnId}: ${err.message}`
    );
  }

  return { session_id: sessionId, status: 'active', end_time: new Date(Date.now() + plan.duration_minutes * 60 * 1000) };
}

// ── REST: GCash Callback ──────────────────────────────────────────────────────
app.post('/api/payment/gcash/callback', paymentLimiter, async (req, res) => {
  const { session_id, txn_id, amount } = req.body;
  if (!session_id || !txn_id || !amount) {
    return res.status(400).json({ error: 'session_id, txn_id, and amount required' });
  }
  try {
    const result = await confirmPayment(session_id, txn_id, parseFloat(amount), 'gcash');
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── REST: Stripe Webhook ──────────────────────────────────────────────────────
app.post(STRIPE_WEBHOOK_PATH, paymentLimiter, async (req, res) => {
  // Guard: bail early if Stripe credentials weren't configured at startup.
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SEC) {
    console.error('[Stripe] Webhook received but Stripe credentials are not configured.');
    return res.status(500).json({ error: 'Stripe not configured on this server.' });
  }

  const stripe = require('stripe')(STRIPE_SECRET_KEY);
  const sig    = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SEC);
  } catch (err) {
    const safeMsg = String(err.message).replace(/[<>&"]/g, c =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])
    );
    return res.status(400).send(`Webhook Error: ${safeMsg}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;

    // Validate metadata: session_id must be a positive integer string and
    // amount_received must be a finite number.
    const rawSessionId = pi && pi.metadata && pi.metadata.session_id;
    const normalizedId = typeof rawSessionId === 'string' || typeof rawSessionId === 'number'
      ? String(rawSessionId).trim()
      : '';
    const sessionId     = /^\d+$/.test(normalizedId) ? Number(normalizedId) : NaN;
    const amountReceived = pi && pi.amount_received;

    if (
      !Number.isSafeInteger(sessionId) ||
      sessionId <= 0 ||
      typeof amountReceived !== 'number' ||
      !Number.isFinite(amountReceived)
    ) {
      return res.status(400).json({ error: 'Malformed Stripe event payload.' });
    }

    const txnId  = pi.id;
    const amount = amountReceived / 100; // centavos → PHP
    try {
      await confirmPayment(sessionId, txnId, amount, 'stripe');
    } catch (err) {
      console.error('[Stripe]', err.message);
      // Return 500 so Stripe knows to retry this event delivery.
      return res.status(500).json({ error: 'Payment processing failed; will retry.' });
    }
  }

  res.json({ received: true });
});

// ── REST: Telemetry ───────────────────────────────────────────────────────────
app.get('/api/telemetry', requireOperatorAuth, (_req, res) => {
  res.json(starlinkMod.getSnapshot() || {});
});

// ── REST: Live hotspot users (real-time sync from MikroTik) ───────────────────
app.get('/api/hotspot/users', requireOperatorAuth, apiLimiter, async (_req, res) => {
  try {
    const users = await mikrotik.syncUsers();
    res.json(users);
  } catch (err) {
    res.status(502).json({ error: `MikroTik sync failed: ${err.message}` });
  }
});

// ── REST: Session status (client polls this to check activation) ──────────────
app.get('/api/session/:id/status', apiLimiter, async (req, res) => {
  const sessionId = parseInt(req.params.id, 10);
  if (isNaN(sessionId) || sessionId <= 0) {
    return res.status(400).json({ error: 'Invalid session ID' });
  }
  try {
    const [[row]] = await db.query(
      `SELECT s.id, s.status, s.start_time, s.end_time, p.name AS plan_name
       FROM sessions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.id = ?`,
      [sessionId]
    );
    if (!row) return res.status(404).json({ error: 'Session not found' });
    res.json({
      id:         row.id,
      status:     row.status,
      plan:       row.plan_name,
      start_time: row.start_time,
      end_time:   row.end_time,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── REST: Submit payment reference (client records ref for operator lookup) ───
app.post('/api/session/:id/reference', apiLimiter, async (req, res) => {
  const sessionId = parseInt(req.params.id, 10);
  if (isNaN(sessionId) || sessionId <= 0) {
    return res.status(400).json({ error: 'Invalid session ID' });
  }
  const { reference } = req.body;
  if (!reference || typeof reference !== 'string' || !reference.trim()) {
    return res.status(400).json({ error: 'reference is required' });
  }
  try {
    const [[session]] = await db.query('SELECT id, status FROM sessions WHERE id = ?', [sessionId]);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status === 'active') return res.json({ message: 'Session already active' });
    await db.query(
      'UPDATE sessions SET reference_txn = ? WHERE id = ?',
      [reference.trim().substring(0, 100), sessionId]
    );
    res.json({ message: 'Reference recorded. The operator will verify your payment shortly.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── REST: Stats ───────────────────────────────────────────────────────────────
app.get('/api/stats', requireOperatorAuth, apiLimiter, async (_req, res) => {
  try {
    const [[stats]] = await db.query('SELECT * FROM operator_stats WHERE id = 1');
    res.json(stats || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Telemetry events → broadcast ─────────────────────────────────────────────
starlinkMod.on('telemetry', data => broadcast({ type: 'TELEMETRY', data }));

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[WIFIZONE ELITE] Backend listening on http://0.0.0.0:${PORT}`);
  starlinkMod.startPolling();
  autopilot.start();
});

module.exports = { app, server, broadcast, db };
