/**
 * apply-shim.js — postinstall script
 *
 * Replaces better-sqlite3's native entry point with the sql.js shim so the
 * CAP backend runs without native compilation on any platform.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const shimSrc = path.join(__dirname, '..', 'patches', 'better-sqlite3-sqljs-shim.js');
const target  = path.join(__dirname, '..', 'node_modules', 'better-sqlite3', 'lib', 'index.js');

if (!fs.existsSync(shimSrc)) {
  console.warn('[apply-shim] Shim source not found:', shimSrc);
  process.exit(0);
}

if (!fs.existsSync(path.dirname(target))) {
  console.warn('[apply-shim] better-sqlite3 not installed yet, skipping');
  process.exit(0);
}

try {
  fs.copyFileSync(shimSrc, target);
  console.log('[apply-shim] ✅ better-sqlite3 → sql.js shim applied');
} catch (err) {
  console.error('[apply-shim] Failed to apply shim:', err.message);
  process.exit(1);
}
