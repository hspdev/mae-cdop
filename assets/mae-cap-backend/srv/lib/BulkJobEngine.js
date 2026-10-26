/**
 * BulkJobEngine — Orchestrates the full IBulkJobHandler pipeline
 *
 * Processing Steps:
 *   REQUEST_RECEIVED → VALIDATING_REQUEST → LOADING_CONTRACT_ACCOUNTS
 *   → PROCESSING_TRANSACTION → VERIFYING_UPDATES → GENERATING_RESULTS → COMPLETED
 *
 * Integrates:
 * - HandlerFactory (Strategy Pattern)
 * - RetryFramework (Exponential Backoff)
 * - Performance Metrics recording
 */

'use strict';

const { factory }       = require('../handlers/HandlerFactory');
const { RetryFramework } = require('./RetryFramework');
const { v4: uuidv4 }    = require('uuid');
const winston           = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

class BulkJobEngine {
  constructor(db) {
    this.db = db;
  }

  /**
   * Create and queue a new bulk job.
   *
   * @param {object} opts
   * @param {string} opts.jobType
   * @param {object} opts.parameters      - Raw job parameters
   * @param {boolean} opts.simulationMode
   * @param {string}  opts.requestedBy
   * @param {string}  opts.description
   * @returns {Promise<{ batchId: string }>}
   */
  async createJob({ jobType, parameters, simulationMode = false, requestedBy, description }) {
    if (!factory.isRegistered(jobType)) {
      throw new Error(`Unknown job type: ${jobType}. Registered: ${factory.getRegisteredTypes().join(', ')}`);
    }

    const batchId = uuidv4();
    const now = new Date().toISOString();

    await this.db.run(
      INSERT.into('mae.db.BatchJobs').entries({
        BATCH_ID:        batchId,
        JOB_TYPE:        jobType,
        STATUS:          'QUEUED',
        CURRENT_STEP:    'REQUEST_RECEIVED',
        TOTAL_ACCOUNTS:  0,
        PROCESSED_ACCOUNTS: 0,
        SUCCESS_COUNT:   0,
        FAILED_COUNT:    0,
        RETRY_COUNT:     0,
        SIMULATION_MODE: simulationMode,
        JOB_PARAMETERS:  JSON.stringify(parameters),
        REQUESTED_BY:    requestedBy || 'SYSTEM',
        DESCRIPTION:     description || `${jobType} job`,
        CREATED_ON:      now,
        LAST_UPDATE:     now
      })
    );

    logger.info(`[BulkJobEngine] Created job ${batchId} type=${jobType} sim=${simulationMode}`);
    return { batchId };
  }

