/**
 * MAE REST API — /api/* endpoints (non-OData)
 *
 * Mounted by server.js alongside CAP OData services.
 *
 * Transaction Routing Engine
 * ──────────────────────────
 *   1 account          → Direct Update (synchronous, no job record needed)
 *   2–10 accounts      → Direct Update with progress (synchronous BatchJob)
 *   11+ accounts       → Bulk Job Framework (async, setImmediate)
 *   filter-based query → always Bulk Job Framework (unknown count)
 */

'use strict';

const express           = require('express');
const cds               = require('@sap/cds');
const { v4: uuidv4 }    = require('uuid');
const { BulkJobEngine } = require('./lib/BulkJobEngine');

const router = express.Router();

// ── Routing constants ──────────────────────────────────────────────────────────
const DIRECT_THRESHOLD = 10;

/**
 * getAccountCount(parameters)
 * Returns the number of accounts targeted by a job request.
 *   - parameters.contractAccounts (array)  → exact count
 *   - parameters.filter (city/OData query) → 999 (treat as bulk)
 *   - anything else                        → 0 (engine will validate)
 */
function getAccountCount(parameters) {
  if (!parameters) return 0;
  if (Array.isArray(parameters.contractAccounts)) {
    return parameters.contractAccounts.length;
  }
  if (parameters.filter) {
    return 999; // filter-based — count unknown, always use async path
  }
  return 0;
}

/**
 * directProcess(jobType, parameters, simulationMode, db)
 * Creates a BatchJob record, executes it synchronously (blocks until done),
 * and returns { batchId, status, summary }.
 * Suitable only for ≤ DIRECT_THRESHOLD records.
 */
async function directProcess(jobType, parameters, simulationMode, db) {
  const engine = new BulkJobEngine(db);

  const { batchId } = await engine.createJob({
    jobType:        jobType.toUpperCase(),
    parameters,
    simulationMode: Boolean(simulationMode),
    requestedBy:    'api-direct',
    description:    `Direct ${jobType} (≤${DIRECT_THRESHOLD} accounts)`
  });

  // Synchronous execution — no setImmediate, blocks until complete
  const result = await engine.executeJob(batchId);

  return {
    batchId,
    status:  result.status  || 'COMPLETED',
    summary: result.summary || {}
  };
}

// ── Middleware: parse JSON ─────────────────────────────────────────────────
router.use(express.json({ limit: '50mb' }));

/**
 * POST /api/bulk-jobs/:jobType
 *
 * Transaction Routing Engine:
 *   accountCount 1–10   → DIRECT  (synchronous, waits for result)
 *   accountCount 11+    → ASYNC   (queued via setImmediate)
 *   filter-based params → ASYNC   (count unknown, always bulk)
 *   accountCount 0      → ASYNC   (engine validates and may fail gracefully)
 */
