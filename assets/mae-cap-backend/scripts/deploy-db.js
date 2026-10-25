/**
 * deploy-db.js — run CDS deploy to SQLite at startup if db file doesn't exist
 *
 * This ensures the schema is created before cds-serve starts.
 */

'use strict';

const { execSync } = require('child_process');
const fs           = require('fs');
const path         = require('path');

const DB_PATH = path.join(__dirname, '..', 'mae-cdop.db');

if (fs.existsSync(DB_PATH)) {
  console.log('[deploy-db] Database already exists, skipping deploy');
  process.exit(0);
}

console.log('[deploy-db] Deploying CDS schema to SQLite...');
try {
  execSync('node node_modules/@sap/cds-dk/bin/cds.js deploy --to sqlite:mae-cdop.db', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  });
  console.log('[deploy-db] ✅ Schema deployed');
} catch (err) {
  console.error('[deploy-db] Deploy failed:', err.message);
  process.exit(1);
}