  /**
   * Execute a job by batchId. Should be called from job scheduler or API.
   * @param {string} batchId
   */
  async executeJob(batchId) {
    const startTime = Date.now();

    const job = await this.db.run(
      SELECT.one.from('mae.db.BatchJobs').where({ BATCH_ID: batchId })
    );

    if (!job) throw new Error(`Batch job ${batchId} not found`);
    if (!['QUEUED', 'RETRYING'].includes(job.STATUS)) {
      throw new Error(`Job ${batchId} is in state ${job.STATUS} — cannot execute`);
    }

    const parameters = JSON.parse(job.JOB_PARAMETERS || '{}');

    const context = {
      batchId,
      parameters,
      simulationMode: job.SIMULATION_MODE,
      db:             this.db,
      logger,
      retryCount:     job.RETRY_COUNT
    };

    // Create Z_JOB_TRACK entry for this execution
    const requestId = uuidv4();
    await this.db.run(
      INSERT.into('mae.db.JobTrack').entries({
        REQUEST_ID:   requestId,
        BATCH_ID:     batchId,
        CURRENT_STEP: 'REQUEST_RECEIVED',
        STATUS:       'IN_PROGRESS',
        RETRY_COUNT:  job.RETRY_COUNT || 0,
        START_TIME:   new Date().toISOString(),
        LAST_UPDATE:  new Date().toISOString()
      })
    );

    // Mark IN_PROGRESS
    await this._updateJobStatus(batchId, 'IN_PROGRESS', 'VALIDATING_REQUEST');

    try {
      // Create handler via factory (Strategy Pattern)
      const handler = factory.create(job.JOB_TYPE, context);

      // ── Step 1: Validate ──────────────────────────────────────────────────
      await this._setStep(batchId, 'VALIDATING_REQUEST');
      const validation = await RetryFramework.withRetry(
        () => handler.validate(),
        `${batchId}:validate`,
        logger, 1
      );
      if (!validation.valid) {
        await this._failJob(batchId, `Validation failed: ${validation.errors.join('; ')}`);
        return { success: false, errors: validation.errors };
      }

      // ── Step 2: Load Records ───────────────────────────────────────────────
      await this._setStep(batchId, 'LOADING_CONTRACT_ACCOUNTS');
      const { count } = await RetryFramework.withRetry(
        () => handler.loadRecords(),
        `${batchId}:loadRecords`,
        logger, 2
      );
      logger.info(`[${batchId}] Loaded ${count} records`);

      // ── Step 3: Process ────────────────────────────────────────────────────
      await this._setStep(batchId, 'PROCESSING_TRANSACTION');
      const { successCount, failedCount } = await handler.process();
      logger.info(`[${batchId}] Processed: success=${successCount} failed=${failedCount}`);

      // ── Step 4: Verify ─────────────────────────────────────────────────────
      await this._setStep(batchId, 'VERIFYING_UPDATES');
      const verification = await handler.verify();
      logger.info(`[${batchId}] Verification: passed=${verification.verificationPassed}`);

      // ── Step 5: Generate Results ───────────────────────────────────────────
      await this._setStep(batchId, 'GENERATING_RESULTS');
      const { summary } = await handler.generateResults();

      // ── Complete ───────────────────────────────────────────────────────────
      const durationSec = Math.ceil((Date.now() - startTime) / 1000);
      const throughput  = count > 0 ? (count / durationSec).toFixed(2) : 0;
      const finalStatus = failedCount === 0 ? 'COMPLETED'
                        : failedCount < count ? 'PARTIALLY_COMPLETED'
                        : 'FAILED';

      await this.db.run(
        UPDATE('mae.db.BatchJobs').set({
          STATUS:           finalStatus,
          CURRENT_STEP:     'COMPLETED',
          COMPLETED_ON:     new Date().toISOString(),
          LAST_UPDATE:      new Date().toISOString(),
          DURATION_SECONDS: durationSec,
          THROUGHPUT_RPS:   parseFloat(throughput)
        }).where({ BATCH_ID: batchId })
      );

      // Update JobTrack with final completion status
      await this.db.run(
        UPDATE('mae.db.JobTrack').set({
          STATUS:       finalStatus,
          CURRENT_STEP: 'COMPLETED',
          END_TIME:     new Date().toISOString(),
          LAST_UPDATE:  new Date().toISOString()
        }).where({ BATCH_ID: batchId })
      ).catch(() => {});

      // Record performance metrics
      await this._recordMetrics(batchId, { count, durationSec, throughput });

      logger.info(`[${batchId}] Completed. Status=${finalStatus} Duration=${durationSec}s Throughput=${throughput}rps`);
      return { success: true, batchId, status: finalStatus, summary };

    } catch (err) {
      logger.error(`[${batchId}] Engine error: ${err.message}`, { stack: err.stack });
      await this._failJob(batchId, err.message);
      throw err;
    }
  }

