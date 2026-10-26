/**
 * MAE CAP Server — Custom express setup
 * Mounts REST API alongside CAP OData services
 */

'use strict';

const cds           = require('@sap/cds');
const restApi       = require('./srv/rest-api');
const promptApi     = require('./srv/prompt-api');
const path          = require('path');
const fs            = require('fs');

cds.on('bootstrap', (app) => {
  app.use('/api', restApi);
  app.use('/api/prompts', promptApi);
  app.get('/health', (req, res) => res.json({ status: 'UP', service: 'mae-cap-backend' }));
});

// Auto-deploy schema to SQLite file DB on first boot (creates tables if not exist)
cds.on('served', async () => {
  try {
    const dbUrl = cds.env.requires?.db?.credentials?.url;
    if (dbUrl && dbUrl !== ':memory:') {
      // Ensure the directory exists (CF provides /home/vcap/data with write access)
      const dir = path.dirname(dbUrl);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
    // Deploy schema (no-op if tables already exist)
    const db = await cds.connect.to('db');
    await cds.deploy(cds.model).to(db);
    cds.log('server').info('Schema deployed to SQLite');

    // Auto-seed demo data if DB is empty (first boot detection)
    try {
      const existing = await db.run(SELECT.from('mae.db.Customers').limit(1)).catch(() => []);
      if (!existing || existing.length === 0) {
        cds.log('server').info('Empty database detected — seeding demo data...');
        await _seedDemoData(db);
        cds.log('server').info('Demo data seeded successfully');
      }
    } catch (seedErr) {
      cds.log('server').warn('Demo seed skipped:', seedErr.message);
    }

    // Seed prompt library — uses per-title idempotency so new categories are inserted
    try {
      const seedPrompts = require('./scripts/seed-prompts');
      await seedPrompts(db);
    } catch (promptSeedErr) {
      cds.log('server').warn('Prompt seed skipped:', promptSeedErr.message);
    }

  } catch (err) {
    // Non-fatal — tables may already exist
    cds.log('server').warn('Schema deploy skipped:', err.message);
  }
});

// ── Demo Data Seed ────────────────────────────────────────────────────────────

async function _seedDemoData(db) {
  const { v4: uuidv4 } = require('uuid');
  const now = new Date().toISOString();

  const streets = [
    '123 Hamilton St', '456 Linden St', '789 Turner St', '321 Allen St',
    '654 Gordon St', '987 Chew St', '147 Walnut St', '258 Cedar St',
    '369 Maple Ave', '741 Oak St', '852 Pine St', '963 Elm St',
    '159 Union St', '357 Liberty St', '468 Court St', '579 Penn St',
    '246 High St', '135 Church St', '864 Railroad St', '753 Market St'
  ];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Jones', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor',
                     'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin', 'Garcia', 'Thompson', 'Martinez', 'Robinson'];
  const firstNames = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Barbara',
                      'David', 'Susan', 'Richard', 'Jessica', 'Joseph', 'Sarah', 'Thomas', 'Karen', 'Charles', 'Lisa'];
  const zips = ['18101', '18102', '18103', '18104', '18105'];
  const segments = ['RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL'];

  const customers = [];
  const contractAccounts = [];
  const addressHistory = [];
  const preferences = [];

  for (let i = 0; i < 50; i++) {
    const customerId = `CUST${String(i + 1).padStart(6, '0')}`;
    const firstName  = firstNames[i % firstNames.length];
    const lastName   = lastNames[i % lastNames.length];
    const zip        = zips[i % zips.length];

    customers.push({
      CUSTOMER_ID:      customerId,
      BUSINESS_PARTNER: `BP${String(i + 1).padStart(8, '0')}`,
      FIRST_NAME:       firstName,
      LAST_NAME:        lastName,
      FULL_NAME:        `${firstName} ${lastName}`,
      EMAIL:            `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
      PHONE:            `610-555-${String(1000 + i).padStart(4, '0')}`,
      CUSTOMER_SEGMENT: segments[i % segments.length],
      STATUS:           'ACTIVE',
      CITY:             'Allentown',
      STATE_CODE:       'PA',
      ZIP_CODE:         zip,
      REGION:           'Northeast',
      CREATED_ON:       now,
      LAST_UPDATED:     now,
      NOTIFICATION_OPT_IN: true
    });

    // 1-2 contract accounts per customer
    const caCount = (i % 3 === 0) ? 2 : 1;
    for (let j = 0; j < caCount; j++) {
      const caNum = `CA${String(100000 + i * 2 + j).padStart(7, '0')}`;
      const streetNum = 100 + (i * 3 + j);
      const street    = streets[(i + j) % streets.length];
      const fullStreet = `${streetNum} ${street.replace(/^\d+\s+/, '')}`;

      contractAccounts.push({
        CONTRACT_ACCOUNT: caNum,
        CUSTOMER_ID:      customerId,
        ACCOUNT_TYPE:     j === 0 ? 'PRIMARY' : 'SECONDARY',
        STATUS:           'ACTIVE',
        PREMISE_ID:       `PREM${String(i * 2 + j).padStart(6, '0')}`,
        STREET_ADDRESS:   fullStreet,
        CITY:             'Allentown',
        STATE_CODE:       'PA',
        ZIP_CODE:         zip,
        BILLING_CLASS:    segments[i % segments.length],
        CREATED_ON:       now,
        LAST_UPDATED:     now
      });

      // Address history for first 30 customers (recent changes for demo scenario)
      if (i < 30 && j === 0) {
        const oldStreet = `${streetNum - 10} ${street.replace(/^\d+\s+/, '')}`;
        const daysAgo   = Math.floor((i / 30) * 85) + 5; // 5-90 days ago
        const changeDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
        const newStreet  = fullStreet;
        const newZip     = zips[(i + 1) % zips.length];

        addressHistory.push({
          HISTORY_ID:         uuidv4(),
          CUSTOMER_ID:        customerId,
          CONTRACT_ACCOUNT:   caNum,
          OLD_STREET_ADDRESS: oldStreet,
          OLD_CITY:           'Allentown',
          OLD_STATE_CODE:     'PA',
          OLD_ZIP_CODE:       zip,
          NEW_STREET_ADDRESS: newStreet,
          NEW_CITY:           'Allentown',
          NEW_STATE_CODE:     'PA',
          NEW_ZIP_CODE:       newZip,
          CHANGE_DATE:        changeDate,
          CHANGE_SOURCE:      'CUSTOMER_PORTAL',
          VERIFIED:           false
        });
      }
    }

    // Preferences for first 20 customers
    if (i < 20) {
      const channels = ['EMAIL', 'SMS', 'MAIL'];
      preferences.push({
        PREFERENCE_ID:      uuidv4(),
        CUSTOMER_ID:        customerId,
        CHANNEL:            channels[i % channels.length],
        PREFERENCE_TYPE:    'NOTIFICATION',
        OPTED_IN:           true,
        PREFERRED_LANGUAGE: 'EN',
        PREFERRED_TIME:     '09:00-17:00',
        LAST_UPDATED:       now,
        UPDATED_BY:         'SYSTEM'
      });
    }
  }

  // Insert in batches to avoid SQLite limits
  for (let i = 0; i < customers.length; i += 25) {
    await db.run(INSERT.into('mae.db.Customers').entries(customers.slice(i, i + 25)));
  }
  for (let i = 0; i < contractAccounts.length; i += 25) {
    await db.run(INSERT.into('mae.db.ContractAccounts').entries(contractAccounts.slice(i, i + 25)));
  }
  for (let i = 0; i < addressHistory.length; i += 25) {
    await db.run(INSERT.into('mae.db.AddressHistory').entries(addressHistory.slice(i, i + 25)));
  }
  for (let i = 0; i < preferences.length; i += 10) {
    await db.run(INSERT.into('mae.db.CustomerPreferences').entries(preferences.slice(i, i + 10)));
  }

  cds.log('server').info(`Seeded: ${customers.length} customers, ${contractAccounts.length} contract accounts, ${addressHistory.length} address history records`);
}

module.exports = cds.server;
