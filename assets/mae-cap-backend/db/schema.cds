/**
 * MAE Autonomous Customer Data Operations Platform
 * CDS Schema – SQLite / SAP HANA Cloud compatible
 *
 * Assumptions:
 * - Z_ prefix denotes DUCI-custom entities
 * - All timestamps stored as UTC
 * - Chunked IN-clause SQL used for batch operations (no large OR filters)
 * - SQLite used for demo/Joule Studio; HANA Cloud for production CF
 */

namespace mae.db;

// ─────────────────────────────────────────────────────────────────────────────
// ENUMERATIONS
// ─────────────────────────────────────────────────────────────────────────────

type JobStatus : String(30) enum {
  QUEUED              = 'QUEUED';
  IN_PROGRESS         = 'IN_PROGRESS';
  RETRYING            = 'RETRYING';
  COMPLETED           = 'COMPLETED';
  PARTIALLY_COMPLETED = 'PARTIALLY_COMPLETED';
  FAILED              = 'FAILED';
  CANCELLED           = 'CANCELLED';
}

type ProcessingStep : String(40) enum {
  REQUEST_RECEIVED          = 'REQUEST_RECEIVED';
  VALIDATING_REQUEST        = 'VALIDATING_REQUEST';
  LOADING_CONTRACT_ACCOUNTS = 'LOADING_CONTRACT_ACCOUNTS';
  PROCESSING_TRANSACTION    = 'PROCESSING_TRANSACTION';
  VERIFYING_UPDATES         = 'VERIFYING_UPDATES';
  GENERATING_RESULTS        = 'GENERATING_RESULTS';
  COMPLETED                 = 'COMPLETED';
}

