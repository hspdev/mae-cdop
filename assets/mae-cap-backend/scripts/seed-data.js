/**
 * DUCI Seed Data Generator
 *
 * Generates realistic utility company demo data:
 * - 100,000 Customers
 * - 125,000 Contract Accounts
 * - Address History (move-in events, 90-day changes)
 * - Customer Preferences
 * - Failure Scenarios
 *
 * Usage:
 *   node scripts/seed-data.js --scenario=demo
 *   node scripts/seed-data.js --scenario=performance --count=100000
 *
 * Outputs: db/data/ (CSV + JSON)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ── CLI args ───────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
);

const SCENARIO = args.scenario || 'demo';
const CUSTOMER_COUNT = parseInt(args.count || (SCENARIO === 'performance' ? 100000 : 1000));
const CONTRACT_ACCOUNT_MULTIPLIER = 1.25;
const OUTPUT_DIR = path.join(__dirname, '../db/data');

// ── DUCI Service Territory Data ────────────────────────────────────────────
const PA_CITIES = [
  { city: 'Allentown',     state: 'PA', zips: ['18101','18102','18103','18104','18105'] },
  { city: 'Bethlehem',     state: 'PA', zips: ['18015','18016','18017','18018','18020'] },
  { city: 'Easton',        state: 'PA', zips: ['18042','18043','18044','18045'] },
  { city: 'Reading',       state: 'PA', zips: ['19601','19602','19603','19604','19605'] },
  { city: 'Lancaster',     state: 'PA', zips: ['17601','17602','17603','17604'] },
  { city: 'Harrisburg',    state: 'PA', zips: ['17101','17102','17103','17104','17109'] },
  { city: 'York',          state: 'PA', zips: ['17401','17402','17403','17404'] },
  { city: 'Pottsville',    state: 'PA', zips: ['17901','17902','17903'] },
  { city: 'Scranton',      state: 'PA', zips: ['18501','18502','18503','18504','18505'] },
  { city: 'Wilkes-Barre',  state: 'PA', zips: ['18701','18702','18703','18704','18705'] }
];

const NJ_CITIES = [
  { city: 'Trenton',      state: 'NJ', zips: ['08601','08602','08603','08604','08605'] },
  { city: 'Camden',       state: 'NJ', zips: ['08101','08102','08103','08104'] },
  { city: 'Vineland',     state: 'NJ', zips: ['08360','08361','08362'] }
];

const DE_CITIES = [
  { city: 'Wilmington',   state: 'DE', zips: ['19801','19802','19803','19804','19805'] },
  { city: 'Dover',        state: 'DE', zips: ['19901','19902','19903','19904'] }
];

const ALL_CITIES = [...PA_CITIES, ...NJ_CITIES, ...DE_CITIES];

const STREET_TYPES   = ['St', 'Ave', 'Blvd', 'Dr', 'Ln', 'Rd', 'Way', 'Ct', 'Pl', 'Ter'];
const STREET_NAMES   = ['Main','Oak','Maple','Cedar','Elm','Pine','Washington','Jefferson',
                        'Lincoln','Park','Church','Market','Spring','Lake','Hill','Valley',
                        'River','Ridge','Summit','Forest','Meadow','Creek','Heritage','Liberty'];
const FIRST_NAMES    = ['James','Mary','John','Patricia','Robert','Jennifer','Michael','Linda',
                        'William','Barbara','David','Susan','Richard','Jessica','Joseph','Sarah',
                        'Thomas','Karen','Charles','Lisa','Christopher','Nancy','Daniel','Betty',
                        'Matthew','Margaret','Anthony','Sandra','Mark','Ashley','Donald','Dorothy',
                        'Steven','Kimberly','Paul','Emily','Andrew','Donna','Kenneth','Michelle',
                        'George','Carol','Joshua','Amanda','Kevin','Melissa','Brian','Deborah'];
const LAST_NAMES     = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis',
                        'Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson',
                        'Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White',
                        'Harris','Sanchez','Clark','Ramirez','Lewis','Robinson','Walker','Young',
                        'Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores','Green'];
const SEGMENTS       = ['RESIDENTIAL','RESIDENTIAL','RESIDENTIAL','COMMERCIAL','INDUSTRIAL'];
const ACCOUNT_TYPES  = ['ELECTRICITY','GAS','DUAL_FUEL','BUNDLED'];
const BILLING_CLASSES = ['STANDARD','BUDGET','COMMERCIAL','INDUSTRIAL','PREPAID'];
const ERROR_MESSAGES  = [
  'Business Partner not found in S/4HANA',
  'Address validation failed: PO Box not allowed',
  'Contract account locked for processing',
  'Duplicate address change detected within 24 hours',
  'ZIP code does not match state code',
  'Customer account suspended — update blocked',
  'API timeout: S/4HANA did not respond within 30 seconds',
  'Invalid street address format',
  'Business Partner has pending change document',
  'Concurrent modification detected — retry recommended'
];

// ── Utilities ──────────────────────────────────────────────────────────────
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randDate = (daysAgo) => {
  const d = new Date();
  d.setDate(d.getDate() - randInt(0, daysAgo));
  return d.toISOString();
};
const randBool = (prob = 0.5) => Math.random() < prob;

function generateStreetAddress() {
  return `${randInt(100, 9999)} ${rand(STREET_NAMES)} ${rand(STREET_TYPES)}`;
}

function generatePhone() {
  const areaCode = rand(['610','484','215','267','856','302','609','570','717','814']);
  return `${areaCode}-${randInt(200,999)}-${randInt(1000,9999)}`;
}

function generateEmail(first, last, id) {
  const domains = ['gmail.com','yahoo.com','hotmail.com','duci-utility.com','outlook.com'];
  return `${first.toLowerCase()}.${last.toLowerCase()}${id % 100}@${rand(domains)}`;
}

// ── Generators ─────────────────────────────────────────────────────────────

function generateCustomers(count) {
  console.log(`Generating ${count} customers...`);
  const customers = [];
  for (let i = 1; i <= count; i++) {
    const first = rand(FIRST_NAMES);
    const last  = rand(LAST_NAMES);
    const loc   = rand(ALL_CITIES);
    const zip   = rand(loc.zips);
    const seg   = rand(SEGMENTS);

    customers.push({
      CUSTOMER_ID:       `CUST${String(i).padStart(8, '0')}`,
      BUSINESS_PARTNER:  `BP${String(i).padStart(10, '0')}`,
      FIRST_NAME:        first,
      LAST_NAME:         last,
      FULL_NAME:         `${first} ${last}`,
      EMAIL:             generateEmail(first, last, i),
      PHONE:             generatePhone(),
      CUSTOMER_SEGMENT:  seg,
      STATUS:            randBool(0.92) ? 'ACTIVE' : 'INACTIVE',
      CITY:              loc.city,
      STATE_CODE:        loc.state,
      ZIP_CODE:          zip,
      REGION:            loc.state === 'PA' ? 'NORTHEAST_PA' : loc.state === 'NJ' ? 'NJ' : 'DE',
      CREATED_ON:        randDate(1825),  // up to 5 years ago
      LAST_UPDATED:      randDate(365),
      NOTIFICATION_OPT_IN: randBool(0.85)
    });

    if (i % 10000 === 0) process.stdout.write(`  ${i}/${count}\r`);
  }
  return customers;
}

function generateContractAccounts(customers) {
  const targetCount = Math.floor(customers.length * CONTRACT_ACCOUNT_MULTIPLIER);
  console.log(`\nGenerating ${targetCount} contract accounts...`);
  const accounts = [];
  const caSet = new Set();

  let idx = 1;
  for (const customer of customers) {
    const numAccounts = randBool(0.8) ? 1 : randBool(0.7) ? 2 : 3;
    for (let j = 0; j < numAccounts && accounts.length < targetCount; j++) {
      const caId = `CA${String(idx).padStart(9, '0')}`;
      if (caSet.has(caId)) continue;
      caSet.add(caId);

      accounts.push({
        CONTRACT_ACCOUNT: caId,
        CUSTOMER_ID:      customer.CUSTOMER_ID,
        ACCOUNT_TYPE:     rand(ACCOUNT_TYPES),
        STATUS:           customer.STATUS === 'ACTIVE' ? (randBool(0.93) ? 'ACTIVE' : 'SUSPENDED') : 'INACTIVE',
        PREMISE_ID:       `PREM${String(idx).padStart(8, '0')}`,
        STREET_ADDRESS:   generateStreetAddress(),
        CITY:             customer.CITY,
        STATE_CODE:       customer.STATE_CODE,
        ZIP_CODE:         customer.ZIP_CODE,
        MOVE_IN_DATE:     randDate(1825).substring(0, 10),
        MOVE_OUT_DATE:    null,
        BILLING_CLASS:    rand(BILLING_CLASSES),
        CREATED_ON:       randDate(1825),
        LAST_UPDATED:     randDate(365)
      });
      idx++;
    }
  }
  return accounts;
}

function generateAddressHistory(customers, accounts, daysBack = 90) {
  console.log(`\nGenerating address history (last ${daysBack} days)...`);
  const history = [];

  // ~15% of Allentown customers had address changes in last 90 days (demo scenario)
  const allentownCustomers = customers.filter(c => c.CITY === 'Allentown' && c.STATUS === 'ACTIVE');
  const changedCustomers = allentownCustomers.filter(() => randBool(0.15));

  const caByCustomer = new Map();
  for (const acc of accounts) {
    if (!caByCustomer.has(acc.CUSTOMER_ID)) caByCustomer.set(acc.CUSTOMER_ID, []);
    caByCustomer.get(acc.CUSTOMER_ID).push(acc);
  }

  for (const customer of changedCustomers) {
    const cas = caByCustomer.get(customer.CUSTOMER_ID) || [];
    if (cas.length === 0) continue;

    const ca = rand(cas);
    const newCity  = rand(['Allentown', 'Bethlehem', 'Easton']);
    const newLoc   = ALL_CITIES.find(c => c.city === newCity) || ALL_CITIES[0];
    const newZip   = rand(newLoc.zips);

    history.push({
      HISTORY_ID:         uuidv4(),
      CUSTOMER_ID:        customer.CUSTOMER_ID,
      CONTRACT_ACCOUNT:   ca.CONTRACT_ACCOUNT,
      OLD_STREET_ADDRESS: ca.STREET_ADDRESS,
      OLD_CITY:           ca.CITY,
      OLD_STATE_CODE:     ca.STATE_CODE,
      OLD_ZIP_CODE:       ca.ZIP_CODE,
      NEW_STREET_ADDRESS: generateStreetAddress(),
      NEW_CITY:           newCity,
      NEW_STATE_CODE:     'PA',
      NEW_ZIP_CODE:       newZip,
      CHANGE_DATE:        randDate(daysBack),
      CHANGE_SOURCE:      rand(['MOVE_IN', 'CAMPAIGN', 'MANUAL']),
      VERIFIED:           false
    });
  }

  return history;
}

function generatePreferences(customers) {
  console.log('\nGenerating customer preferences...');
  const prefs = [];
  const channels = ['EMAIL', 'SMS', 'MAIL'];
  const types    = ['BILLING', 'OUTAGE', 'NOTIFICATIONS'];

  for (const customer of customers.slice(0, Math.min(customers.length, 50000))) {
    for (const channel of channels) {
      for (const type of types.slice(0, randInt(1, 3))) {
        prefs.push({
          PREFERENCE_ID:      uuidv4(),
          CUSTOMER_ID:        customer.CUSTOMER_ID,
          CHANNEL:            channel,
          PREFERENCE_TYPE:    type,
          OPTED_IN:           randBool(customer.NOTIFICATION_OPT_IN ? 0.9 : 0.3),
          PREFERRED_LANGUAGE: randBool(0.88) ? 'EN' : rand(['ES','FR','DE','PT']),
          PREFERRED_TIME:     rand(['MORNING','AFTERNOON','EVENING','ANYTIME']),
          LAST_UPDATED:       randDate(365),
          UPDATED_BY:         'SEED'
        });
      }
    }
  }
  return prefs;
}

function generateFailureScenarios(accounts) {
  console.log('\nGenerating failure scenario test data...');
  // Create 50 accounts with known failure conditions
  const failureAccounts = accounts.slice(0, 50).map((acc, i) => ({
    ...acc,
    CONTRACT_ACCOUNT: `CA_FAIL${String(i + 1).padStart(6, '0')}`,
    STATUS: i % 5 === 0 ? 'SUSPENDED' : 'ACTIVE',
    _FAILURE_REASON: rand(ERROR_MESSAGES)
  }));
  return failureAccounts;
}

// ── CSV / JSON writers ─────────────────────────────────────────────────────

function writeCSV(filename, records) {
  if (records.length === 0) return;
  const filePath = path.join(OUTPUT_DIR, filename);
  const headers  = Object.keys(records[0]).join(',');
  const rows     = records.map(r =>
    Object.values(r).map(v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  );
  fs.writeFileSync(filePath, [headers, ...rows].join('\n'), 'utf8');
  console.log(`  Written: ${filePath} (${records.length} records)`);
}

function writeJSON(filename, data) {
  const filePath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`  Written: ${filePath}`);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log(' DUCI Seed Data Generator');
  console.log(` Scenario: ${SCENARIO}, Customers: ${CUSTOMER_COUNT}`);
  console.log('═══════════════════════════════════════════\n');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const customers       = generateCustomers(CUSTOMER_COUNT);
  const accounts        = generateContractAccounts(customers);
  const addressHistory  = generateAddressHistory(customers, accounts, 90);
  const preferences     = generatePreferences(customers);
  const failureScenarios = generateFailureScenarios(accounts);

  console.log('\nWriting output files...');
  writeCSV('Z_CUSTOMERS.csv',           customers);
  writeCSV('Z_CONTRACT_ACCOUNTS.csv',   accounts);
  writeCSV('Z_ADDRESS_HISTORY.csv',     addressHistory);
  writeCSV('Z_CUSTOMER_PREFERENCES.csv', preferences);
  writeCSV('Z_FAILURE_SCENARIOS.csv',   failureScenarios);

  // JSON for API payloads / testing
  const allentown = accounts
    .filter(a => {
      const cust = customers.find(c => c.CUSTOMER_ID === a.CUSTOMER_ID);
      return cust?.CITY === 'Allentown' && a.STATUS === 'ACTIVE';
    })
    .map(a => a.CONTRACT_ACCOUNT)
    .slice(0, 500);

  writeJSON('allentown-demo-accounts.json', {
    description: 'DUCI Demo: Allentown active contract accounts for mailing address update demo',
    contractAccounts: allentown,
    count: allentown.length
  });

  // Stats summary
  const allentownCount = customers.filter(c => c.CITY === 'Allentown').length;
  const activeCount    = customers.filter(c => c.STATUS === 'ACTIVE').length;
  const addrChanges    = addressHistory.filter(h => h.OLD_CITY === 'Allentown').length;

  writeJSON('seed-stats.json', {
    generatedAt:         new Date().toISOString(),
    scenario:            SCENARIO,
    customers:           customers.length,
    contractAccounts:    accounts.length,
    addressHistoryRecs:  addressHistory.length,
    preferences:         preferences.length,
    failureScenarios:    failureScenarios.length,
    allentownCustomers:  allentownCount,
    activeCustomers:     activeCount,
    allentown90DayChanges: addrChanges,
    allentownDemoAccounts: allentown.length
  });

  console.log('\n═══════════════════════════════════════════');
  console.log(' Seed data generation complete!');
  console.log(`  Customers:          ${customers.length.toLocaleString()}`);
  console.log(`  Contract Accounts:  ${accounts.length.toLocaleString()}`);
  console.log(`  Address History:    ${addressHistory.length.toLocaleString()}`);
  console.log(`  Preferences:        ${preferences.length.toLocaleString()}`);
  console.log(`  Allentown Accounts: ${allentownCount.toLocaleString()}`);
  console.log(`  90-day Changes:     ${addrChanges.toLocaleString()}`);
  console.log('═══════════════════════════════════════════');
}

main().catch(console.error);
