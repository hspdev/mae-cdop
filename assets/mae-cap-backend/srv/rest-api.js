/**
 * MAE REST API — /api/* endpoints (non-OData)
 *
 * Mounted by server.js alongside CAP OData services.
 */

'use strict';

const express       = require('express');
const cds           = require('@sap/cds');
const { BulkJobEngine } = require('./lib/BulkJobEngine');

const router = express.Router();

// ── Middleware: parse JSON ─────────────────────────────────────────────────
router.use(express.json({ limit: '50mb' }));

/**
 * POST /api/bulk-jobs/:jobType
 * Create and queue a new bulk job
 */
router.post('/bulk-jobs/:jobType', async (req, res) => {
  try {
    const db = await cds.connect.to('db');
    const engine = new BulkJobEngine(db);

    const { jobType } = req.params;
    const { parameters, simulationMode = false, description } = req.body;

    const { batchId } = await engine.createJob({
      jobType:        jobType.toUpperCase(),
      parameters:     parameters || req.body,
      simulationMode: Boolean(simulationMode),
      requestedBy:    req.user?.id || req.headers['x-user-id'] || 'api-user',
      description
    });

    setImmediate(() => engine.executeJob(batchId).catch(console.error));

    res.status(202).json({ batchId, status: 'QUEUED', jobType, message: `Job queued successfully` });
  } catch (err) {
    const status = err.message.includes('Unknown job type') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * GET /api/bulk-jobs/:batchId/status
 */
router.get('/bulk-jobs/:batchId/status', async (req, res) => {
  try {
    const db = await cds.connect.to('db');
    const job = await db.run(
      SELECT.one.from('mae.db.BatchJobs').where({ BATCH_ID: req.params.batchId })
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const progress = job.TOTAL_ACCOUNTS > 0
      ? Math.round((job.PROCESSED_ACCOUNTS / job.TOTAL_ACCOUNTS) * 100)
      : 0;

    res.json({
      batchId:           job.BATCH_ID,
      jobType:           job.JOB_TYPE,
      status:            job.STATUS,
      currentStep:       job.CURRENT_STEP,
      totalAccounts:     job.TOTAL_ACCOUNTS,
      processedAccounts: job.PROCESSED_ACCOUNTS,
      successCount:      job.SUCCESS_COUNT,
      failedCount:       job.FAILED_COUNT,
      progressPct:       progress,
      simulationMode:    job.SIMULATION_MODE,
      createdOn:         job.CREATED_ON,
      lastUpdate:        job.LAST_UPDATE,
      completedOn:       job.COMPLETED_ON,
      durationSeconds:   job.DURATION_SECONDS,
      throughputRps:     job.THROUGHPUT_RPS
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/bulk-jobs/:batchId/result
 */
router.get('/bulk-jobs/:batchId/result', async (req, res) => {
  try {
    const db = await cds.connect.to('db');
    const job = await db.run(
      SELECT.one.from('mae.db.BatchJobs').where({ BATCH_ID: req.params.batchId })
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED'].includes(job.STATUS)) {
      return res.status(409).json({ error: `Job is still ${job.STATUS}` });
    }

    const failures = await db.run(
      SELECT.from('mae.db.BatchJobFailureLogs').where({ BATCH_ID: job.BATCH_ID })
    );
    const metrics = await db.run(
      SELECT.from('mae.db.PerformanceMetrics').where({ BATCH_ID: job.BATCH_ID })
    );

    res.json({
      batchId:           job.BATCH_ID,
      jobType:           job.JOB_TYPE,
      status:            job.STATUS,
      simulationMode:    job.SIMULATION_MODE,
      totalAccounts:     job.TOTAL_ACCOUNTS,
      successCount:      job.SUCCESS_COUNT,
      failedCount:       job.FAILED_COUNT,
      retryCount:        job.RETRY_COUNT,
      successRate:       job.TOTAL_ACCOUNTS > 0 ? ((job.SUCCESS_COUNT / job.TOTAL_ACCOUNTS) * 100).toFixed(2) + '%' : '0%',
      durationSeconds:   job.DURATION_SECONDS,
      throughputRps:     job.THROUGHPUT_RPS,
      createdOn:         job.CREATED_ON,
      completedOn:       job.COMPLETED_ON,
      failedAccounts:    failures,
      performanceMetrics: metrics
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bulk-jobs/:batchId/reprocess
 */
router.post('/bulk-jobs/:batchId/reprocess', async (req, res) => {
  try {
    const db = await cds.connect.to('db');
    const engine = new BulkJobEngine(db);
    const { onlyFailed = true, simulationMode } = req.body;
    const { newBatchId } = await engine.reprocessJob(req.params.batchId, { onlyFailed, simulationMode });

    setImmediate(() => engine.executeJob(newBatchId).catch(console.error));

    res.status(202).json({ newBatchId, message: 'Reprocessing started', status: 'QUEUED' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bulk-jobs/:batchId/cancel
 */
router.post('/bulk-jobs/:batchId/cancel', async (req, res) => {
  try {
    const db = await cds.connect.to('db');
    const engine = new BulkJobEngine(db);
    const result = await engine.cancelJob(req.params.batchId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/customers/batch
 * Set-based customer retrieval — never use large OData OR filters
 * Body: { "contractAccounts": ["CA100001", "CA100002", ...] }
 */
router.post('/customers/batch', async (req, res) => {
  try {
    const { contractAccounts } = req.body;
    if (!Array.isArray(contractAccounts) || contractAccounts.length === 0) {
      return res.status(400).json({ error: 'contractAccounts array is required' });
    }
    if (contractAccounts.length > 100000) {
      return res.status(400).json({ error: 'Maximum 100,000 contract accounts per request' });
    }

    const db = await cds.connect.to('db');
    const { BatchQueryClient } = require('./lib/BatchQueryClient');
    const client = new BatchQueryClient(db);
    const records = await client.loadContractAccounts(contractAccounts);

    res.json({
      count: records.length,
      requestedCount: contractAccounts.length,
      records
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /health
 */
router.get('/health', (req, res) => {
  res.json({ status: 'UP', timestamp: new Date().toISOString(), service: 'mae-cap-backend' });
});

module.exports = router;
