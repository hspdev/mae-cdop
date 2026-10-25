/**
 * deploy-db.js — Deploy CDS schema to SQLite at startup if db doesn't exist.
 * Uses @sap/cds (production dep) not @sap/cds-dk (devDependency).
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'mae-cdop.db');

if (fs.existsSync(DB_PATH)) {
  console.log('[deploy-db] Database already exists, skipping deploy');
  process.exit(0);
}

console.log('[deploy-db] Deploying CDS schema to SQLite...');

// Apply the better-sqlite3 shim first
const shimScript = path.join(__dirname, 'apply-shim.js');
if (fs.existsSync(shimScript)) {
  try { require(shimScript); } catch (e) { /* ignore */ }
}

// Use @sap/cds to deploy (available in production, unlike @sap/cds-dk)
try {
  const cds = require('@sap/cds');
  // Point cds to our project root
  const appRoot = path.join(__dirname, '..');
  cds.env.folders = cds.env.folders || {};

  // Use cds.deploy programmatic API
  cds.deploy(path.join(appRoot, 'db')).to('sqlite:' + DB_PATH)
    .catch(err => {
      console.error('[deploy-db] CDS deploy error:', err.message);
      // Non-fatal — app can still start with in-memory db
    });

  // Give deploy a moment to complete
  setTimeout(() => {
    if (fs.existsSync(DB_PATH)) {
      console.log('[deploy-db] ✅ Schema deployed to', DB_PATH);
    } else {
      console.log('[deploy-db] Using in-memory SQLite (file deploy pending)');
    }
    process.exit(0);
  }, 3000);

} catch (err) {
  console.error('[deploy-db] Error:', err.message);
  // Non-fatal — CDS will auto-deploy schema on first connect with SQLite
  process.exit(0);
}
