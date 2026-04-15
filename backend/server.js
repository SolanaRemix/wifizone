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

const routerControl = require('./router-control');
const starlinkMod   = require('./starlink');
const autopilot     = require('./autopilot');

// ── Config ────────────────────────────────────────────────────────────────────
const paymentCfg = require('../config/payment.json');
const PORT       = process.env.PORT || 3000;

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

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '..', 'admin-panel')));

// ── WebSocket ─────────────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server });

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
app.get('/api/plans', async (_req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM plans ORDER BY duration_minutes');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── REST: Start Session ───────────────────────────────────────────────────────
app.post('/api/session/start', async (req, res) => {
  const { mac_address, device_name, plan_id } = req.body;
  if (!mac_address || !plan_id) {
    return res.status(400).json({ error: 'mac_address and plan_id required' });
  }

  try {
    // Upsert user
    await db.query(
      'INSERT INTO users (mac_address, device_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE device_name = VALUES(device_name)',
      [mac_address, device_name || null]
    );
    const [[user]] = await db.query('SELECT id FROM users WHERE mac_address = ?', [mac_address]);

    // Check for existing active session for this MAC
    const [[existingSession]] = await db.query(
      "SELECT id FROM sessions WHERE user_id = ? AND status = 'active'",
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

    // Auto-expire unpaid session after configured timeout
    setTimeout(async () => {
      await db.query(
        "UPDATE sessions SET status = 'expired' WHERE id = ? AND status = 'unpaid'",
        [sessionId]
      );
    }, paymentCfg.unpaidSessionExpiryMs);

    res.json({ session_id: sessionId, user_id: user.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helper: Confirm Payment ───────────────────────────────────────────────────
async function confirmPayment(sessionId, txnId, amount, method) {
  // Reject duplicate transaction IDs
  const [[existing]] = await db.query('SELECT id FROM payments WHERE txn_id = ?', [txnId]);
  if (existing) throw new Error('Duplicate transaction ID');

  const [[session]] = await db.query('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  if (!session) throw new Error('Session not found');
  if (session.status !== 'unpaid') throw new Error('Session already processed');

  const [[plan]] = await db.query('SELECT * FROM plans WHERE id = ?', [session.plan_id]);

  // Calculate session end time
  const endTime = new Date(Date.now() + plan.duration_minutes * 60 * 1000);

  await db.query(
    "UPDATE sessions SET status = 'paid', start_time = NOW(), end_time = ? WHERE id = ?",
    [endTime, sessionId]
  );

  await db.query(
    "INSERT INTO payments (session_id, txn_id, amount, method, status, paid_at) VALUES (?, ?, ?, ?, 'success', NOW())",
    [sessionId, txnId, amount, method]
  );

  // Unlock hotspot user on router
  const [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [session.user_id]);
  await routerControl.unlockUser(user.mac_address, plan.duration_minutes);

  // Update operator stats
  await db.query(
    'UPDATE operator_stats SET total_clients = total_clients + 1, total_revenue = total_revenue + ? WHERE id = 1',
    [amount]
  );

  // Upsert quota row
  await db.query(
    'INSERT INTO quotas (user_id) VALUES (?) ON DUPLICATE KEY UPDATE used_mb = 0, reset_at = NOW()',
    [session.user_id]
  );

  // Broadcast unlock event
  broadcast({ type: 'SESSION_UNLOCK', session: { id: sessionId, mac: user.mac_address, plan: plan.name } });

  // Broadcast updated stats
  const [[stats]] = await db.query('SELECT * FROM operator_stats WHERE id = 1');
  broadcast({ type: 'STATS', stats });

  return { session_id: sessionId, status: 'active', end_time: endTime };
}

// ── REST: GCash Callback ──────────────────────────────────────────────────────
app.post('/api/payment/gcash/callback', async (req, res) => {
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
app.post('/api/payment/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe    = require('stripe')(paymentCfg.stripe.secretKey);
  const sig       = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, paymentCfg.stripe.webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi         = event.data.object;
    const sessionId  = parseInt(pi.metadata.session_id, 10);
    const txnId      = pi.id;
    const amount     = pi.amount_received / 100; // paise → PHP
    try {
      await confirmPayment(sessionId, txnId, amount, 'stripe');
    } catch (err) {
      console.error('[Stripe]', err.message);
    }
  }

  res.json({ received: true });
});

// ── REST: Telemetry ───────────────────────────────────────────────────────────
app.get('/api/telemetry', (_req, res) => {
  res.json(starlinkMod.getSnapshot() || {});
});

// ── REST: Stats ───────────────────────────────────────────────────────────────
app.get('/api/stats', async (_req, res) => {
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
