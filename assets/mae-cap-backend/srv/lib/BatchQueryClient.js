/**
 * BatchQueryClient – Set-based batch data retrieval
 *
 * NEVER uses large OData OR filters.
 * Uses chunked IN-clause SQL for set-based retrieval (SQLite & HANA compatible).
 *
 * For SAP HANA Cloud production deployments the isHana flag enables
 * JSON_TABLE optimisation.  For demo / Joule Studio deployments SQLite
 * in-memory mode is used automatically.
 */

'use strict';

// Ensure CDS globals (SELECT, INSERT, UPDATE, DELETE) are available
// whether running inside CDS runtime or in unit tests
const cds = require('@sap/cds');
const { SELECT: _SELECT } = cds; // eslint-disable-line no-unused-vars
// Make SELECT available as a module-level variable
if (typeof SELECT === 'undefined') {
  global.SELECT = cds.ql?.SELECT || cds.SELECT;
  global.INSERT = cds.ql?.INSERT || cds.INSERT;
  global.UPDATE = cds.ql?.UPDATE || cds.UPDATE;
  global.DELETE = cds.ql?.DELETE || cds.DELETE;
}

const CHUNK_SIZE = 500; // safe chunk size for both SQLite and HANA IN() clauses

class BatchQueryClient {
  constructor(db) {
    this.db   = db;
    // HANA optimisation only when explicitly configured
    this.isHana = (process.env.DB_KIND === 'hana-cloud');
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Load contract account records in bulk using chunked IN-clause SQL.
   * @param {string[]} contractAccountNumbers
   * @returns {Promise<object[]>}
   */
  async loadContractAccounts(contractAccountNumbers) {
    if (!contractAccountNumbers || contractAccountNumbers.length === 0) return [];

    const chunks  = this._chunk(contractAccountNumbers, CHUNK_SIZE);
    const results = [];

    for (const chunk of chunks) {
      // Use CDS SELECT API — works with any database (SQLite table names resolved automatically)
      const rows = await this.db.run(
        SELECT.from('mae.db.ContractAccounts', ca => {
          ca.CONTRACT_ACCOUNT, ca.CUSTOMER_ID, ca.ACCOUNT_TYPE,
          ca.STATUS, ca.STREET_ADDRESS, ca.CITY, ca.STATE_CODE, ca.ZIP_CODE
        }).where({ CONTRACT_ACCOUNT: { in: chunk }, STATUS: 'ACTIVE' })
      );
      results.push(...(rows || []));
    }

    return results;
  }

  /**
   * Batch load customers by contract accounts (POST /api/customers/batch).
   * @param {string[]} contractAccounts
   * @returns {Promise<object[]>}
   */
  async batchLoadCustomers(contractAccounts) {
    if (!contractAccounts || contractAccounts.length === 0) return [];

    const chunks  = this._chunk(contractAccounts, CHUNK_SIZE);
    const results = [];

    for (const chunk of chunks) {
      const rows = await this.db.run(
        SELECT.from('mae.db.ContractAccounts')
          .where({ CONTRACT_ACCOUNT: { in: chunk } })
      );
      results.push(...(rows || []));
    }

    return results;
  }

  /**
   * Load all active customers in a city with address changes in the last N days.
   * Primary query for the DUCI Allentown demo scenario.
   * @param {string} city
   * @param {number} days
   * @returns {Promise<object[]>}
   */
  async loadCustomersByCity(city, days = 90) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Step 1: recent address changes in that city using CDS API
    const historyRows = await this.db.run(
      SELECT.from('mae.db.AddressHistory',
        ['CONTRACT_ACCOUNT','NEW_STREET_ADDRESS','NEW_CITY','NEW_STATE_CODE','NEW_ZIP_CODE','CHANGE_DATE']
      ).where(`NEW_CITY like '%${city}%' and CHANGE_DATE >= '${cutoff}'`)
    );

    if (!historyRows || historyRows.length === 0) return [];

    const contractAccounts = [...new Set(historyRows.map(r => r.CONTRACT_ACCOUNT))];

    // Step 2: full account detail in chunks
    const accounts = await this.loadContractAccounts(contractAccounts);

    // Step 3: attach new address
    const historyMap = {};
    historyRows.forEach(h => { historyMap[h.CONTRACT_ACCOUNT] = h; });

    return accounts.map(a => ({
      ...a,
      newAddress: historyMap[a.CONTRACT_ACCOUNT || a.contractAccount] || null
    }));
  }

  /**
   * Load address history for given contract accounts.
   * @param {string[]} contractAccounts
   * @returns {Promise<object[]>}
   */
  async loadAddressHistory(contractAccounts) {
    if (!contractAccounts || contractAccounts.length === 0) return [];

    const chunks  = this._chunk(contractAccounts, CHUNK_SIZE);
    const results = [];

    for (const chunk of chunks) {
      const rows = await this.db.run(
        SELECT.from('mae.db.AddressHistory')
          .where({ CONTRACT_ACCOUNT: { in: chunk } })
          .orderBy('CHANGE_DATE desc')
      );
      results.push(...(rows || []));
    }

    return results;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  _chunk(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}

module.exports = { BatchQueryClient };
