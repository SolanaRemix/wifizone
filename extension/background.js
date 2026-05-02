'use strict';

// WIFIZONE Manager — background service worker
// Periodically checks the server for pending sessions and updates the
// extension badge so operators see a yellow badge when customers are waiting.

const DEFAULT_URL   = 'http://localhost:3000';
const POLL_INTERVAL = 60; // seconds between polls (Chrome alarm minimum is 1 min)

// ── Helper: get saved settings ────────────────────────────────────────────────
async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['serverUrl', 'operatorToken'], result => {
      resolve({
        serverUrl:     result.serverUrl     || DEFAULT_URL,
        operatorToken: result.operatorToken || '',
      });
    });
  });
}

// ── Poll pending sessions and update badge ────────────────────────────────────
async function checkPending() {
  try {
    const { serverUrl: base, operatorToken: token } = await getSettings();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    const res = await fetch(`${base}/api/sessions/pending`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }
    const pending = await res.json();
    const count   = Array.isArray(pending) ? pending.length : 0;

    if (count > 0) {
      chrome.action.setBadgeBackgroundColor({ color: '#ffe600' });
      chrome.action.setBadgeText({ text: String(count) });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (_) {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ── Set up alarm on install / startup ────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('pollPending', { periodInMinutes: POLL_INTERVAL / 60 });
  checkPending();
});

chrome.runtime.onStartup.addListener(() => {
  checkPending();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'pollPending') checkPending();
});
