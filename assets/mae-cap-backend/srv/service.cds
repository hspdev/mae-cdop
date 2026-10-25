/**
 * MAE Autonomous Customer Data Operations Platform
 * CAP Service Definitions — OData V4 + REST
 */

namespace mae.srv;

using { mae.db } from '../db/schema';

// ─────────────────────────────────────────────────────────────────────────────
// BULK JOB SERVICE — OData V4
// ─────────────────────────────────────────────────────────────────────────────

@path: '/odata/v4/BulkJobService'
@requires: 'authenticated-user'
service BulkJobService {

  entity BatchJobs @readonly as projection on db.BatchJobs {
    BATCH_ID,
    JOB_TYPE,
    STATUS,
    CURRENT_STEP,
    TOTAL_ACCOUNTS,
    PROCESSED_ACCOUNTS,
    SUCCESS_COUNT,
    FAILED_COUNT,
    RETRY_COUNT,
    SIMULATION_MODE,
    REQUESTED_BY,
    DESCRIPTION,
    CREATED_ON,
    COMPLETED_ON,
    LAST_UPDATE,
    DURATION_SECONDS,
    THROUGHPUT_RPS
  }

  entity BatchJobFailureLogs @readonly as projection on db.BatchJobFailureLogs;

  entity Customers @readonly as projection on db.Customers;

  entity ContractAccounts @readonly as projection on db.ContractAccounts;

  entity PerformanceMetrics @readonly as projection on db.PerformanceMetrics;

  // ── Actions ─────────────────────────────────────────────────────────────────

  @requires: 'BulkJobOperator'
  action createBulkJob(
    jobType        : String,
    jobParameters  : LargeString,
    simulationMode : Boolean,
    description    : String
  ) returns {
    batchId : UUID;
    status  : String;
    message : String;
  };

  @requires: 'BulkJobOperator'
  action cancelBulkJob(batchId : UUID) returns {
    success : Boolean;
    message : String;
  };

  @requires: 'BulkJobOperator'
  action reprocessBulkJob(
    batchId         : UUID,
    onlyFailed      : Boolean,
    simulationMode  : Boolean
  ) returns {
    newBatchId : UUID;
    message    : String;
  };

  @requires: 'BulkJobAnalyst'
  function getJobSummary(batchId : UUID) returns LargeString;

  @requires: 'BulkJobAnalyst'
  function getExecutiveSummary(
    fromDate : Date,
    toDate   : Date
  ) returns LargeString;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN SERVICE — internal/admin only
// ─────────────────────────────────────────────────────────────────────────────

@path: '/odata/v4/AdminService'
@requires: 'BulkJobAdmin'
service AdminService {
  entity BatchJobs as projection on db.BatchJobs;
  entity JobTrack as projection on db.JobTrack;
  entity BatchJobFailureLogs as projection on db.BatchJobFailureLogs;
  entity PerformanceMetrics as projection on db.PerformanceMetrics;
  entity CopilotSessions @readonly as projection on db.CopilotSessions;
}

// ─────────────────────────────────────────────────────────────────────────────
// COPILOT SERVICE
// ─────────────────────────────────────────────────────────────────────────────

@path: '/odata/v4/CopilotService'
@requires: 'authenticated-user'
service CopilotService {

  entity CopilotSessions as projection on db.CopilotSessions;
  entity CopilotMessages @readonly as projection on db.CopilotMessages;

  action sendMessage(
    sessionId : UUID,
    message   : LargeString
  ) returns {
    sessionId  : UUID;
    messageId  : UUID;
    response   : LargeString;
    actions    : LargeString;  // JSON: suggested actions requiring approval
    citations  : LargeString;
  };

  action createSession() returns {
    sessionId : UUID;
  };

  action clearSession(sessionId : UUID) returns {
    success : Boolean;
  };
}
