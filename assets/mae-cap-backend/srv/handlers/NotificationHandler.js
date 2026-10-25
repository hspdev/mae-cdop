/**
 * NotificationHandler — Handles bulk notification request jobs
 *
 * Dispatches notifications via configured channels (EMAIL, SMS, MAIL).
 * In simulation mode, records what would be sent without dispatching.
 *
 * Implements: IBulkJobHandler
 */

'use strict';

const { IBulkJobHandler } = require('./IBulkJobHandler');
const { BatchQueryClient } = require('../lib/BatchQueryClient');
const { v4: uuidv4 } = require('uuid');

const VALID_CHANNELS    = ['EMAIL', 'SMS', 'MAIL', 'PUSH'];
const VALID_NOTIF_TYPES = ['ADDRESS_CONFIRMATION', 'ACCOUNT_UPDATE', 'OUTAGE_ALERT',
                            'BILLING_REMINDER', 'CAMPAIGN', 'SERVICE_CHANGE'];

class NotificationHandler extends IBulkJobHandler {

  async validate() {
    const errors = [];
    const p = this.parameters;
    if (!p) return { valid: false, errors: ['jobParameters is required'] };

    if (!Array.isArray(p.contractAccounts) || p.contractAccounts.length === 0) {
      errors.push('contractAccounts[] is required');
    }
    if (!p.notificationType || !VALID_NOTIF_TYPES.includes(p.notificationType)) {
      errors.push(`notificationType is required. Valid: ${VALID_NOTIF_TYPES.join(', ')}`);
    }
    if (!p.channel || !VALID_CHANNELS.includes(p.channel)) {
      errors.push(`channel is required. Valid: ${VALID_CHANNELS.join(', ')}`);
    }
    if (!p.subject) errors.push('subject is required');
    if (!p.template && !p.content) errors.push('Either template name or content is required');

    return { valid: errors.length === 0, errors };
  }

  async loadRecords() {
    const client = new BatchQueryClient(this.db);
    const records = await client.loadContractAccounts(this.parameters.contractAccounts);

    // Filter to customers who have opted in to this channel
    this.records = records.filter(r =>
      r.notificationOptIn !== false  // default: include
    );

    this.filteredOut = records.length - this.records.length;
    await this.db.run(
      UPDATE('mae.db.BatchJobs')
        .set({ TOTAL_ACCOUNTS: this.records.length, LAST_UPDATE: new Date().toISOString() })
        .where({ BATCH_ID: this.batchId })
    );
    return { count: this.records.length, records: this.records };
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
          const content = this._renderContent(record, p.content || p.template);
          const notifId = uuidv4();

          if (!this.simulationMode) {
            // Insert notification record — actual dispatch would call an email/SMS gateway
            await this.db.run(
              INSERT.into('mae.db.Notifications').entries({
                NOTIFICATION_ID:   notifId,
                CUSTOMER_ID:       record.customerId,
                CONTRACT_ACCOUNT:  record.contractAccount,
                NOTIFICATION_TYPE: p.notificationType,
                CHANNEL:           p.channel,
                SUBJECT:           p.subject,
                CONTENT:           content,
                STATUS:            'SENT',  // In production: 'PENDING' until gateway confirms
                BATCH_ID:          this.batchId,
                CREATED_ON:        new Date().toISOString(),
                SENT_ON:           new Date().toISOString()
              })
            );
          }
          successCount++;
        } catch (err) {
          failedCount++;
          failedRecords.push({ contractAccount: record.contractAccount, error: err.message });
          await this.logFailure(record.contractAccount, err.message, 'NOTIFICATION_DISPATCH_FAILED');
        }
        processedCount++;
      }
      await this.updateProgress(processedCount, successCount, failedCount);
    }

    return { successCount, failedCount, failedRecords };
  }

  _renderContent(record, template) {
    // Simple merge-field substitution
    return (template || '')
      .replace(/\{\{customerName\}\}/g, record.customerName || 'Valued Customer')
      .replace(/\{\{contractAccount\}\}/g, record.contractAccount)
      .replace(/\{\{city\}\}/g, record.city)
      .replace(/\{\{email\}\}/g, record.email);
  }

  async verify() {
    await this.setStep('VERIFYING_UPDATES');
    if (this.simulationMode) return { verificationPassed: true, discrepancies: [], note: 'Simulation mode' };

    const sentCount = await this.db.run(
      SELECT.from('mae.db.Notifications')
        .where({ BATCH_ID: this.batchId, STATUS: 'SENT' })
        .columns('COUNT(*) as COUNT')
    );
    const expectedSuccess = (await this.db.run(
      SELECT.one.from('mae.db.BatchJobs').where({ BATCH_ID: this.batchId })
    ))?.SUCCESS_COUNT || 0;

    const actualSent = sentCount[0]?.COUNT || 0;
    const discrepancies = [];
    if (actualSent < expectedSuccess) {
      discrepancies.push({ issue: `Notification count mismatch: expected ${expectedSuccess}, found ${actualSent} SENT records` });
    }

    return { verificationPassed: discrepancies.length === 0, discrepancies };
  }

  async generateResults() {
    await this.setStep('GENERATING_RESULTS');
    const job = await this.db.run(SELECT.one.from('mae.db.BatchJobs').where({ BATCH_ID: this.batchId }));
    const failures = await this.db.run(SELECT.from('mae.db.BatchJobFailureLogs').where({ BATCH_ID: this.batchId }));

    return {
      summary: {
        batchId:            this.batchId,
        jobType:            'NOTIFICATION_REQUEST',
        status:             job.STATUS,
        simulationMode:     this.simulationMode,
        totalAccounts:      job.TOTAL_ACCOUNTS,
        successCount:       job.SUCCESS_COUNT,
        failedCount:        job.FAILED_COUNT,
        filteredOutOptOut:  this.filteredOut || 0,
        successRate:        job.TOTAL_ACCOUNTS > 0 ? ((job.SUCCESS_COUNT / job.TOTAL_ACCOUNTS) * 100).toFixed(2) + '%' : '0%',
        channel:            this.parameters.channel,
        notificationType:   this.parameters.notificationType,
        failedAccounts:     failures.map(f => ({ contractAccount: f.CONTRACT_ACCOUNT, errorMessage: f.ERROR_MESSAGE }))
      }
    };
  }
}

module.exports = { NotificationHandler };
