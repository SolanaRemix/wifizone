'use strict';

/**
 * WIFIZONE ELITE — config-loader.js
 *
 * Loads a JSON config from config/<name>.json and deep-merges any
 * config/<name>.local.json on top of it so operators can keep real
 * credentials out of source control.
 *
 * Resolution order (later values win):
 *   1. config/<name>.json        — committed template / defaults
 *   2. config/<name>.local.json  — local override (gitignored)
 */

const fs   = require('fs');
const path = require('path');

/**
 * Load and merge a named config file pair.
 *
 * @param {string} name  Base name without extension (e.g. 'router', 'payment')
 * @returns {object}
 */
function loadConfig(name) {
  const cfgDir   = path.resolve(__dirname, '..', 'config');
  const basePath  = path.join(cfgDir, `${name}.json`);
  const localPath = path.join(cfgDir, `${name}.local.json`);

  let base  = {};
  let local = {};

  if (fs.existsSync(basePath)) {
    base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  }

  if (fs.existsSync(localPath)) {
    local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    console.log(`[Config] Loaded ${name}.local.json overrides`);
  }

  // Shallow-merge: local overrides base at every top-level key.
  // For nested objects (e.g. cfg.stripe), both objects are merged one level deep.
  const merged = { ...base };
  for (const [key, val] of Object.entries(local)) {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)
        && typeof base[key] === 'object' && base[key] !== null) {
      merged[key] = { ...base[key], ...val };
    } else {
      merged[key] = val;
    }
  }

  return merged;
}

module.exports = { loadConfig };
