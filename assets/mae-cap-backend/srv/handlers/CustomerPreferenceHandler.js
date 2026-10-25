/**
 * CustomerPreferenceHandler — Handles bulk customer preference update jobs
 *
 * Supports: channel opt-in/opt-out, language preference, notification timing.
 *
 * Implements: IBulkJobHandler
 */

'use strict';

const { IBulkJobHandler } = require('./IBulkJobHandler');
const { BatchQueryClient } = require('../lib/BatchQueryClient');
const { v4: uuidv4 } = require('uuid');

const VALID_CHANNELS    = ['EMAIL', 'SMS', 'PHONE', 'MAIL'];
const VALID_PREF_TYPES  = ['BILLING', 'OUTAGE', 'MARKETING', 'NOTIFICATIONS', 'ALL'];
const VALID_LANGUAGES   = ['EN', 'ES', 'FR', 'DE', 'PT', 'ZH'];
const VALID_TIMES       = ['MORNING', 'AFTERNOON', 'EVENING', 'ANYTIME'];

class CustomerPreferenceHandler extends IBulkJobHandler {

  async validate() {
    const errors = [];
    const p = this.parameters;
    if (!p) return { valid: false, errors: ['jobParameters is required'] };

    if (!Array.isArray(p.contractAccounts) || p.contractAccounts.length === 0) {
      errors.push('contractAccounts[] is required');
    }

    if (p.channel && !VALID_CHANNELS.includes(p.channel)) {
      errors.push(`Invalid channel: ${p.channel}`);
    }
    if (p.preferenceType && !VALID_PREF_TYPES.includes(p.preferenceType)) {
      errors.push(`Invalid preferenceType: ${p.preferenceType}`);
    }
    if (p.preferredLanguage && !VALID_LANGUAGES.includes(p.preferredLanguage)) {
      errors.push(`Invalid preferredLanguage: ${p.preferredLanguage}`);
    }
    if (p.preferredTime && !VALID_TIMES.includes(p.preferredTime)) {
      errors.push(`Invalid preferredTime: ${p.preferredTime}`);
    }
    if (typeof p.optedIn === 'undefined' && !p.preferredLanguage && !p.preferredTime) {
      errors.push('At least one preference update field is required: optedIn, preferredLanguage, or preferredTime');
    }

    return { valid: errors.length === 0, errors };
  }

  async loadRecords() {
    const client = new BatchQueryClient(this.db);
    const records = await client.loadContractAccounts(this.parameters.contractAccounts);
    this.records = records;
    await this.db.run(
      UPDATE('mae.db.BatchJobs')
        .set({ TOTAL_ACCOUNTS: records.length, LAST_UPDATE: new Date().toISOString() })
        .where({ BATCH_ID: this.batchId })
    );
    return { count: records.length, records };
  }

  async process() {
    let successCount = 0, failedCount = 0;
    const failedRecords = [];
    await this.setStep('PROCESSING_TRANSACTION');
    const chunks = this.chunkArray(this.records, parseInt(process.env.BATCH_CHUNK_SIZE || 500));
    let processedCount = 0;
    const p = this.parameters;

    for (const chunk of chunks) {
      for (const record of chunk) {
        try {
          if (!this.simulationMode) {
            // Upsert preference record
            const existing = await this.db.run(
              SELECT.one.from('mae.db.CustomerPreferences')
                .where({
                  CUSTOMER_ID: record.customerId,
                  CHANNEL: p.channel || 'EMAIL',
                  PREFERENCE_TYPE: p.preferenceType || 'NOTIFICATIONS'
                })
            );

            const prefData = {
              CUSTOMER_ID:        record.customerId,
              CHANNEL:            p.channel || 'EMAIL',
              PREFERENCE_TYPE:    p.preferenceType || 'NOTIFICATIONS',
              OPTED_IN:           typeof p.optedIn !== 'undefined' ? p.optedIn : true,
              PREFERRED_LANGUAGE: p.preferredLanguage || 'EN',
              PREFERRED_TIME:     p.preferredTime || 'ANYTIME',
              LAST_UPDATED:       new Date().toISOString(),
              UPDATED_BY:         'BULK_JOB'
            };

            if (existing) {
              await this.db.run(
                UPDATE('mae.db.CustomerPreferences').set(prefData)
                  .where({ PREFERENCE_ID: existing.PREFERENCE_ID })
              );
            } else {
              await this.db.run(
                INSERT.into('mae.db.CustomerPreferences').entries({
                  PREFERENCE_ID: uuidv4(),
                  ...prefData
                })
              );
            }
          }
          successCount++;
        } catch (err) {
          failedCount++;
          failedRecords.push({ contractAccount: record.contractAccount, error: err.message });
          await this.logFailure(record.contractAccount, err.message, 'PREFERENCE_UPDATE_FAILED');
        }
        processedCount++;
      }
      await this.updateProgress(processedCount, successCount, failedCount);
    }

    return { successCount, failedCount, failedRecords };
  }

  async verify() {
    await this.setStep('VERIFYING_UPDATES');
    if (this.simulationMode) return { verificationPassed: true, discrepancies: [], note: 'Simulation mode' };
    const sampleSize = Math.min(Math.ceil(this.records.length * 0.05), 100);
    const sample = this.records.slice(0, sampleSize);
    const discrepancies = [];
    const p = this.parameters;

    for (const record of sample) {
      const pref = await this.db.run(
        SELECT.one.from('mae.db.CustomerPreferences')
          .where({
            CUSTOMER_ID: record.customerId,
            CHANNEL: p.channel || 'EMAIL',
            PREFERENCE_TYPE: p.preferenceType || 'NOTIFICATIONS'
          })
      );
      if (!pref) {
        discrepancies.push({ customerId: record.customerId, issue: 'Preference record not found after upsert' });
      }
    }

    return { verificationPassed: discrepancies.length === 0, discrepancies, sampleSize };
  }

  async generateResults() {
    await this.setStep('GENERATING_RESULTS');
    const job = await this.db.run(SELECT.one.from('mae.db.BatchJobs').where({ BATCH_ID: this.batchId }));
    const failures = await this.db.run(SELECT.from('mae.db.BatchJobFailureLogs').where({ BATCH_ID: this.batchId }));

    return {
      summary: {
        batchId:           this.batchId,
        jobType:           'CUSTOMER_PREFERENCE_UPDATE',
        status:            job.STATUS,
        simulationMode:    this.simulationMode,
        totalAccounts:     job.TOTAL_ACCOUNTS,
        successCount:      job.SUCCESS_COUNT,
        failedCount:       job.FAILED_COUNT,
        successRate:       job.TOTAL_ACCOUNTS > 0 ? ((job.SUCCESS_COUNT / job.TOTAL_ACCOUNTS) * 100).toFixed(2) + '%' : '0%',
        preferencesSet: {
          channel:            this.parameters.channel,
          preferenceType:     this.parameters.preferenceType,
          optedIn:            this.parameters.optedIn,
          preferredLanguage:  this.parameters.preferredLanguage
        },
        failedAccounts: failures.map(f => ({ contractAccount: f.CONTRACT_ACCOUNT, errorMessage: f.ERROR_MESSAGE }))
      }
    };
  }
}

module.exports = { CustomerPreferenceHandler };