  /**
   * Cancel a running or queued job
   */
  async cancelJob(batchId) {
    const job = await this.db.run(
      SELECT.one.from('mae.db.BatchJobs').where({ BATCH_ID: batchId })
    );
    if (!job) throw new Error(`Job ${batchId} not found`);
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.STATUS)) {
      return { success: false, message: `Job is already in terminal state: ${job.STATUS}` };
    }
    await this.db.run(
      UPDATE('mae.db.BatchJobs')
        .set({ STATUS: 'CANCELLED', LAST_UPDATE: new Date().toISOString() })
        .where({ BATCH_ID: batchId })
    );
    return { success: true, message: `Job ${batchId} cancelled` };
  }

  /**
   * Reprocess a failed/partially completed job
   */
  async reprocessJob(batchId, { onlyFailed = true, simulationMode } = {}) {
    const original = await this.db.run(
      SELECT.one.from('mae.db.BatchJobs').where({ BATCH_ID: batchId })
    );
    if (!original) throw new Error(`Job ${batchId} not found`);

    const originalParams = JSON.parse(original.JOB_PARAMETERS || '{}');

    // If onlyFailed, load only the failed contract accounts
    if (onlyFailed) {
      const failures = await this.db.run(
        SELECT.from('mae.db.BatchJobFailureLogs').where({ BATCH_ID: batchId, RESOLVED: false })
      );
      originalParams.contractAccounts = failures.map(f => f.contractAccount || f.CONTRACT_ACCOUNT).filter(Boolean);
    }

    const newSim = typeof simulationMode !== 'undefined' ? simulationMode : original.SIMULATION_MODE;

    const { batchId: newBatchId } = await this.createJob({
      jobType:        original.JOB_TYPE,
      parameters:     originalParams,
      simulationMode: newSim,
      requestedBy:    original.REQUESTED_BY,
      description:    `Reprocess of ${batchId} (${onlyFailed ? 'failed-only' : 'full'})`
    });

    return { newBatchId };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  async _updateJobStatus(batchId, status, step) {
    await this.db.run(
      UPDATE('mae.db.BatchJobs')
        .set({ STATUS: status, CURRENT_STEP: step, LAST_UPDATE: new Date().toISOString() })
        .where({ BATCH_ID: batchId })
    );
  }

  async _setStep(batchId, step) {
    const now = new Date().toISOString();
    await this.db.run(
      UPDATE('mae.db.BatchJobs')
        .set({ CURRENT_STEP: step, LAST_UPDATE: now })
        .where({ BATCH_ID: batchId })
    );
    // Mirror step change into JobTrack
    await this.db.run(
      UPDATE('mae.db.JobTrack')
        .set({ CURRENT_STEP: step, LAST_UPDATE: now })
        .where({ BATCH_ID: batchId })
    ).catch(() => {}); // non-fatal if row absent
  }

  async _failJob(batchId, errorMessage) {
    // Fetch current retry count to decide whether to retry or permanently fail
    const job = await this.db.run(
      SELECT.one.from('mae.db.BatchJobs').where({ BATCH_ID: batchId })
    );
    const currentRetryCount = (job && job.RETRY_COUNT) || 0;

    if (RetryFramework.shouldRetry(currentRetryCount)) {
      // Set RETRYING status and increment RETRY_COUNT
      const newRetryCount = currentRetryCount + 1;
      const retryDelay    = RetryFramework.getDelay(currentRetryCount);

      await this.db.run(
        UPDATE('mae.db.BatchJobs')
          .set({
            STATUS:       'RETRYING',
            RETRY_COUNT:  newRetryCount,
            LAST_UPDATE:  new Date().toISOString()
          })
          .where({ BATCH_ID: batchId })
      );

      await this.db.run(
        UPDATE('mae.db.JobTrack')
          .set({
            STATUS:      'RETRYING',
            RETRY_COUNT: newRetryCount,
            LAST_ERROR:  errorMessage,
            LAST_UPDATE: new Date().toISOString()
          })
          .where({ BATCH_ID: batchId })
      ).catch(() => {});

      logger.warn(`[${batchId}] Scheduling retry ${newRetryCount}/${RetryFramework.maxRetries} in ${retryDelay}ms`);

      // Re-queue the job after delay (non-blocking)
      setTimeout(() => {
        this.executeJob(batchId).catch(err => {
          logger.error(`[${batchId}] Retry ${newRetryCount} failed: ${err.message}`);
        });
      }, retryDelay);

    } else {
      // Max retries exhausted — mark permanently FAILED
      await this.db.run(
        UPDATE('mae.db.BatchJobs')
          .set({
            STATUS:       'FAILED',
            LAST_UPDATE:  new Date().toISOString(),
            COMPLETED_ON: new Date().toISOString()
          })
          .where({ BATCH_ID: batchId })
      );

      await this.db.run(
        UPDATE('mae.db.JobTrack')
          .set({
            STATUS:      'FAILED',
            LAST_ERROR:  errorMessage,
            END_TIME:    new Date().toISOString(),
            LAST_UPDATE: new Date().toISOString()
          })
          .where({ BATCH_ID: batchId })
      ).catch(() => {});
    }
  }

  async _recordMetrics(batchId, { count, durationSec, throughput }) {
    const now = new Date().toISOString();
    const metrics = [
      { type: 'THROUGHPUT',  value: parseFloat(throughput), unit: 'records/sec' },
      { type: 'DURATION',    value: durationSec,             unit: 'seconds'     },
      { type: 'RECORD_COUNT', value: count,                  unit: 'records'     }
    ];

    for (const m of metrics) {
      await this.db.run(
        INSERT.into('mae.db.PerformanceMetrics').entries({
          METRIC_ID:    uuidv4(),
          BATCH_ID:     batchId,
          METRIC_TYPE:  m.type,
          METRIC_VALUE: m.value,
          UNIT:         m.unit,
          RECORDED_AT:  now,
          RECORD_COUNT: count
        })
      );
    }
  }
}

module.exports = { BulkJobEngine };
