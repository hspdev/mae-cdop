/**
 * MAE — Exposed CDS Service Data Model
 * Projections and views over the physical Z_ tables
 */

namespace mae.model;

using { mae.db } from './schema';

// ─────────────────────────────────────────────────────────────────────────────
// PROJECTIONS — public-facing entities for OData V4 service
// ─────────────────────────────────────────────────────────────────────────────

entity BatchJob as projection on db.BatchJobs {
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
  THROUGHPUT_RPS,
  // computed progress percentage
  case
    when TOTAL_ACCOUNTS > 0
    then (PROCESSED_ACCOUNTS * 100) / TOTAL_ACCOUNTS
    else 0
  end as PROGRESS_PCT : Integer
}

entity JobFailureLog as projection on db.BatchJobFailureLogs {
  LOG_ID,
  BATCH_ID,
  CONTRACT_ACCOUNT,
  ERROR_MESSAGE,
  ERROR_CODE,
  RETRY_ATTEMPT,
  CREATED_ON,
  RESOLVED,
  RESOLVED_ON,
  RESOLUTION_NOTE
}

entity CustomerView as projection on db.Customers {
  CUSTOMER_ID,
  FULL_NAME,
  EMAIL,
  PHONE,
  CUSTOMER_SEGMENT,
  STATUS,
  CITY,
  STATE_CODE,
  ZIP_CODE,
  REGION
}

entity ContractAccountView as projection on db.ContractAccounts {
  CONTRACT_ACCOUNT,
  CUSTOMER_ID,
  ACCOUNT_TYPE,
  STATUS,
  STREET_ADDRESS,
  CITY,
  STATE_CODE,
  ZIP_CODE,
  BILLING_CLASS
}
