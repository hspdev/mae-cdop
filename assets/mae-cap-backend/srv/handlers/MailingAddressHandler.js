/**
 * MailingAddressHandler — Handles bulk mailing address update jobs
 *
 * DUCI Primary Demo Scenario:
 * "Find all active customers in Allentown with address changes in the
 *  last 90 days and update customer records using new campaign data."
 *
 * Implements: IBulkJobHandler
 */

'use strict';

const { IBulkJobHandler } = require('./IBulkJobHandler');
const { BatchQueryClient } = require('../lib/BatchQueryClient');
const { v4: uuidv4 } = require('uuid');

const REQUIRED_FIELDS = ['streetAddress', 'city', 'stateCode', 'zipCode'];

class MailingAddressHandler extends IBulkJobHandler {

  // ── Step 1: Validate ───────────────────────────────────────────────────────
  async validate() {
    const errors = [];
    const p = this.parameters;

    if (!p) {
      return { valid: false, errors: ['jobParameters is required'] };
    }

    // Must have either contractAccounts list or a filter
    const hasAccounts = Array.isArray(p.contractAccounts) && p.contractAccounts.length > 0;
    const hasFilter   = p.filter && (p.filter.city || p.filter.region || p.filter.zipCode);

    if (!hasAccounts && !hasFilter) {
      errors.push('Either contractAccounts[] or a filter (city/region/zipCode) is required');
    }

    if (p.filter && p.filter.city !== undefined) {
      const city = p.filter.city;
      if (typeof city !== 'string' || city.trim().length === 0) {
        errors.push('filter.city must be a non-empty string');
      } else if (city.length > 100) {
        errors.push('filter.city exceeds maximum length of 100 characters');
      } else if (!/^[a-zA-Z\s.\-']+$/.test(city)) {
        errors.push('filter.city contains invalid characters');
      }
    }

    if (!p.campaignData && !p.useExistingAddressHistory && !p.newAddress) {
      errors.push('Either campaignData, newAddress, or useExistingAddressHistory=true is required');
    }

    if (p.campaignData) {
      for (const record of (p.campaignData || [])) {
        for (const field of REQUIRED_FIELDS) {
          if (!record[field]) {
            errors.push(`campaignData record missing required field: ${field}`);
            break;
          }
        }
      }
    }

    if (Array.isArray(p.contractAccounts) && p.contractAccounts.length > 100000) {
      errors.push('Maximum 100,000 contract accounts per job');
    }

    return { valid: errors.length === 0, errors };
  }

  // ── Step 2: Load Records ──────────────────────────────────────────────────
  async loadRecords() {
    let contractAccounts = this.parameters.contractAccounts || [];
    let records;

    // If filter provided, load via city/days filter (SQLite-compatible)
    if (contractAccounts.length === 0 && this.parameters.filter) {
      const client = new BatchQueryClient(this.db);
      const city     = this.parameters.filter.city || 'Allentown';
      const daysBack = this.parameters.filter.daysBack || 90;
      records = await client.loadCustomersByCity(city, daysBack);
      contractAccounts = records.map(r => r.CONTRACT_ACCOUNT || r.contractAccount).filter(Boolean);
    } else {
      const client = new BatchQueryClient(this.db);
      records = await client.loadContractAccounts(contractAccounts);
    }

    this.logger.info(`[${this.batchId}] Loading ${records.length} contract accounts`);

    this.records = records;
    this.contractAccounts = contractAccounts;

    // Update total in Z_BATCH_JOB
    await this.db.run(
      UPDATE('mae.db.BatchJobs')
        .set({ TOTAL_ACCOUNTS: records.length, LAST_UPDATE: new Date().toISOString() })
        .where({ BATCH_ID: this.batchId })
    );

    return { count: records.length, records };
  }

  // ── Step 3: Process ───────────────────────────────────────────────────────
  async process() {
    let successCount = 0;
    let failedCount  = 0;
    const failedRecords = [];

    await this.setStep('PROCESSING_TRANSACTION');

    const chunks = this.chunkArray(this.records, parseInt(process.env.BATCH_CHUNK_SIZE || 500));
    let processedCount = 0;

    for (const chunk of chunks) {
      for (const record of chunk) {
        try {
          const newAddress = this._resolveNewAddress(record);

          if (!newAddress) {
            throw new Error(`No campaign address found for contract account ${record.contractAccount}`);
          }

          if (!this.simulationMode) {
            // Update Z_CONTRACT_ACCOUNTS
            await this.db.run(
              UPDATE('mae.db.ContractAccounts')
                .set({
                  STREET_ADDRESS: newAddress.streetAddress,
                  CITY:           newAddress.city,
                  STATE_CODE:     newAddress.stateCode,
                  ZIP_CODE:       newAddress.zipCode,
                  LAST_UPDATED:   new Date().toISOString()
                })
                .where({ CONTRACT_ACCOUNT: record.contractAccount })
            );

            // Update Z_CUSTOMERS if customer address matches
            await this.db.run(
              UPDATE('mae.db.Customers')
                .set({
                  CITY:         newAddress.city,
                  STATE_CODE:   newAddress.stateCode,
                  ZIP_CODE:     newAddress.zipCode,
                  LAST_UPDATED: new Date().toISOString()
                })
                .where({ CUSTOMER_ID: record.customerId })
            );

            // Write address history
            await this.db.run(
              INSERT.into('mae.db.AddressHistory').entries({
                HISTORY_ID:         uuidv4(),
                CUSTOMER_ID:        record.customerId,
                CONTRACT_ACCOUNT:   record.contractAccount,
                OLD_STREET_ADDRESS: record.streetAddress,
                OLD_CITY:           record.city,
                OLD_STATE_CODE:     record.stateCode,
                OLD_ZIP_CODE:       record.zipCode,
                NEW_STREET_ADDRESS: newAddress.streetAddress,
                NEW_CITY:           newAddress.city,
                NEW_STATE_CODE:     newAddress.stateCode,
                NEW_ZIP_CODE:       newAddress.zipCode,
                CHANGE_DATE:        new Date().toISOString(),
                CHANGE_SOURCE:      'CAMPAIGN',
                VERIFIED:           false
              })
            );
          }

          successCount++;
        } catch (err) {
          failedCount++;
          failedRecords.push({ contractAccount: record.contractAccount, error: err.message });
          await this.logFailure(record.contractAccount, err.message, 'ADDRESS_UPDATE_FAILED');
          this.logger.warn(`[${this.batchId}] Failed: ${record.contractAccount} — ${err.message}`);
        }

        processedCount++;
      }

      // Progress checkpoint after each chunk
      await this.updateProgress(processedCount, successCount, failedCount);
    }

    return { successCount, failedCount, failedRecords };
  }

  _resolveNewAddress(record) {
    const p = this.parameters;

    // Option 1: per-account campaign data map
    if (p.campaignData) {
      const campaignMap = this._getCampaignMap();
      return campaignMap.get(record.contractAccount) || null;
    }

    // Option 2: single address for all accounts (mass move scenario)
    if (p.newAddress) {
      return p.newAddress;
    }

    // Option 3: use latest address history record (attached by loadCustomersByCity as record.newAddress)
    if (p.useExistingAddressHistory) {
      const hist = record.newAddress;
      return {
        streetAddress: hist?.newStreetAddress || hist?.NEW_STREET_ADDRESS || record.streetAddress || record.STREET_ADDRESS,
        city:          hist?.newCity          || hist?.NEW_CITY           || record.city          || record.CITY,
        stateCode:     hist?.newStateCode     || hist?.NEW_STATE_CODE     || record.stateCode     || record.STATE_CODE,
        zipCode:       hist?.newZipCode       || hist?.NEW_ZIP_CODE       || record.zipCode       || record.ZIP_CODE
      };
    }

    return null;
  }

  _getCampaignMap() {
    if (!this._campaignMap) {
      this._campaignMap = new Map(
        (this.parameters.campaignData || []).map(r => [r.contractAccount, r])
      );
    }
    return this._campaignMap;
  }

  // ── Step 4: Verify ────────────────────────────────────────────────────────
  async verify() {
    await this.setStep('VERIFYING_UPDATES');
    const discrepancies = [];

    if (this.simulationMode) {
      return { verificationPassed: true, discrepancies: [], note: 'Simulation mode — skipped' };
    }

    // Spot-check: verify a sample of 5% or max 500 records
    const sampleSize = Math.min(Math.ceil(this.records.length * 0.05), 500);
    const sample = this.records.slice(0, sampleSize);

    for (const record of sample) {
      const updated = await this.db.run(
        SELECT.one.from('mae.db.ContractAccounts')
          .where({ CONTRACT_ACCOUNT: record.contractAccount })
      );

      if (!updated) {
        discrepancies.push({ contractAccount: record.contractAccount, issue: 'Record not found after update' });
      }
    }

    return {
      verificationPassed: discrepancies.length === 0,
      discrepancies,
      sampleSize
    };
  }

  // ── Step 5: Generate Results ───────────────────────────────────────────────
  async generateResults() {
    await this.setStep('GENERATING_RESULTS');

    const job = await this.db.run(
      SELECT.one.from('mae.db.BatchJobs').where({ BATCH_ID: this.batchId })
    );

    const failures = await this.db.run(
      SELECT.from('mae.db.BatchJobFailureLogs').where({ BATCH_ID: this.batchId })
    );

    const summary = {
      batchId:           this.batchId,
      jobType:           'MAILING_ADDRESS_UPDATE',
      status:            job.STATUS,
      simulationMode:    this.simulationMode,
      totalAccounts:     job.TOTAL_ACCOUNTS,
      processedAccounts: job.PROCESSED_ACCOUNTS,
      successCount:      job.SUCCESS_COUNT,
      failedCount:       job.FAILED_COUNT,
      successRate:       job.TOTAL_ACCOUNTS > 0
                           ? ((job.SUCCESS_COUNT / job.TOTAL_ACCOUNTS) * 100).toFixed(2) + '%'
                           : '0%',
      durationSeconds:   job.DURATION_SECONDS,
      throughputRps:     job.THROUGHPUT_RPS,
      failedAccounts:    failures.map(f => ({
        contractAccount: f.CONTRACT_ACCOUNT,
        errorMessage:    f.ERROR_MESSAGE,
        errorCode:       f.ERROR_CODE
      })),
      completedOn: new Date().toISOString()
    };

    return { summary, csvPath: null, jsonPath: null };
  }
}

module.exports = { MailingAddressHandler };
