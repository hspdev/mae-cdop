/**
 * BulkJobService — CAP service handler
 * Handles OData V4 actions and REST API routing
 */

'use strict';

const cds                = require('@sap/cds');
const { BulkJobEngine }  = require('./lib/BulkJobEngine');
const { v4: uuidv4 }     = require('uuid');

module.exports = class BulkJobServiceHandler extends cds.ApplicationService {

  async init() {
    const { BatchJobs, BatchJobFailureLogs } = this.entities;
    const db = await cds.connect.to('db');

    // ── OData Actions ──────────────────────────────────────────────────────

    this.on('createBulkJob', async (req) => {
      const engine = new BulkJobEngine(db);
      const { jobType, jobParameters, simulationMode, description } = req.data;
      let parameters;
      try {
        parameters = typeof jobParameters === 'string' ? JSON.parse(jobParameters) : jobParameters;
      } catch {
        return req.error(400, 'jobParameters must be valid JSON');
      }

      const { batchId } = await engine.createJob({
        jobType,
        parameters,
        simulationMode: simulationMode || false,
        requestedBy:    req.user?.id || 'anonymous',
        description
      });

      // Kick off async execution (non-blocking in CF — job scheduler handles real scale)
      setImmediate(() => engine.executeJob(batchId).catch(e =>
        cds.log('BulkJobEngine').error(`Job ${batchId} failed: ${e.message}`)
      ));

      return { batchId, status: 'QUEUED', message: `Job ${batchId} queued for ${jobType}` };
    });

    this.on('cancelBulkJob', async (req) => {
      const engine = new BulkJobEngine(db);
      return await engine.cancelJob(req.data.batchId);
    });

    this.on('reprocessBulkJob', async (req) => {
      const engine = new BulkJobEngine(db);
      const { batchId, onlyFailed, simulationMode } = req.data;
      const { newBatchId } = await engine.reprocessJob(batchId, { onlyFailed, simulationMode });

      // Start async reprocessing
      setImmediate(() => engine.executeJob(newBatchId).catch(e =>
        cds.log('BulkJobEngine').error(`Reprocess job ${newBatchId} failed: ${e.message}`)
      ));

      return { newBatchId, message: `Reprocessing started as new job ${newBatchId}` };
    });

    this.on('getJobSummary', async (req) => {
      const { batchId } = req.data;
      const job = await db.run(
        SELECT.one.from('mae.db.BatchJobs').where({ BATCH_ID: batchId })
      );
      if (!job) return req.error(404, `Job ${batchId} not found`);

      const failures = await db.run(
        SELECT.from('mae.db.BatchJobFailureLogs')
          .where({ BATCH_ID: batchId })
          .limit(100)
      );

      const metrics = await db.run(
        SELECT.from('mae.db.PerformanceMetrics').where({ BATCH_ID: batchId })
      );

      return JSON.stringify({ job, failures, metrics });
    });

    this.on('getExecutiveSummary', async (req) => {
      const { fromDate, toDate } = req.data;
      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      const from = (fromDate && DATE_RE.test(fromDate)) ? fromDate
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
      const to = (toDate && DATE_RE.test(toDate)) ? toDate
        : new Date().toISOString().substring(0, 10);
      const jobs = await db.run(
        SELECT.from('mae.db.BatchJobs')
          .where(`CREATED_ON >= '${from}T00:00:00Z' AND CREATED_ON <= '${to}T23:59:59Z'`)
          .orderBy('CREATED_ON desc')
      );

      const totals = jobs.reduce((acc, j) => {
        acc.totalJobs++;
        acc.totalAccounts    += j.TOTAL_ACCOUNTS   || 0;
        acc.totalSuccess     += j.SUCCESS_COUNT    || 0;
        acc.totalFailed      += j.FAILED_COUNT     || 0;
        acc.totalDuration    += j.DURATION_SECONDS || 0;
        acc.totalRetries     += j.RETRY_COUNT      || 0;
        if (j.STATUS === 'COMPLETED')           acc.completedJobs++;
        if (j.STATUS === 'PARTIALLY_COMPLETED') acc.partialJobs++;
        if (j.STATUS === 'FAILED')              acc.failedJobs++;
        return acc;
      }, { totalJobs: 0, completedJobs: 0, partialJobs: 0, failedJobs: 0,
           totalAccounts: 0, totalSuccess: 0, totalFailed: 0, totalDuration: 0, totalRetries: 0 });

      totals.overallSuccessRate = totals.totalAccounts > 0
        ? ((totals.totalSuccess / totals.totalAccounts) * 100).toFixed(2) + '%'
        : '0%';
      totals.estimatedHoursSaved = (totals.totalAccounts * 0.002).toFixed(1);  // ~2min per 1000 records vs manual
      totals.aiRecoveries  = totals.totalRetries;
      totals.costAvoidance = Math.round(totals.totalAccounts * 0.52);
      totals.fromDate = from;
      totals.toDate   = to;

      return JSON.stringify({ summary: totals, jobs });
    });

    await super.init();
  }
};
