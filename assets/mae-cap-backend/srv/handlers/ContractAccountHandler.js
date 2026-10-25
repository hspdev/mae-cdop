/**
 * ContractAccountHandler — Handles bulk contract account update jobs
 *
 * Supports: billing class changes, account type migrations,
 * status updates, move-out processing.
 *
 * Implements: IBulkJobHandler
 */

'use strict';

const { IBulkJobHandler } = require('./IBulkJobHandler');
const { BatchQueryClient } = require('../lib/BatchQueryClient');
const { v4: uuidv4 } = require('uuid');

const VALID_BILLING_CLASSES = ['STANDARD', 'BUDGET', 'PREPAID', 'COMMERCIAL', 'INDUSTRIAL'];
const VALID_ACCOUNT_TYPES   = ['ELECTRICITY', 'GAS', 'WATER', 'DUAL_FUEL', 'BUNDLED'];
const VALID_STATUSES        = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'CLOSED'];

class ContractAccountHandler extends IBulkJobHandler {

  async validate() {
    const errors = [];
    const p = this.parameters;

    if (!p) return { valid: false, errors: ['jobParameters is required'] };

    const hasAccounts = Array.isArray(p.contractAccounts) && p.contractAccounts.length > 0;
    if (!hasAccounts) errors.push('contractAccounts[] is required and must be non-empty');

    if (!p.updates || Object.keys(p.updates).length === 0) {
      errors.push('updates object is required — specify fields to update');
    }

    if (p.updates?.billingClass && !VALID_BILLING_CLASSES.includes(p.updates.billingClass)) {
      errors.push(`Invalid billingClass: ${p.updates.billingClass}. Valid: ${VALID_BILLING_CLASSES.join(', ')}`);
    }

    if (p.updates?.accountType && !VALID_ACCOUNT_TYPES.includes(p.updates.accountType)) {
      errors.push(`Invalid accountType: ${p.updates.accountType}. Valid: ${VALID_ACCOUNT_TYPES.join(', ')}`);
    }

    if (p.updates?.status && !VALID_STATUSES.includes(p.updates.status)) {
      errors.push(`Invalid status: ${p.updates.status}. Valid: ${VALID_STATUSES.join(', ')}`);
    }

    if (Array.isArray(p.contractAccounts) && p.contractAccounts.length > 100000) {
      errors.push('Maximum 100,000 contract accounts per job');
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
    let successCount = 0;
    let failedCount  = 0;
    const failedRecords = [];

    await this.setStep('PROCESSING_TRANSACTION');

    const chunks = this.chunkArray(this.records, parseInt(process.env.BATCH_CHUNK_SIZE || 500));
    let processedCount = 0;

    const updateFields = {};
    const p = this.parameters.updates;

    if (p.billingClass) updateFields.BILLING_CLASS = p.billingClass;
    if (p.accountType)  updateFields.ACCOUNT_TYPE  = p.accountType;
    if (p.status)       updateFields.STATUS         = p.status;
    updateFields.LAST_UPDATED = new Date().toISOString();

    for (const chunk of chunks) {
      for (const record of chunk) {
        try {
          if (!this.simulationMode) {
            await this.db.run(
              UPDATE('mae.db.ContractAccounts')
                .set(updateFields)
                .where({ CONTRACT_ACCOUNT: record.contractAccount })
            );
          }
          successCount++;
        } catch (err) {
          failedCount++;
          failedRecords.push({ contractAccount: record.contractAccount, error: err.message });
          await this.logFailure(record.contractAccount, err.message, 'CONTRACT_ACCOUNT_UPDATE_FAILED');
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

    const sampleSize = Math.min(Math.ceil(this.records.length * 0.05), 500);
    const sample = this.records.slice(0, sampleSize);
    const discrepancies = [];
    const p = this.parameters.updates;

    for (const record of sample) {
      const updated = await this.db.run(
        SELECT.one.from('mae.db.ContractAccounts')
          .where({ CONTRACT_ACCOUNT: record.contractAccount })
      );
      if (p.billingClass && updated?.BILLING_CLASS !== p.billingClass) {
        discrepancies.push({ contractAccount: record.contractAccount, field: 'BILLING_CLASS', expected: p.billingClass, actual: updated?.BILLING_CLASS });
      }
      if (p.status && updated?.STATUS !== p.status) {
        discrepancies.push({ contractAccount: record.contractAccount, field: 'STATUS', expected: p.status, actual: updated?.STATUS });
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
        batchId:        this.batchId,
        jobType:        'CONTRACT_ACCOUNT_UPDATE',
        status:         job.STATUS,
        simulationMode: this.simulationMode,
        totalAccounts:  job.TOTAL_ACCOUNTS,
        successCount:   job.SUCCESS_COUNT,
        failedCount:    job.FAILED_COUNT,
        successRate:    job.TOTAL_ACCOUNTS > 0 ? ((job.SUCCESS_COUNT / job.TOTAL_ACCOUNTS) * 100).toFixed(2) + '%' : '0%',
        updatesApplied: this.parameters.updates,
        failedAccounts: failures.map(f => ({ contractAccount: f.CONTRACT_ACCOUNT, errorMessage: f.ERROR_MESSAGE }))
      }
    };
  }
}

module.exports = { ContractAccountHandler };