router.post('/bulk-jobs/:jobType', async (req, res) => {
  try {
    const db = await cds.connect.to('db');

    const { jobType } = req.params;
    const { parameters, simulationMode = false, description } = req.body;
    const params = parameters || req.body;

    const accountCount = getAccountCount(params);

    // ── Direct path: 1–DIRECT_THRESHOLD accounts ───────────────────────────
    if (accountCount > 0 && accountCount <= DIRECT_THRESHOLD) {
      const result = await directProcess(jobType, params, simulationMode, db);
      return res.json({
        routingMode: 'DIRECT',
        batchId:     result.batchId,
        status:      result.status,
        message:     'Processed directly — no job queued',
        result:      result.summary
      });
    }

    // ── Async path: 11+ accounts or filter-based ────────────────────────────
    const engine = new BulkJobEngine(db);

    const { batchId } = await engine.createJob({
      jobType:        jobType.toUpperCase(),
      parameters:     params,
      simulationMode: Boolean(simulationMode),
      requestedBy:    req.user?.id || req.headers['x-user-id'] || 'api-user',
      description
    });

    setImmediate(() => engine.executeJob(batchId).catch(console.error));

    res.status(202).json({
      routingMode: 'ASYNC',
      batchId,
      status:  'QUEUED',
      jobType,
      message: `Job queued successfully`
    });
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
 * GET /api/summary?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD
 * Executive summary — no role requirement, suitable for dashboard KPIs
 */
router.get('/summary', async (req, res) => {
  try {
    const db = await cds.connect.to('db');
    const { fromDate, toDate } = req.query;
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
      acc.totalAccounts  += j.TOTAL_ACCOUNTS   || 0;
      acc.totalSuccess   += j.SUCCESS_COUNT    || 0;
      acc.totalFailed    += j.FAILED_COUNT     || 0;
      acc.totalDuration  += j.DURATION_SECONDS || 0;
      acc.totalRetries   += j.RETRY_COUNT      || 0;
      if (j.STATUS === 'COMPLETED')           acc.completedJobs++;
      if (j.STATUS === 'PARTIALLY_COMPLETED') acc.partialJobs++;
      if (j.STATUS === 'FAILED')              acc.failedJobs++;
      return acc;
    }, { totalJobs: 0, completedJobs: 0, partialJobs: 0, failedJobs: 0,
         totalAccounts: 0, totalSuccess: 0, totalFailed: 0, totalDuration: 0, totalRetries: 0 });

    const successRate = totals.totalAccounts > 0
      ? parseFloat(((totals.totalSuccess / totals.totalAccounts) * 100).toFixed(2))
      : 0;

    res.json({
      summary: {
        totalJobs:           totals.totalJobs,
        completedJobs:       totals.completedJobs,
        partialJobs:         totals.partialJobs,
        failedJobs:          totals.failedJobs,
        totalAccounts:       totals.totalAccounts,
        totalSuccess:        totals.totalSuccess,
        totalFailed:         totals.totalFailed,
        overallSuccessRate:  successRate,
        estimatedHoursSaved: parseFloat((totals.totalAccounts * 0.002).toFixed(1)),
        aiRecoveries:        totals.totalRetries,
        costAvoidance:       Math.round(totals.totalAccounts * 0.52),
        fromDate:            from,
        toDate:              to
      },
      jobs
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

/**
 * POST /api/copilot
 * Simple copilot proxy — returns rule-based response (AI integration optional)
 */
router.post('/copilot', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    const db = await cds.connect.to('db');
    const recentJobs = await db.run(
      SELECT.from('mae.db.BatchJobs').orderBy('CREATED_ON desc').limit(5)
    ).catch(() => []);

    const jobCount    = recentJobs.length;
    const successJobs = recentJobs.filter(j => j.STATUS === 'COMPLETED' || j.STATUS === 'PARTIALLY_COMPLETED').length;
    const totalRecs   = recentJobs.reduce((s, j) => s + (j.TOTAL_ACCOUNTS || j.totalAccounts || 0), 0);
    const inProgress  = recentJobs.filter(j => j.STATUS === 'IN_PROGRESS' || j.STATUS === 'QUEUED').length;

    const m = message.toLowerCase();
    let response;
    if (m.includes('allentown') || m.includes('city')) {
      response = `I can search for customers in Allentown. Based on recent address history, there are active accounts with recent address changes. Would you like me to prepare a <strong>MAILING_ADDRESS_UPDATE</strong> simulation job?`;
    } else if (m.includes('summary') || m.includes('report') || m.includes('executive')) {
      const statusBreakdown = successJobs > 0
        ? `${successJobs} completed successfully`
        : inProgress > 0 ? `${inProgress} currently in progress` : 'no completed jobs in recent history';
      response = `<strong>Platform Summary (last ${jobCount} jobs):</strong><br>• ${jobCount} jobs in system<br>• ${statusBreakdown}<br>• ${totalRecs.toLocaleString()} records processed<br>Navigate to Executive Summary for the full report.`;
    } else if (m.includes('fail') || m.includes('error')) {
      response = `To analyze failures, navigate to <strong>Failure Analysis</strong> and enter a Batch ID, or I can help you reprocess failed records. What batch would you like to review?`;
    } else if (m.includes('status') || m.includes('job')) {
      const statusMsg = successJobs > 0
        ? `${successJobs} completed successfully`
        : inProgress > 0 ? `${inProgress} currently in progress` : 'check Job Monitor for details';
      response = `There are currently <strong>${jobCount} recent jobs</strong> in the system. ${statusMsg}. Check the <strong>Job Monitor</strong> for real-time status.`;
    } else {
      response = `I'm the DUCI Operations Copilot. I can help with:<br>• Creating and monitoring bulk data jobs<br>• Analyzing failures and root causes<br>• Generating executive reports<br>• Finding customers by city or criteria<br><br>What would you like to do?`;
    }

    res.json({ response, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/contracts/:contractAccount/address
 * Direct Update path — updates a single contract account address immediately
 */
router.patch('/contracts/:contractAccount/address', async (req, res) => {
  try {
    const { contractAccount } = req.params;
    const { streetAddress, city, stateCode, zipCode } = req.body;

    if (!streetAddress || !city || !stateCode || !zipCode) {
      return res.status(400).json({ error: 'streetAddress, city, stateCode, zipCode are required' });
    }

    const db = await cds.connect.to('db');

    const existing = await db.run(
      SELECT.one.from('mae.db.ContractAccounts').where({ CONTRACT_ACCOUNT: contractAccount })
    );
    if (!existing) return res.status(404).json({ error: `Contract account ${contractAccount} not found` });

    await db.run(
      UPDATE('mae.db.ContractAccounts').set({
        STREET_ADDRESS: streetAddress,
        CITY:           city,
        STATE_CODE:     stateCode,
        ZIP_CODE:       zipCode,
        LAST_UPDATED:   new Date().toISOString()
      }).where({ CONTRACT_ACCOUNT: contractAccount })
    );

    await db.run(
      INSERT.into('mae.db.AddressHistory').entries({
        HISTORY_ID:         uuidv4(),
        CUSTOMER_ID:        existing.customerId || existing.CUSTOMER_ID,
        CONTRACT_ACCOUNT:   contractAccount,
        OLD_STREET_ADDRESS: existing.streetAddress || existing.STREET_ADDRESS,
        OLD_CITY:           existing.city           || existing.CITY,
        OLD_STATE_CODE:     existing.stateCode      || existing.STATE_CODE,
        OLD_ZIP_CODE:       existing.zipCode        || existing.ZIP_CODE,
        NEW_STREET_ADDRESS: streetAddress,
        NEW_CITY:           city,
        NEW_STATE_CODE:     stateCode,
        NEW_ZIP_CODE:       zipCode,
        CHANGE_DATE:        new Date().toISOString(),
        CHANGE_SOURCE:      'DIRECT_UPDATE',
        VERIFIED:           true
      })
    );

    res.json({ success: true, contractAccount, message: 'Address updated directly' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/contracts/:contractAccount
 * Fetch a single contract account with joined customer data.
 */
router.get('/contracts/:contractAccount', async (req, res) => {
  try {
    const { contractAccount } = req.params;
    const db = await cds.connect.to('db');

    const account = await db.run(
      SELECT.one.from('mae.db.ContractAccounts').where({ CONTRACT_ACCOUNT: contractAccount })
    );
    if (!account) {
      return res.status(404).json({ error: `Contract account ${contractAccount} not found` });
    }

    const customerId = account.CUSTOMER_ID || account.customerId;
    const customer = customerId
      ? await db.run(SELECT.one.from('mae.db.Customers').where({ CUSTOMER_ID: customerId }))
      : null;

    res.json({
      contractAccount: {
        contractAccount:  account.CONTRACT_ACCOUNT,
        customerId:       account.CUSTOMER_ID,
        accountType:      account.ACCOUNT_TYPE,
        status:           account.STATUS,
        premiseId:        account.PREMISE_ID,
        streetAddress:    account.STREET_ADDRESS,
        city:             account.CITY,
        stateCode:        account.STATE_CODE,
        zipCode:          account.ZIP_CODE,
        moveInDate:       account.MOVE_IN_DATE,
        moveOutDate:      account.MOVE_OUT_DATE,
        billingClass:     account.BILLING_CLASS,
        createdOn:        account.CREATED_ON,
        lastUpdated:      account.LAST_UPDATED
      },
      customer: customer ? {
        customerId:         customer.CUSTOMER_ID,
        businessPartner:    customer.BUSINESS_PARTNER,
        firstName:          customer.FIRST_NAME,
        lastName:           customer.LAST_NAME,
        fullName:           customer.FULL_NAME,
        email:              customer.EMAIL,
        phone:              customer.PHONE,
        customerSegment:    customer.CUSTOMER_SEGMENT,
        status:             customer.STATUS,
        city:               customer.CITY,
        stateCode:          customer.STATE_CODE,
        zipCode:            customer.ZIP_CODE,
        region:             customer.REGION,
        notificationOptIn:  customer.NOTIFICATION_OPT_IN,
        createdOn:          customer.CREATED_ON,
        lastUpdated:        customer.LAST_UPDATED
      } : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/contracts/:contractAccount/account
 * Direct Update — billingClass, status, and/or accountType for one contract account.
 * Body: { billingClass?, status?, accountType? }
 */
router.patch('/contracts/:contractAccount/account', async (req, res) => {
  try {
    const { contractAccount } = req.params;
    const { billingClass, status, accountType } = req.body;

    if (!billingClass && !status && !accountType) {
      return res.status(400).json({
        error: 'At least one of billingClass, status, or accountType is required'
      });
    }

    const db = await cds.connect.to('db');

    const existing = await db.run(
      SELECT.one.from('mae.db.ContractAccounts').where({ CONTRACT_ACCOUNT: contractAccount })
    );
    if (!existing) {
      return res.status(404).json({ error: `Contract account ${contractAccount} not found` });
    }

    const updateSet = { LAST_UPDATED: new Date().toISOString() };
    if (billingClass !== undefined) updateSet.BILLING_CLASS  = billingClass;
    if (status      !== undefined) updateSet.STATUS          = status;
    if (accountType !== undefined) updateSet.ACCOUNT_TYPE    = accountType;

    await db.run(
      UPDATE('mae.db.ContractAccounts').set(updateSet).where({ CONTRACT_ACCOUNT: contractAccount })
    );

    // Re-fetch to return the updated record
    const updated = await db.run(
      SELECT.one.from('mae.db.ContractAccounts').where({ CONTRACT_ACCOUNT: contractAccount })
    );

    res.json({
      success:         true,
      contractAccount,
      message:         'Account updated directly',
      updatedFields:   Object.keys(req.body),
      updatedRecord:   updated
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/contracts/:contractAccount/preference
 * Direct Update — communication preference for the customer linked to the contract account.
 * Body: { channel, optedIn?, preferredLanguage? }
 */
router.patch('/contracts/:contractAccount/preference', async (req, res) => {
  try {
    const { contractAccount } = req.params;
    const { channel, optedIn, preferredLanguage } = req.body;

    if (!channel) {
      return res.status(400).json({ error: 'channel is required' });
    }

    const db = await cds.connect.to('db');

    const account = await db.run(
      SELECT.one.from('mae.db.ContractAccounts').where({ CONTRACT_ACCOUNT: contractAccount })
    );
    if (!account) {
      return res.status(404).json({ error: `Contract account ${contractAccount} not found` });
    }

    const customerId = account.CUSTOMER_ID || account.customerId;
    if (!customerId) {
      return res.status(422).json({ error: 'Contract account has no associated customer' });
    }

    const now = new Date().toISOString();

    // Check for an existing preference record for this customer + channel
    const existing = await db.run(
      SELECT.one.from('mae.db.CustomerPreferences')
        .where({ CUSTOMER_ID: customerId, CHANNEL: channel })
    );

    if (existing) {
      const prefUpdateSet = { LAST_UPDATED: now, UPDATED_BY: 'DIRECT_UPDATE' };
      if (optedIn           !== undefined) prefUpdateSet.OPTED_IN           = Boolean(optedIn);
      if (preferredLanguage !== undefined) prefUpdateSet.PREFERRED_LANGUAGE  = preferredLanguage;

      await db.run(
        UPDATE('mae.db.CustomerPreferences').set(prefUpdateSet)
          .where({ CUSTOMER_ID: customerId, CHANNEL: channel })
      );
    } else {
      await db.run(
        INSERT.into('mae.db.CustomerPreferences').entries({
          PREFERENCE_ID:      uuidv4(),
          CUSTOMER_ID:        customerId,
          CHANNEL:            channel,
          PREFERENCE_TYPE:    'COMMUNICATION',
          OPTED_IN:           optedIn !== undefined ? Boolean(optedIn) : true,
          PREFERRED_LANGUAGE: preferredLanguage || 'EN',
          LAST_UPDATED:       now,
          UPDATED_BY:         'DIRECT_UPDATE'
        })
      );
    }

    const updated = await db.run(
      SELECT.one.from('mae.db.CustomerPreferences')
        .where({ CUSTOMER_ID: customerId, CHANNEL: channel })
    );

    res.json({
      success:         true,
      contractAccount,
      customerId,
      channel,
      message:         'Preference updated directly',
      updatedRecord:   updated
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/customers/search?query=&city=&top=20
 * Search customers by contract account, name, city, or ZIP.
 */
router.get('/customers/search', async (req, res) => {
  try {
    const { query = '', city = '', top = 20 } = req.query;
    const db = await cds.connect.to('db');
    const limit = Math.min(Number(top) || 20, 200);

    let accounts;
    if (!query && !city) {
      accounts = await db.run(
        SELECT.from('mae.db.ContractAccounts').limit(limit).orderBy('CREATED_ON desc')
      );
    } else {
      const conditions = [];
      if (city) {
        const safeCity = city.replace(/'/g, "''");
        conditions.push(`upper(ca.CITY) like upper('%${safeCity}%')`);
      }
      if (query) {
        const q = query.replace(/'/g, "''");
        conditions.push(
          `(upper(ca.CONTRACT_ACCOUNT) like upper('%${q}%') OR ` +
          `upper(ca.CITY) like upper('%${q}%') OR ` +
          `upper(ca.ZIP_CODE) like upper('%${q}%'))`
        );
      }
      const where = conditions.join(' AND ');
      accounts = await db.run(
        SELECT.from({ ref: ['mae.db.ContractAccounts'], as: 'ca' })
          .where(where)
          .limit(limit)
          .orderBy('ca.CREATED_ON desc')
      );
    }

    // Enrich with customer name if available
    const enriched = await Promise.all(accounts.map(async (a) => {
      const cid = a.CUSTOMER_ID || a.customerId;
      const customer = cid
        ? await db.run(SELECT.one.from('mae.db.Customers').where({ CUSTOMER_ID: cid })).catch(() => null)
        : null;
      return {
        CONTRACT_ACCOUNT: a.CONTRACT_ACCOUNT,
        CUSTOMER_ID: a.CUSTOMER_ID,
        FULL_NAME: customer ? (customer.FULL_NAME || `${customer.FIRST_NAME || ''} ${customer.LAST_NAME || ''}`.trim()) : '',
        STREET_ADDRESS: a.STREET_ADDRESS,
        CITY: a.CITY,
        STATE_CODE: a.STATE_CODE,
        ZIP_CODE: a.ZIP_CODE,
        STATUS: a.STATUS || 'ACTIVE',
        EMAIL: customer ? customer.EMAIL : ''
      };
    }));

    res.json({ count: enriched.length, records: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/insights
 * Platform insights — live performance metrics derived from job history
 */
router.get('/insights', async (req, res) => {
  try {
    const db = await cds.connect.to('db');
    const now = new Date();
    const from30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
    const from90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

    const [jobs30, jobs90] = await Promise.all([
      db.run(SELECT.from('mae.db.BatchJobs').where(`CREATED_ON >= '${from30}T00:00:00Z'`)),
      db.run(SELECT.from('mae.db.BatchJobs').where(`CREATED_ON >= '${from90}T00:00:00Z'`))
    ]);

    const perfJobs = jobs30.filter(j => j.DURATION_SECONDS && j.TOTAL_ACCOUNTS > 0);
    const avgThroughput = perfJobs.length > 0
      ? Math.round(perfJobs.reduce((s, j) => s + (j.THROUGHPUT_RPS || (j.TOTAL_ACCOUNTS / j.DURATION_SECONDS)), 0) / perfJobs.length)
      : 0;

    // Job type breakdown for 90 days
    const byType = {};
    for (const j of jobs90) {
      const t = j.JOB_TYPE || 'UNKNOWN';
      if (!byType[t]) byType[t] = { jobType: t, count: 0, records: 0, success: 0, failed: 0 };
      byType[t].count++;
      byType[t].records += j.TOTAL_ACCOUNTS || 0;
      byType[t].success += j.SUCCESS_COUNT || 0;
      byType[t].failed  += j.FAILED_COUNT  || 0;
    }
    const jobTypeBreakdown = Object.values(byType).map(t => ({
      ...t,
      successRate: t.records > 0 ? parseFloat(((t.success / t.records) * 100).toFixed(1)) : 0
    })).sort((a, b) => b.records - a.records);

    // Daily volumes (last 7 days)
    const dailyVolumes = [];
    for (let d = 6; d >= 0; d--) {
      const day = new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
      const dayJobs = jobs30.filter(j => (j.CREATED_ON || '').startsWith(day));
      dailyVolumes.push({
        date: day,
        jobs: dayJobs.length,
        records: dayJobs.reduce((s, j) => s + (j.TOTAL_ACCOUNTS || 0), 0)
      });
    }

    const totalJobs30 = jobs30.length;
    const completedJobs30 = jobs30.filter(j => j.STATUS === 'COMPLETED').length;
    const totalRecs30 = jobs30.reduce((s, j) => s + (j.TOTAL_ACCOUNTS || 0), 0);
    const successRecs30 = jobs30.reduce((s, j) => s + (j.SUCCESS_COUNT || 0), 0);
    const failureRecs30 = jobs30.reduce((s, j) => s + (j.FAILED_COUNT || 0), 0);

    res.json({
      period: { from: from30, to: now.toISOString().substring(0, 10) },
      summary: {
        totalJobs: totalJobs30,
        completedJobs: completedJobs30,
        totalRecords: totalRecs30,
        successRecords: successRecs30,
        failureRecords: failureRecs30,
        successRate: totalRecs30 > 0 ? parseFloat(((successRecs30 / totalRecs30) * 100).toFixed(1)) : 0,
        avgThroughputRps: avgThroughput,
        estimatedHoursSaved: parseFloat((totalRecs30 * 0.002).toFixed(1))
      },
      jobTypeBreakdown,
      dailyVolumes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/contracts/:contractAccount/notification
 * Direct — send (log) a notification to one contract account.
 * Body: { notificationType, channel, subject?, content? }
 */
router.post('/contracts/:contractAccount/notification', async (req, res) => {
  try {
    const { contractAccount } = req.params;
    const { notificationType, channel, subject, content } = req.body;

    if (!notificationType || !channel) {
      return res.status(400).json({ error: 'notificationType and channel are required' });
    }

    const db = await cds.connect.to('db');

    const account = await db.run(
      SELECT.one.from('mae.db.ContractAccounts').where({ CONTRACT_ACCOUNT: contractAccount })
    );
    if (!account) {
      return res.status(404).json({ error: `Contract account ${contractAccount} not found` });
    }

    const customerId = account.CUSTOMER_ID || account.customerId;
    const notificationId = uuidv4();
    const now = new Date().toISOString();

    await db.run(
      INSERT.into('mae.db.Notifications').entries({
        NOTIFICATION_ID:   notificationId,
        CUSTOMER_ID:       customerId || null,
        CONTRACT_ACCOUNT:  contractAccount,
        NOTIFICATION_TYPE: notificationType,
        CHANNEL:           channel,
        SUBJECT:           subject   || null,
        CONTENT:           content   || null,
        STATUS:            'SENT',
        BATCH_ID:          null,
        CREATED_ON:        now,
        SENT_ON:           now,
        ERROR_MESSAGE:     null
      })
    );

    res.status(201).json({
      success:        true,
      contractAccount,
      customerId,
      notificationId,
      message:        'Notification sent directly',
      notificationType,
      channel,
      sentOn:         now
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
