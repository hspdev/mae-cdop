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

  // Admin: trigger prompt seed on demand — returns result or error detail
  app.get('/api/admin/seed-prompts', async (req, res) => {
    try {
      const db = await cds.connect.to('db');
      const inserted = await _seedPromptLibrary(db);
      res.json({ ok: true, inserted });
    } catch (err) {
      console.error('[admin/seed-prompts] error:', err.message, err.stack);
      res.status(500).json({ ok: false, error: err.message, stack: err.stack });
    }
  });
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

    // Seed prompt library — per-title idempotency, inserts only missing prompts
    try {
      const n = await _seedPromptLibrary(db);
      console.log(`[prompts-seed] startup seed completed: inserted ${n}`);
    } catch (promptSeedErr) {
      console.error('[prompts-seed] startup seed threw:', promptSeedErr.message, promptSeedErr.stack);
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

  // ── Reference data ─────────────────────────────────────────────────────────
  const firstNames = [
    'James','Mary','John','Patricia','Robert','Jennifer','Michael','Linda','William','Barbara',
    'David','Susan','Richard','Jessica','Joseph','Sarah','Thomas','Karen','Charles','Lisa',
    'Daniel','Nancy','Matthew','Betty','Anthony','Dorothy','Mark','Sandra','Donald','Ashley',
    'Steven','Kimberly','Paul','Donna','Andrew','Emily','Joshua','Carol','Kenneth','Michelle',
    'Kevin','Amanda','Brian','Melissa','George','Deborah','Timothy','Stephanie','Ronald','Rebecca'
  ];
  const lastNames = [
    'Smith','Johnson','Williams','Jones','Brown','Davis','Miller','Wilson','Moore','Taylor',
    'Anderson','Thomas','Jackson','White','Harris','Martin','Garcia','Thompson','Martinez','Robinson',
    'Clark','Rodriguez','Lewis','Lee','Walker','Hall','Allen','Young','Hernandez','King',
    'Wright','Lopez','Hill','Scott','Green','Adams','Baker','Gonzalez','Nelson','Carter',
    'Mitchell','Perez','Roberts','Turner','Phillips','Campbell','Parker','Evans','Edwards','Collins'
  ];
  const streets = [
    'Main St','Oak Ave','Maple Dr','Cedar Ln','Pine Rd','Elm St','Washington Blvd','Park Ave',
    'Lake Dr','River Rd','Hill St','Valley Rd','Forest Ave','Sunset Blvd','Spring St',
    'Market St','Church St','High St','Union St','Liberty Ave','Commerce Dr','Industrial Pkwy',
    'Business Center Dr','Corporate Blvd','Harbor View Rd','Mountain View Dr','Meadow Ln',
    'Orchard St','Willow Way','Birch Ct','Hickory Ln','Walnut Ave','Chestnut St','Poplar Rd'
  ];
  const domains = ['gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','aol.com','comcast.net','verizon.net','att.net','example.com'];
  const channels = ['EMAIL','SMS','MAIL'];
  const prefTypes = ['NOTIFICATION','MARKETING','BILLING'];
  const changeSources = ['CUSTOMER_PORTAL','NCOA','MANUAL','BULK_UPDATE'];
  const segments = ['RESIDENTIAL','COMMERCIAL','INDUSTRIAL'];
  const billingClasses = ['STANDARD','PREMIUM','BASIC'];
  const accountTypes = ['RESIDENTIAL','COMMERCIAL','INDUSTRIAL'];
  const prefLangs = ['English','Spanish'];
  const prefTimes = ['MORNING','AFTERNOON','EVENING'];

  // 50 states mapped to 5 regions
  const statesByRegion = {
    Northeast: [
      {code:'CT',city:'Hartford',zip:'06101'},{code:'ME',city:'Portland',zip:'04101'},
      {code:'MA',city:'Boston',zip:'02101'},{code:'NH',city:'Manchester',zip:'03101'},
      {code:'NJ',city:'Newark',zip:'07101'},{code:'NY',city:'New York',zip:'10001'},
      {code:'PA',city:'Philadelphia',zip:'19101'},{code:'RI',city:'Providence',zip:'02901'},
      {code:'VT',city:'Burlington',zip:'05401'},{code:'DE',city:'Wilmington',zip:'19801'},
      {code:'MD',city:'Baltimore',zip:'21201'}
    ],
    Southeast: [
      {code:'AL',city:'Birmingham',zip:'35201'},{code:'AR',city:'Little Rock',zip:'72201'},
      {code:'FL',city:'Miami',zip:'33101'},{code:'GA',city:'Atlanta',zip:'30301'},
      {code:'KY',city:'Louisville',zip:'40201'},{code:'LA',city:'New Orleans',zip:'70112'},
      {code:'MS',city:'Jackson',zip:'39201'},{code:'NC',city:'Charlotte',zip:'28201'},
      {code:'SC',city:'Columbia',zip:'29201'},{code:'TN',city:'Nashville',zip:'37201'},
      {code:'VA',city:'Richmond',zip:'23218'},{code:'WV',city:'Charleston',zip:'25301'}
    ],
    Midwest: [
      {code:'IL',city:'Chicago',zip:'60601'},{code:'IN',city:'Indianapolis',zip:'46201'},
      {code:'IA',city:'Des Moines',zip:'50301'},{code:'KS',city:'Wichita',zip:'67201'},
      {code:'MI',city:'Detroit',zip:'48201'},{code:'MN',city:'Minneapolis',zip:'55401'},
      {code:'MO',city:'St. Louis',zip:'63101'},{code:'NE',city:'Omaha',zip:'68101'},
      {code:'ND',city:'Fargo',zip:'58102'},{code:'OH',city:'Columbus',zip:'43201'},
      {code:'SD',city:'Sioux Falls',zip:'57101'},{code:'WI',city:'Milwaukee',zip:'53201'}
    ],
    Southwest: [
      {code:'AZ',city:'Phoenix',zip:'85001'},{code:'NM',city:'Albuquerque',zip:'87101'},
      {code:'OK',city:'Oklahoma City',zip:'73101'},{code:'TX',city:'Houston',zip:'77001'},
      {code:'CO',city:'Denver',zip:'80201'},{code:'UT',city:'Salt Lake City',zip:'84101'},
      {code:'NV',city:'Las Vegas',zip:'89101'}
    ],
    West: [
      {code:'AK',city:'Anchorage',zip:'99501'},{code:'CA',city:'Los Angeles',zip:'90001'},
      {code:'HI',city:'Honolulu',zip:'96801'},{code:'ID',city:'Boise',zip:'83701'},
      {code:'MT',city:'Billings',zip:'59101'},{code:'OR',city:'Portland',zip:'97201'},
      {code:'WA',city:'Seattle',zip:'98101'},{code:'WY',city:'Cheyenne',zip:'82001'}
    ]
  };
  const regionNames = Object.keys(statesByRegion);
  const allStates = regionNames.flatMap(r => statesByRegion[r].map(s => ({ ...s, region: r })));

  const TOTAL_CUSTOMERS = 10000;
  const customers      = [];
  const contractAccounts = [];
  const addressHistory = [];
  const preferences    = [];

  for (let i = 0; i < TOTAL_CUSTOMERS; i++) {
    const customerId  = `CUST${String(i + 1).padStart(6, '0')}`;
    const firstName   = firstNames[i % firstNames.length];
    const lastName    = lastNames[i % lastNames.length];
    // Vary email to avoid duplicates
    const emailLocal  = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i > 99 ? i : ''}`;
    const emailDomain = domains[i % domains.length];
    const stateInfo   = allStates[i % allStates.length];
    const segment     = segments[i % segments.length];
    const isActive    = (i % 10) !== 9; // 90% active
    const optIn       = (i % 7) !== 0;  // ~85% opt-in
    const streetNum   = 100 + (i % 9900);
    const street      = streets[i % streets.length];
    const areaCode    = 200 + (i % 800);
    const phone       = `${areaCode}-555-${String(1000 + (i % 9000)).padStart(4,'0')}`;

    customers.push({
      CUSTOMER_ID:         customerId,
      BUSINESS_PARTNER:    `BP${String(i + 1).padStart(8, '0')}`,
      FIRST_NAME:          firstName,
      LAST_NAME:           lastName,
      FULL_NAME:           `${firstName} ${lastName}`,
      EMAIL:               `${emailLocal}@${emailDomain}`,
      PHONE:               phone,
      CUSTOMER_SEGMENT:    segment,
      STATUS:              isActive ? 'ACTIVE' : 'INACTIVE',
      CITY:                stateInfo.city,
      STATE_CODE:          stateInfo.code,
      ZIP_CODE:            stateInfo.zip,
      REGION:              stateInfo.region,
      CREATED_ON:          now,
      LAST_UPDATED:        now,
      NOTIFICATION_OPT_IN: optIn
    });

    // 1-2 contract accounts per customer
    const caCount = (i % 3 === 0) ? 2 : 1;
    for (let j = 0; j < caCount; j++) {
      const caNum      = `CA${String(1000000 + i * 2 + j).padStart(8, '0')}`;
      const fullStreet = `${streetNum + j} ${street}`;
      const caActive   = isActive && (j === 0 || (i % 5) !== 0);
      const moveInDays = 365 + (i % 1825); // 1-5 years ago
      const moveIn     = new Date(Date.now() - moveInDays * 86400000).toISOString().substring(0, 10);

      contractAccounts.push({
        CONTRACT_ACCOUNT: caNum,
        CUSTOMER_ID:      customerId,
        ACCOUNT_TYPE:     accountTypes[i % accountTypes.length],
        BILLING_CLASS:    billingClasses[j % billingClasses.length],
        STATUS:           caActive ? 'ACTIVE' : 'INACTIVE',
        PREMISE_ID:       `PREM${String(i * 2 + j).padStart(7, '0')}`,
        STREET_ADDRESS:   fullStreet,
        CITY:             stateInfo.city,
        STATE_CODE:       stateInfo.code,
        ZIP_CODE:         stateInfo.zip,
        MOVE_IN_DATE:     moveIn,
        MOVE_OUT_DATE:    caActive ? null : new Date(Date.now() - 30 * 86400000).toISOString().substring(0, 10),
        CREATED_ON:       now,
        LAST_UPDATED:     now
      });

      // Address history — ~80% of accounts have a recent change
      if ((i + j) % 5 !== 0) {
        const daysAgo    = 1 + (i % 89);
        const changeDate = new Date(Date.now() - daysAgo * 86400000).toISOString();
        const oldNum     = streetNum + j + 10;
        const oldStreet  = `${oldNum} ${streets[(i + 3) % streets.length]}`;
        const oldState   = allStates[(i + 5) % allStates.length];

        addressHistory.push({
          HISTORY_ID:         uuidv4(),
          CUSTOMER_ID:        customerId,
          CONTRACT_ACCOUNT:   caNum,
          OLD_STREET_ADDRESS: oldStreet,
          OLD_CITY:           oldState.city,
          OLD_STATE_CODE:     oldState.code,
          OLD_ZIP_CODE:       oldState.zip,
          NEW_STREET_ADDRESS: fullStreet,
          NEW_CITY:           stateInfo.city,
          NEW_STATE_CODE:     stateInfo.code,
          NEW_ZIP_CODE:       stateInfo.zip,
          CHANGE_DATE:        changeDate,
          CHANGE_SOURCE:      changeSources[i % changeSources.length],
          VERIFIED:           (i % 3) !== 0
        });
      }
    }

    // 3 preference records per customer (one per channel)
    for (let c = 0; c < 3; c++) {
      preferences.push({
        PREFERENCE_ID:      uuidv4(),
        CUSTOMER_ID:        customerId,
        CHANNEL:            channels[c],
        PREFERENCE_TYPE:    prefTypes[c % prefTypes.length],
        OPTED_IN:           optIn && (c === 0 || (i % 4) !== 0),
        PREFERRED_LANGUAGE: prefLangs[i % prefLangs.length],
        PREFERRED_TIME:     prefTimes[(i + c) % prefTimes.length],
        LAST_UPDATED:       now,
        UPDATED_BY:         'SYSTEM'
      });
    }
  }

  // Bulk INSERT in batches of 500
  const BATCH = 500;
  for (let i = 0; i < customers.length; i += BATCH) {
    await db.run(INSERT.into('mae.db.Customers').entries(customers.slice(i, i + BATCH)));
  }
  for (let i = 0; i < contractAccounts.length; i += BATCH) {
    await db.run(INSERT.into('mae.db.ContractAccounts').entries(contractAccounts.slice(i, i + BATCH)));
  }
  for (let i = 0; i < addressHistory.length; i += BATCH) {
    await db.run(INSERT.into('mae.db.AddressHistory').entries(addressHistory.slice(i, i + BATCH)));
  }
  for (let i = 0; i < preferences.length; i += BATCH) {
    await db.run(INSERT.into('mae.db.CustomerPreferences').entries(preferences.slice(i, i + BATCH)));
  }

  cds.log('server').info(`Seeded: ${customers.length} customers, ${contractAccounts.length} contract accounts, ${addressHistory.length} address history, ${preferences.length} preferences`);
}

// ── Prompt Library Seed ───────────────────────────────────────────────────────

async function _seedPromptLibrary(db) {
  const { v4: uuidv4 } = require('uuid');
  const now = new Date().toISOString();
  console.log('[prompts-seed] starting...');

  // Load existing prompt titles to support per-title idempotency
  let existingTitles = new Set();
  try {
    const rows = await db.run(SELECT.from('mae.db.PromptLibrary').columns('TITLE'));
    existingTitles = new Set((rows || []).map(r => r.TITLE));
    console.log(`[prompts-seed] existing titles in DB: ${existingTitles.size}`);
  } catch (selErr) {
    console.error('[prompts-seed] SELECT existing titles failed:', selErr.message);
  }

  const SYSTEM_CTX = 'You are an AI assistant for DUCI utility company operations platform. Provide specific, actionable responses based on actual system data. Always cite data sources and recommend concrete next steps.';

  const PROMPTS = require('./scripts/seed-prompts-data');
  console.log(`[prompts-seed] loaded ${PROMPTS.length} prompts from data file`);

  let inserted = 0;
  const entries = [];
  for (const p of PROMPTS) {
    if (existingTitles.has(p.title)) continue;
    const desc = p.text.length > 200 ? p.text.substring(0, 197) + '...' : p.text;
    entries.push({
      PROMPT_ID: uuidv4(), TITLE: p.title, DESCRIPTION: desc,
      CATEGORY: p.cat, PROMPT_TEXT: p.text, SYSTEM_CONTEXT: SYSTEM_CTX,
      TAGS: p.tags, PERSONA: p.persona, JOB_TYPE: p.jobType || null,
      VERSION: 1, STATUS: 'ACTIVE', OWNER: 'SYSTEM',
      USAGE_COUNT: 0, AVG_QUALITY_SCORE: 0, AVG_ALIGNMENT_SCORE: 0, AVG_BUSINESS_SCORE: 0,
      IS_FAVORITE: false, IS_RECOMMENDED: p.recommended ? true : false,
      CREATED_ON: now, UPDATED_ON: now
    });
  }

  if (entries.length > 0) {
    console.log(`[prompts-seed] inserting ${entries.length} new prompts in batches...`);
    // Batch insert in chunks of 50 — retry once on failure (table may not exist yet)
    const BATCH = 50;
    let failed = false;
    for (let i = 0; i < entries.length; i += BATCH) {
      try {
        await db.run(INSERT.into('mae.db.PromptLibrary').entries(entries.slice(i, i + BATCH)));
        inserted += Math.min(BATCH, entries.length - i);
        console.log(`[prompts-seed] batch at offset ${i} OK, total so far: ${inserted}`);
      } catch (batchErr) {
        console.error(`[prompts-seed] batch insert failed at offset ${i}:`, batchErr.message, batchErr.stack);
        failed = true;
        break;
      }
    }
    if (failed) {
      console.error('[prompts-seed] seed incomplete due to batch failure');
    }
  } else {
    console.log('[prompts-seed] no new entries to insert (all already exist)');
  }

  console.log(`[prompts-seed] done: inserted=${inserted}, skipped=${existingTitles.size}`);
  cds.log('server').info(`[prompts] Inserted ${inserted} new prompt(s) — ${existingTitles.size} already existed`);
  return inserted;
}

module.exports = cds.server;