type JobType : String(50) enum {
  MAILING_ADDRESS_UPDATE     = 'MAILING_ADDRESS_UPDATE';
  CONTRACT_ACCOUNT_UPDATE    = 'CONTRACT_ACCOUNT_UPDATE';
  CUSTOMER_PREFERENCE_UPDATE = 'CUSTOMER_PREFERENCE_UPDATE';
  NOTIFICATION_REQUEST       = 'NOTIFICATION_REQUEST';
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE JOB ENTITIES  (Z_BATCH_JOB, Z_JOB_TRACK, Z_BATCH_JOB_FAILURE_LOGS)
// ─────────────────────────────────────────────────────────────────────────────

/** Z_BATCH_JOB – Master record for each bulk job run */
entity BatchJobs {
  key BATCH_ID           : UUID;
      JOB_TYPE           : JobType       not null;
      STATUS             : JobStatus     default 'QUEUED';
      CURRENT_STEP       : ProcessingStep default 'REQUEST_RECEIVED';
      TOTAL_ACCOUNTS     : Integer        default 0;
      PROCESSED_ACCOUNTS : Integer        default 0;
      SUCCESS_COUNT      : Integer        default 0;
      FAILED_COUNT       : Integer        default 0;
      RETRY_COUNT        : Integer        default 0;
      SIMULATION_MODE    : Boolean        default false;
      JOB_PARAMETERS     : LargeString;
      REQUESTED_BY       : String(100);
      DESCRIPTION        : String(500);
      CREATED_ON         : Timestamp;
      COMPLETED_ON       : Timestamp;
      LAST_UPDATE        : Timestamp;
      DURATION_SECONDS   : Integer;
      THROUGHPUT_RPS     : Decimal(10,2);
}

/** Z_JOB_TRACK – Per-request processing step tracker */
entity JobTrack {
  key REQUEST_ID   : UUID;
      BATCH_ID     : UUID           not null;
      CURRENT_STEP : ProcessingStep  default 'REQUEST_RECEIVED';
      STATUS       : JobStatus       default 'QUEUED';
      RETRY_COUNT  : Integer         default 0;
      LAST_ERROR   : LargeString;
      START_TIME   : Timestamp;
      LAST_UPDATE  : Timestamp;
}

/** Z_BATCH_JOB_FAILURE_LOGS – Failed record details for reprocessing */
entity BatchJobFailureLogs {
  key LOG_ID           : UUID;
      BATCH_ID         : UUID       not null;
      CONTRACT_ACCOUNT : String(20) not null;
      ERROR_MESSAGE    : LargeString;
      ERROR_CODE       : String(50);
      RETRY_ATTEMPT    : Integer    default 0;
      CREATED_ON       : Timestamp;
      RESOLVED         : Boolean    default false;
      RESOLVED_ON      : Timestamp;
      RESOLUTION_NOTE  : LargeString;
}

// ─────────────────────────────────────────────────────────────────────────────
// DUCI DEMO MASTER DATA
// ─────────────────────────────────────────────────────────────────────────────

/** Z_CUSTOMERS – DUCI Customer Master (100K demo records) */
entity Customers {
  key CUSTOMER_ID         : String(20);
      BUSINESS_PARTNER    : String(20);
      FIRST_NAME          : String(100);
      LAST_NAME           : String(100);
      FULL_NAME           : String(200);
      EMAIL               : String(255);
      PHONE               : String(30);
      CUSTOMER_SEGMENT    : String(50);
      STATUS              : String(20)  default 'ACTIVE';
      CITY                : String(100);
      STATE_CODE          : String(10);
      ZIP_CODE            : String(20);
      REGION              : String(50);
      CREATED_ON          : Timestamp;
      LAST_UPDATED        : Timestamp;
      NOTIFICATION_OPT_IN : Boolean     default true;
}

/** Z_CONTRACT_ACCOUNTS – DUCI Contract Accounts (125K demo records) */
entity ContractAccounts {
  key CONTRACT_ACCOUNT : String(20);
      CUSTOMER_ID      : String(20);
      ACCOUNT_TYPE     : String(30);
      STATUS           : String(20)  default 'ACTIVE';
      PREMISE_ID       : String(20);
      STREET_ADDRESS   : String(200);
      CITY             : String(100);
      STATE_CODE       : String(10);
      ZIP_CODE         : String(20);
      MOVE_IN_DATE     : Date;
      MOVE_OUT_DATE    : Date;
      BILLING_CLASS    : String(20);
      CREATED_ON       : Timestamp;
      LAST_UPDATED     : Timestamp;
}

/** Z_ADDRESS_HISTORY – Address change events */
entity AddressHistory {
  key HISTORY_ID         : UUID;
      CUSTOMER_ID        : String(20);
      CONTRACT_ACCOUNT   : String(20);
      OLD_STREET_ADDRESS : String(200);
      OLD_CITY           : String(100);
      OLD_STATE_CODE     : String(10);
      OLD_ZIP_CODE       : String(20);
      NEW_STREET_ADDRESS : String(200);
      NEW_CITY           : String(100);
      NEW_STATE_CODE     : String(10);
      NEW_ZIP_CODE       : String(20);
      CHANGE_DATE        : Timestamp;
      CHANGE_SOURCE      : String(50);
      VERIFIED           : Boolean    default false;
}

/** Z_CUSTOMER_PREFERENCES – Communication preferences */
entity CustomerPreferences {
  key PREFERENCE_ID      : UUID;
      CUSTOMER_ID        : String(20);
      CHANNEL            : String(30);
      PREFERENCE_TYPE    : String(50);
      OPTED_IN           : Boolean   default true;
      PREFERRED_LANGUAGE : String(10) default 'EN';
      PREFERRED_TIME     : String(20);
      LAST_UPDATED       : Timestamp;
      UPDATED_BY         : String(100);
}

/** Z_NOTIFICATIONS – Notification request log */
entity Notifications {
  key NOTIFICATION_ID   : UUID;
      CUSTOMER_ID       : String(20);
      CONTRACT_ACCOUNT  : String(20);
      NOTIFICATION_TYPE : String(50);
      CHANNEL           : String(30);
      SUBJECT           : String(200);
      CONTENT           : LargeString;
      STATUS            : String(20)  default 'PENDING';
      BATCH_ID          : UUID;
      CREATED_ON        : Timestamp;
      SENT_ON           : Timestamp;
      ERROR_MESSAGE     : String(500);
}

/** Z_PERFORMANCE_METRICS – Job performance tracking */
entity PerformanceMetrics {
  key METRIC_ID    : UUID;
      BATCH_ID     : UUID         not null;
      METRIC_TYPE  : String(50);
      METRIC_VALUE : Decimal(20,4);
      UNIT         : String(20);
      RECORDED_AT  : Timestamp;
      RECORD_COUNT : Integer;
}

/** Z_COPILOT_SESSIONS – Operations Copilot conversation history */
entity CopilotSessions {
  key SESSION_ID  : UUID;
      USER_ID     : String(100);
      CREATED_ON  : Timestamp;
      LAST_ACTIVE : Timestamp;
      STATUS      : String(20)  default 'ACTIVE';
      CONTEXT     : LargeString;
      BATCH_IDS   : LargeString;
}

/** Z_COPILOT_MESSAGES – Individual copilot message turns */
entity CopilotMessages {
  key MESSAGE_ID : UUID;
      SESSION_ID : UUID         not null;
      ROLE       : String(20);
      CONTENT    : LargeString;
      CREATED_ON : Timestamp;
      METADATA   : LargeString;
}
