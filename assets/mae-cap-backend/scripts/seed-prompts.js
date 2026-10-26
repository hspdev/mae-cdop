/**
 * DUCI Prompt Library Seed
 *
 * Seeds 105 production-ready AI prompts into the PromptLibrary table.
 * Organized across 15 categories, 7 prompts each.
 * Idempotent — checks for existing prompts before inserting.
 *
 * Categories:
 *   CDM  Customer Data Management        (CDM-001 … CDM-007)
 *   CAM  Contract Account Management     (CAM-001 … CAM-007)
 *   CPR  Customer Preferences            (CPR-001 … CPR-007)
 *   NOT  Notification Operations         (NOT-001 … NOT-007)
 *   BPR  Bulk Processing                 (BPR-001 … BPR-007)
 *   JMN  Job Monitoring                  (JMN-001 … JMN-007)
 *   FAL  Failure Analysis                (FAL-001 … FAL-007)
 *   EXR  Executive Reporting             (EXR-001 … EXR-007)
 *   AIC  AI Copilot Operations           (AIC-001 … AIC-007)
 *   SAP  SAP Analytics                   (SAP-001 … SAP-007)
 *   OPT  Process Optimization            (OPT-001 … OPT-007)
 *   CMP  Compliance                      (CMP-001 … CMP-007)
 *   CSP  Customer Support                (CSP-001 … CSP-007)
 *   OAN  Operational Analytics           (OAN-001 … OAN-007)
 *   AIP  AI Performance                  (AIP-001 … AIP-007)
 *
 * Usage (standalone):
 *   node scripts/seed-prompts.js
 *
 * Usage (programmatic):
 *   const seedPrompts = require('./scripts/seed-prompts');
 *   await seedPrompts(db);   // pass an open CDS db connection
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

// ── Prompt definitions ────────────────────────────────────────────────────────

const SYSTEM_CONTEXT =
  'You are an AI assistant for DUCI utility company operations platform. ' +
  'Provide specific, actionable responses based on actual system data. ' +
  'Always cite data sources and recommend concrete next steps.';

const PROMPTS = [

  // ── 1. Customer Data Management ─────────────────────────────────────────────

  {
    id: 'CDM-001',
    cat: 'Customer Data Management',
    title: 'Allentown Address Change Analysis',
    recommended: true,
    persona: 'Data Analyst',
    jobType: 'MAILING_ADDRESS_UPDATE',
    tags: 'address,data-quality,allentown,analysis',
    text: 'Analyze the address change history for all Allentown customers who moved in the last 90 days. Identify any patterns suggesting data quality issues such as missing ZIP codes, incomplete street addresses, or invalid state codes. Provide a summary with the count of affected records and recommended remediation steps.'
  },
  {
    id: 'CDM-002',
    cat: 'Customer Data Management',
    title: 'Duplicate Customer Record Detection',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'duplicates,data-quality,customer-master',
    text: 'Identify potential duplicate customer records in the DUCI customer master by analyzing shared email addresses, phone numbers, or Business Partner IDs. For each suspected duplicate pair, provide the customer IDs, the conflicting field values, and a recommendation for which record should be retained as the master.'
  },
  {
    id: 'CDM-003',
    cat: 'Customer Data Management',
    title: 'Customer Segment Distribution Report',
    recommended: false,
    persona: 'Operations Manager',
    jobType: null,
    tags: 'segments,residential,commercial,industrial,reporting',
    text: 'Generate a distribution report of customer segments (RESIDENTIAL, COMMERCIAL, INDUSTRIAL) across all active contract accounts. Include the count per segment, the percentage of total, the average number of contract accounts per customer segment, and identify any segment showing unusual growth or decline compared to the prior 30-day period.'
  },
  {
    id: 'CDM-004',
    cat: 'Customer Data Management',
    title: 'Inactive Customer Identification',
    recommended: false,
    persona: 'Operations Manager',
    jobType: null,
    tags: 'inactive,status,cleanup,accounts',
    text: 'Identify all customers with INACTIVE status who have had no billing activity, address changes, or service requests in the last 180 days. Categorize them by segment and region, estimate the data cleanup effort required, and recommend whether to archive or permanently remove each category of inactive records.'
  },
  {
    id: 'CDM-005',
    cat: 'Customer Data Management',
    title: 'Email Validation Batch Review',
    recommended: false,
    persona: 'Data Analyst',
    jobType: 'NOTIFICATION_REQUEST',
    tags: 'email,validation,contact-data,notification',
    text: 'Review all customer records where the email address field is either blank, in an invalid format, or has a known bad domain. Provide a count by error type, identify which customers have an alternative contact method available, and generate a prioritized list for data correction starting with RESIDENTIAL customers who have opted into email notifications.'
  },
  {
    id: 'CDM-006',
    cat: 'Customer Data Management',
    title: 'New Mover Address Update Campaign',
    recommended: true,
    persona: 'Operations Manager',
    jobType: 'MAILING_ADDRESS_UPDATE',
    tags: 'mover,address-update,campaign,allentown',
    text: 'Prepare a bulk mailing address update campaign for customers in the Allentown service territory who have submitted address change requests through the customer portal in the last 60 days but whose contract accounts have not yet been updated. Identify the accounts, validate the new addresses against USPS standards, and recommend the processing order based on account type priority.'
  },
  {
    id: 'CDM-007',
    cat: 'Customer Data Management',
    title: 'Data Completeness Scorecard',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'completeness,scorecard,data-governance,quality-metrics',
    text: 'Generate a data completeness scorecard for the customer master data. For each mandatory field (CUSTOMER_ID, EMAIL, PHONE, CITY, STATE_CODE, ZIP_CODE, NOTIFICATION_OPT_IN), calculate the percentage of records with valid values. Highlight fields below 95% completeness and recommend specific data collection campaigns to close the gaps.'
  },

  // ── 2. Contract Account Management ──────────────────────────────────────────

  {
    id: 'CAM-001',
    cat: 'Contract Account Management',
    title: 'Long-Term Inactive Account Review',
    recommended: true,
    persona: 'Operations Manager',
    jobType: 'CONTRACT_ACCOUNT_UPDATE',
    tags: 'inactive,account-review,status,billing',
    text: 'Review all INACTIVE contract accounts in the RESIDENTIAL segment that have been inactive for more than 180 days. Determine if these accounts should be closed, reactivated, or escalated. Provide a recommendation for each account category with the business justification and estimated revenue impact of each option.'
  },
  {
    id: 'CAM-002',
    cat: 'Contract Account Management',
    title: 'Billing Class Migration Analysis',
    recommended: false,
    persona: 'Data Analyst',
    jobType: 'CONTRACT_ACCOUNT_UPDATE',
    tags: 'billing-class,migration,residential,commercial',
    text: 'Analyze contract accounts where the BILLING_CLASS does not match the customer segment. Identify accounts where a RESIDENTIAL customer has COMMERCIAL billing or vice versa, calculate the financial discrepancy for each mismatched account, and prepare a correction plan with estimated adjustment amounts and the bulk job parameters required to apply the corrections.'
  },
  {
    id: 'CAM-003',
    cat: 'Contract Account Management',
    title: 'Account Status Consistency Check',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'status,consistency,active,inactive,data-quality',
    text: 'Verify that all ACTIVE contract accounts have valid MOVE_IN_DATE values, no MOVE_OUT_DATE in the past, and at least one associated customer record with ACTIVE status. Identify any accounts violating these consistency rules, classify the issue severity, and recommend automated versus manual correction approaches for each violation type.'
  },
  {
    id: 'CAM-004',
    cat: 'Contract Account Management',
    title: 'New Account Onboarding Verification',
    recommended: false,
    persona: 'Operations Manager',
    jobType: null,
    tags: 'onboarding,new-accounts,verification,setup',
    text: 'Review all contract accounts created in the last 30 days to verify they have completed onboarding: valid premise ID assigned, initial billing class set, customer preferences configured, and at least one contact method verified. Report the percentage with complete onboarding and identify the most common missing setup steps to improve the new account creation workflow.'
  },
  {
    id: 'CAM-005',
    cat: 'Contract Account Management',
    title: 'Multi-Account Customer Analysis',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'multi-account,portfolio,customer-value,commercial',
    text: 'Identify customers who hold more than 3 active contract accounts and analyze their account portfolio composition. For each multi-account customer, report the total number of accounts, mix of account types, geographic distribution of premises, and billing class breakdown. Flag any customers whose multi-account status suggests commercial activity being billed at residential rates.'
  },
  {
    id: 'CAM-006',
    cat: 'Contract Account Management',
    title: 'Seasonal Account Reactivation Forecast',
    recommended: false,
    persona: 'Executive',
    jobType: 'CONTRACT_ACCOUNT_UPDATE',
    tags: 'seasonal,reactivation,forecast,planning',
    text: 'Analyze historical account activation patterns for the past 3 years to identify seasonal trends in contract account reactivation. Forecast the expected volume of reactivation requests for the next 90 days, estimate the staffing and processing capacity required to handle the volume within 24-hour SLA, and recommend any pre-processing steps to expedite high-volume periods.'
  },
  {
    id: 'CAM-007',
    cat: 'Contract Account Management',
    title: 'Account Merge Candidate Identification',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'merge,consolidation,duplicate-accounts,cleanup',
    text: 'Identify contract accounts that are candidates for consolidation because they share the same premise address, customer ID, and billing class. For each merge candidate group, provide the account IDs, the date ranges involved, the combined billing history, and a risk assessment for merging them into a single active account.'
  },

  // ── 3. Customer Preferences ──────────────────────────────────────────────────

  {
    id: 'CPR-001',
    cat: 'Customer Preferences',
    title: 'Email Opt-In Gap Analysis',
    recommended: true,
    persona: 'Operations Manager',
    jobType: null,
    tags: 'opt-in,email,preference,gap-analysis',
    text: 'Identify all customers who have EMAIL as their communication channel but have not received any notifications in the last 60 days. Determine if their email addresses are valid and if their opt-in status is current. Recommend which accounts need preference data correction and estimate the customer engagement improvement from fixing these records.'
  },
  {
    id: 'CPR-002',
    cat: 'Customer Preferences',
    title: 'Multi-Channel Preference Migration',
    recommended: false,
    persona: 'Operations Manager',
    jobType: 'CUSTOMER_PREFERENCE_UPDATE',
    tags: 'multi-channel,migration,SMS,email,preferences',
    text: 'Prepare a bulk migration plan for customers currently set to MAIL channel who have provided valid mobile phone numbers. Estimate the cost savings from shifting to SMS notifications, identify customers who have explicitly opted out of digital channels, and design a consent-based migration workflow that complies with TCPA regulations.'
  },
  {
    id: 'CPR-003',
    cat: 'Customer Preferences',
    title: 'Language Preference Distribution',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'language,localization,Spanish,accessibility',
    text: 'Analyze the distribution of PREFERRED_LANGUAGE settings across all active customers. Identify segments with high Spanish-speaking populations that may be receiving English-only communications. Recommend specific customer groups for Spanish-language notification templates and estimate the customer satisfaction impact of language-matched communications.'
  },
  {
    id: 'CPR-004',
    cat: 'Customer Preferences',
    title: 'Preference Expiry and Refresh Campaign',
    recommended: false,
    persona: 'Operations Manager',
    jobType: 'CUSTOMER_PREFERENCE_UPDATE',
    tags: 'refresh,expiry,consent,renewal,compliance',
    text: 'Identify all customer preference records that were last updated more than 24 months ago and have not been confirmed by the customer since then. Design a preference refresh campaign that prompts customers to reconfirm or update their communication preferences, targeting the highest-value customers first. Estimate the expected opt-in rate improvement and the impact on deliverability metrics.'
  },
  {
    id: 'CPR-005',
    cat: 'Customer Preferences',
    title: 'Notification Time Window Optimization',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'timing,optimization,engagement,preferred-time',
    text: 'Analyze the relationship between the PREFERRED_TIME field and notification open rates for email and SMS channels. Identify time windows with the highest engagement rates by customer segment. Recommend an updated set of preferred time window options that would optimize open rates and recommend which customer groups should be proactively migrated to higher-performing time slots.'
  },
  {
    id: 'CPR-006',
    cat: 'Customer Preferences',
    title: 'Opt-Out Trend Analysis',
    recommended: false,
    persona: 'Executive',
    jobType: null,
    tags: 'opt-out,churn,trends,compliance,retention',
    text: 'Analyze the trend in notification opt-outs over the last 6 months by customer segment, communication channel, and notification type. Identify which notification types are driving the highest opt-out rates, estimate the revenue impact of reduced notification delivery, and recommend 3 specific changes to notification content or frequency that would reverse the opt-out trend.'
  },
  {
    id: 'CPR-007',
    cat: 'Customer Preferences',
    title: 'New Customer Preference Setup Audit',
    recommended: false,
    persona: 'Operations Manager',
    jobType: 'CUSTOMER_PREFERENCE_UPDATE',
    tags: 'new-customer,onboarding,preferences,setup-audit',
    text: 'Audit all customers created in the last 90 days to verify they have complete preference records: at least one communication channel defined, opt-in status confirmed, language preference set, and preferred time window selected. Identify customers missing any preference field and generate a bulk update task to apply default preferences based on their customer segment.'
  },

  // ── 4. Notification Operations ───────────────────────────────────────────────

  {
    id: 'NOT-001',
    cat: 'Notification Operations',
    title: 'Allentown Address Confirmation Campaign',
    recommended: true,
    persona: 'Operations Manager',
    jobType: 'NOTIFICATION_REQUEST',
    tags: 'confirmation,address,allentown,campaign',
    text: 'Prepare a bulk ADDRESS_CONFIRMATION notification campaign for all customers affected by the Allentown address update campaign. The notification should confirm the new address, provide a reference number, and include a customer service contact. Estimate delivery success rates based on current opt-in data and recommend fallback channels for customers without email.'
  },
  {
    id: 'NOT-002',
    cat: 'Notification Operations',
    title: 'Failed Notification Retry Analysis',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'failed,retry,deliverability,bounce-analysis',
    text: 'Analyze all notifications with FAILED status from the last 30 days. Categorize failures by error type (invalid email, SMS not deliverable, mail returned), identify the root cause distribution, and design a retry strategy for each failure category. Estimate the number of customers who can be reached through alternative channels if primary channel retry fails.'
  },
  {
    id: 'NOT-003',
    cat: 'Notification Operations',
    title: 'Service Disruption Alert Blast',
    recommended: false,
    persona: 'Operations Manager',
    jobType: 'NOTIFICATION_REQUEST',
    tags: 'service-disruption,alert,emergency,mass-notification',
    text: 'Prepare an emergency service disruption notification for all active accounts in ZIP codes 18101-18103. The notification must go through the fastest available channel for each customer (SMS first, then email, then mail), include the expected restoration time, provide a customer service hotline number, and be sent within 30 minutes of approval. Identify any accounts with no digital contact method that require paper delivery.'
  },
  {
    id: 'NOT-004',
    cat: 'Notification Operations',
    title: 'Billing Cycle Reminder Optimization',
    recommended: false,
    persona: 'Operations Manager',
    jobType: null,
    tags: 'billing,reminder,timing,payment,optimization',
    text: 'Analyze the relationship between billing reminder timing and on-time payment rates. Compare current practice (5 days before due date) against alternative windows (3, 7, 10 days prior). Recommend an optimized reminder schedule by customer segment that would maximize on-time payments while minimizing notification fatigue. Estimate the reduction in late payment fees from the optimized schedule.'
  },
  {
    id: 'NOT-005',
    cat: 'Notification Operations',
    title: 'Notification Volume Forecast',
    recommended: false,
    persona: 'Executive',
    jobType: null,
    tags: 'forecast,volume,capacity,planning',
    text: 'Forecast the notification volume for the next 90 days based on scheduled billing cycles, historical address update campaigns, and seasonal service disruption patterns. Break down the forecast by channel (email, SMS, mail) and notification type. Identify any periods where volume exceeds current system capacity and recommend pre-authorization or scheduling changes to avoid delivery bottlenecks.'
  },
  {
    id: 'NOT-006',
    cat: 'Notification Operations',
    title: 'Customer Response Rate Analysis',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'response-rate,engagement,CTA,effectiveness',
    text: 'Analyze customer response rates for notifications that include a call-to-action (such as confirming an address change or updating a preference). Compare response rates by channel, customer segment, time of day sent, and notification type. Identify the top 3 factors associated with above-average response rates and recommend changes to notification templates to improve overall engagement.'
  },
  {
    id: 'NOT-007',
    cat: 'Notification Operations',
    title: 'Undelivered Mail Follow-Up Plan',
    recommended: false,
    persona: 'Operations Manager',
    jobType: 'NOTIFICATION_REQUEST',
    tags: 'undelivered,returned-mail,NCOA,address-update',
    text: 'Identify all customers with MAIL as their primary channel who have had notifications returned as undeliverable in the last 60 days. For each affected account, check if there is a more recent address in the customer portal or address history table. Generate a list of accounts requiring NCOA (National Change of Address) lookup and prepare an alternative-channel outreach for customers with valid digital contact methods.'
  },

  // ── 5. Bulk Processing ───────────────────────────────────────────────────────

  {
    id: 'BPR-001',
    cat: 'Bulk Processing',
    title: 'Job Performance Benchmark Analysis',
    recommended: true,
    persona: 'Operations Manager',
    jobType: null,
    tags: 'performance,benchmark,throughput,optimization',
    text: 'Analyze the performance of the last 10 MAILING_ADDRESS_UPDATE bulk jobs. Identify which jobs had the highest failure rates, what the common error codes were, and whether retry processing successfully recovered failed records. Recommend optimal batch chunk size based on throughput data and identify any time-of-day patterns affecting performance.'
  },
  {
    id: 'BPR-002',
    cat: 'Bulk Processing',
    title: 'Concurrent Job Risk Assessment',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'concurrency,risk,conflicts,locking,overlap',
    text: 'Assess the risk of running multiple bulk jobs concurrently for the same contract accounts. Identify any current jobs that overlap in their target account sets, estimate the likelihood of record locking conflicts, and recommend a job scheduling strategy that minimizes contention while maximizing overall processing throughput during peak business hours.'
  },
  {
    id: 'BPR-003',
    cat: 'Bulk Processing',
    title: 'Large-Scale Job Capacity Planning',
    recommended: false,
    persona: 'Executive',
    jobType: null,
    tags: 'capacity,planning,scale,large-batch,SLA',
    text: 'Estimate the system capacity required to process a MAILING_ADDRESS_UPDATE job for all 125,000 contract accounts within a 4-hour maintenance window. Calculate the required chunk size, estimated duration per chunk, total job duration, and memory footprint. Identify any bottlenecks that would prevent meeting the 4-hour window and recommend infrastructure or configuration changes to address them.'
  },
  {
    id: 'BPR-004',
    cat: 'Bulk Processing',
    title: 'Simulation Mode Validation Report',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'simulation,dry-run,validation,pre-production',
    text: 'Review the results of the last 5 simulation mode job runs and compare predicted outcomes against actual outcomes when the jobs were later run in production mode. Calculate the accuracy of simulation mode predictions for success rate, record count, and estimated duration. Identify any cases where simulation results were misleading and recommend improvements to the simulation logic.'
  },
  {
    id: 'BPR-005',
    cat: 'Bulk Processing',
    title: 'Failed Job Reprocessing Strategy',
    recommended: false,
    persona: 'Operations Manager',
    jobType: null,
    tags: 'reprocessing,retry,recovery,failed-jobs',
    text: 'Design a reprocessing strategy for PARTIALLY_COMPLETED jobs where 5-20% of records failed. Evaluate whether to retry all failed records in a single new job or to split them into smaller batches by failure category. Estimate the expected recovery rate using the current retry framework and recommend any preprocessing steps (such as data cleanup) that should be completed before initiating reprocessing.'
  },
  {
    id: 'BPR-006',
    cat: 'Bulk Processing',
    title: 'End-of-Month Processing Schedule',
    recommended: false,
    persona: 'Operations Manager',
    jobType: null,
    tags: 'schedule,end-of-month,billing,processing-window',
    text: 'Design the end-of-month bulk processing schedule for all four job types (MAILING_ADDRESS_UPDATE, CONTRACT_ACCOUNT_UPDATE, CUSTOMER_PREFERENCE_UPDATE, NOTIFICATION_REQUEST). Identify any sequencing dependencies, estimate total processing time for the combined workload, recommend processing windows that avoid peak billing system load, and define rollback procedures if any job fails during the scheduled window.'
  },
  {
    id: 'BPR-007',
    cat: 'Bulk Processing',
    title: 'Retry Framework Effectiveness Report',
    recommended: true,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'retry,recovery,exponential-backoff,effectiveness',
    text: 'Analyze the effectiveness of the exponential backoff retry framework across all job types for the last 90 days. Calculate the recovery rate per retry attempt, the average number of retries before final success or failure, and the percentage of records that could not be recovered even after maximum retries. Identify the most common transient versus permanent failure types and recommend retry parameter adjustments.'
  },

  // ── 6. Job Monitoring ────────────────────────────────────────────────────────

  {
    id: 'JMN-001',
    cat: 'Job Monitoring',
    title: 'Real-Time Queue Status Overview',
    recommended: true,
    persona: 'Operations Manager',
    jobType: null,
    tags: 'queue,status,real-time,monitoring',
    text: 'Provide a real-time status overview of all jobs currently in the processing queue. For each job, report the job type, current processing step, percentage complete, elapsed time, estimated time to completion, and any warning signs (such as throughput below expected baseline or failure rate above 2%). Flag any jobs requiring immediate operator attention.'
  },
  {
    id: 'JMN-002',
    cat: 'Job Monitoring',
    title: 'SLA Compliance Monitoring',
    recommended: false,
    persona: 'Executive',
    jobType: null,
    tags: 'SLA,compliance,turnaround,breach-risk',
    text: 'Monitor all active and recently completed jobs against their SLA commitments. For MAILING_ADDRESS_UPDATE jobs, the SLA is 99% of records processed within 30 minutes of job start. Identify any jobs at risk of breaching SLA based on current throughput, flag jobs already in breach, and recommend immediate actions to recover SLA compliance.'
  },
  {
    id: 'JMN-003',
    cat: 'Job Monitoring',
    title: 'Throughput Anomaly Detection',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'anomaly,throughput,performance,detection',
    text: 'Analyze the processing throughput of all jobs in the last 7 days and identify any anomalies where throughput dropped more than 30% below the baseline for that job type. For each anomaly, identify the time range, the severity of the throughput drop, any correlation with other system events (such as concurrent jobs or scheduled maintenance), and recommend root cause investigation steps.'
  },
  {
    id: 'JMN-004',
    cat: 'Job Monitoring',
    title: 'Job Step Duration Analysis',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'step-duration,bottleneck,processing-steps,pipeline',
    text: 'Analyze the time spent in each processing step (REQUEST_RECEIVED, VALIDATING_REQUEST, LOADING_CONTRACT_ACCOUNTS, PROCESSING_TRANSACTION, VERIFYING_UPDATES, GENERATING_RESULTS) across all jobs in the last 30 days. Identify which step consumes the most time on average and per job type, and recommend targeted optimizations for the slowest steps.'
  },
  {
    id: 'JMN-005',
    cat: 'Job Monitoring',
    title: 'Daily Operations Health Check',
    recommended: false,
    persona: 'Operations Manager',
    jobType: null,
    tags: 'health-check,daily,operations,status-summary',
    text: 'Generate a daily operations health check report for the MAE bulk processing platform. Include: jobs completed in the last 24 hours (count, success rate), jobs currently in progress, jobs in queue, average throughput vs. yesterday, total records processed, failure rate vs. 7-day average, and any open alerts requiring operator action. Format as an executive briefing suitable for the morning standup.'
  },
  {
    id: 'JMN-006',
    cat: 'Job Monitoring',
    title: 'Long-Running Job Intervention Plan',
    recommended: false,
    persona: 'Operations Manager',
    jobType: null,
    tags: 'long-running,stuck,timeout,intervention',
    text: 'Identify any jobs that have been in IN_PROGRESS status for more than 2 hours without completing. For each long-running job, report the elapsed time, the current processing step, the last recorded throughput, and the expected remaining time. Recommend whether to cancel and restart, pause and investigate, or allow to continue, based on current progress and business urgency.'
  },
  {
    id: 'JMN-007',
    cat: 'Job Monitoring',
    title: 'Cancelled Job Root Cause Review',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'cancelled,root-cause,investigation,patterns',
    text: 'Review all CANCELLED jobs from the last 30 days and determine whether cancellations were operator-initiated, system-triggered, or due to timeout. For operator-initiated cancellations, identify the most common reasons given and assess whether any could have been avoided with better pre-job validation. Recommend changes to the job creation workflow that would reduce unnecessary cancellations.'
  },

  // ── 7. Failure Analysis ──────────────────────────────────────────────────────

  {
    id: 'FAL-001',
    cat: 'Failure Analysis',
    title: 'Contract Account Not Found Failures',
    recommended: true,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'CA-NOT-FOUND,failures,validation,root-cause',
    text: 'Analyze all CONTRACT_ACCOUNT_NOT_FOUND failures from the last 30 days. Determine what percentage were due to accounts deactivated between job creation and processing, what percentage were genuine data entry errors, and what percentage were caused by timing conflicts with other system updates. Recommend a pre-processing validation step that would eliminate preventable failures of this type.'
  },
  {
    id: 'FAL-002',
    cat: 'Failure Analysis',
    title: 'Address Validation Failure Pattern',
    recommended: false,
    persona: 'Data Analyst',
    jobType: 'MAILING_ADDRESS_UPDATE',
    tags: 'ADDR-VALIDATE,address,USPS,validation-failures',
    text: 'Examine all ADDR_VALIDATE failures from MAILING_ADDRESS_UPDATE jobs in the last 60 days. Categorize failures by error subtype (invalid ZIP, non-deliverable street, PO Box restrictions, etc.), identify the geographic distribution of failures, and determine if certain source data feeds produce disproportionate validation failures. Recommend pre-processing address standardization rules that would prevent the highest-volume failure types.'
  },
  {
    id: 'FAL-003',
    cat: 'Failure Analysis',
    title: 'Retry Success Rate by Error Category',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'retry,success-rate,error-categories,transient',
    text: 'Categorize all failure log entries from the last 90 days by error code and analyze the retry success rate for each category. Identify which error types are truly transient (high retry success rate) versus permanent (zero retry success rate). Recommend adjusting the retry framework to skip retry attempts for permanently-failing error types and focus retry resources on transient failures.'
  },
  {
    id: 'FAL-004',
    cat: 'Failure Analysis',
    title: 'Failure Volume Trend Analysis',
    recommended: false,
    persona: 'Executive',
    jobType: null,
    tags: 'trends,volume,failure-rate,quarterly',
    text: 'Analyze the trend in bulk processing failure volumes over the last 3 months. Calculate the week-over-week change in failure rates for each job type, identify any job types showing a worsening trend, and correlate failure spikes with specific data sources, system updates, or operational changes. Provide an executive summary with a forecast for failure volumes in the next 30 days if current trends continue.'
  },
  {
    id: 'FAL-005',
    cat: 'Failure Analysis',
    title: 'Unresolved Failure Aging Report',
    recommended: true,
    persona: 'Operations Manager',
    jobType: null,
    tags: 'unresolved,aging,backlog,remediation',
    text: 'Generate an aging report for all failure log entries where RESOLVED is false. Categorize unresolved failures by age (0-7 days, 8-30 days, 31-90 days, 90+ days), job type, and error code. Identify the oldest unresolved failures that likely represent data quality issues requiring manual intervention, and estimate the remediation effort required to clear the backlog within 30 days.'
  },
  {
    id: 'FAL-006',
    cat: 'Failure Analysis',
    title: 'Failure Impact Customer Communication',
    recommended: false,
    persona: 'Operations Manager',
    jobType: null,
    tags: 'customer-impact,failure,communication,SLA',
    text: 'Identify customers whose records failed during bulk processing and who have not been notified about the delay in their account update. For each affected customer, report the original job date, the failure reason, the current status of their record, and recommend whether to send an automated delay notification or escalate to customer service for manual contact.'
  },
  {
    id: 'FAL-007',
    cat: 'Failure Analysis',
    title: 'AI-Assisted Failure Classification',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'AI-classification,failure,pattern-matching,ML',
    text: 'Use pattern analysis to classify ambiguous failure log entries that do not match any standard error code. For each unclassified failure, extract the error message text, identify the closest matching known failure pattern, assign a confidence score to the classification, and recommend whether the failure should be treated as transient or permanent. Generate a report of newly identified failure patterns that should be added to the standard error code catalog.'
  },

  // ── 8. Executive Reporting ───────────────────────────────────────────────────

  {
    id: 'EXR-001',
    cat: 'Executive Reporting',
    title: 'Monthly Operations Executive Summary',
    recommended: true,
    persona: 'Executive',
    jobType: null,
    tags: 'monthly,executive-summary,KPIs,operations',
    text: 'Generate a monthly executive summary for the MAE bulk processing platform. Include total records processed, overall success rate, estimated hours saved versus manual processing, AI-assisted recovery count, cost avoidance estimate, top 3 operational achievements, and top 3 risks requiring executive attention. Format for a C-suite audience with no technical jargon.'
  },
  {
    id: 'EXR-002',
    cat: 'Executive Reporting',
    title: 'Year-Over-Year Processing Volume Comparison',
    recommended: false,
    persona: 'Executive',
    jobType: null,
    tags: 'YoY,volume,comparison,growth,trend',
    text: 'Compare bulk processing volumes for the current quarter against the same quarter last year. Calculate the year-over-year growth rate in total records processed, success rate improvements, cost efficiency gains, and headcount equivalent savings. Identify the business drivers behind volume changes and project the expected processing volumes for the next two quarters.'
  },
  {
    id: 'EXR-003',
    cat: 'Executive Reporting',
    title: 'ROI Dashboard for AI-Assisted Operations',
    recommended: true,
    persona: 'Executive',
    jobType: null,
    tags: 'ROI,AI,cost-savings,business-value',
    text: 'Calculate the return on investment for the DUCI AI-assisted bulk operations platform. Include direct cost savings from reduced manual processing, cost avoidance from error prevention, time savings converted to FTE equivalents, customer satisfaction improvements from faster processing, and compliance risk reduction. Present the total ROI as both a dollar amount and a percentage return on technology investment.'
  },
  {
    id: 'EXR-004',
    cat: 'Executive Reporting',
    title: 'SLA Performance Dashboard',
    recommended: false,
    persona: 'Executive',
    jobType: null,
    tags: 'SLA,performance,compliance,dashboard',
    text: 'Generate an SLA performance dashboard for the last quarter. For each job type, report the SLA target (99% success rate, 30-minute completion for standard batches), actual performance against target, number of SLA breaches, root causes of breaches, and remediation actions taken. Include a traffic-light status indicator for each job type and a trend arrow showing quarter-over-quarter improvement or degradation.'
  },
  {
    id: 'EXR-005',
    cat: 'Executive Reporting',
    title: 'Customer Impact Report',
    recommended: false,
    persona: 'Executive',
    jobType: null,
    tags: 'customer-impact,records-updated,satisfaction,business-value',
    text: 'Quantify the customer impact of bulk data processing operations. Calculate the total number of unique customers affected by address updates, preference changes, and notification campaigns. Estimate the improvement in data accuracy resulting from bulk operations, the reduction in returned mail and failed notifications, and the estimated improvement in customer satisfaction scores from more accurate and timely communications.'
  },
  {
    id: 'EXR-006',
    cat: 'Executive Reporting',
    title: 'Technology Roadmap Alignment Review',
    recommended: false,
    persona: 'Executive',
    jobType: null,
    tags: 'roadmap,alignment,capabilities,strategic-planning',
    text: 'Review current MAE platform capabilities against the 12-month technology roadmap. Identify which roadmap milestones have been completed ahead of schedule, which are on track, and which are at risk. For at-risk milestones, provide a brief risk assessment and recommended mitigation strategy. Conclude with the top 3 strategic priorities for the next quarter.'
  },
  {
    id: 'EXR-007',
    cat: 'Executive Reporting',
    title: 'Board-Ready Operations Briefing',
    recommended: false,
    persona: 'Executive',
    jobType: null,
    tags: 'board,briefing,operations,compliance,strategic',
    text: 'Prepare a board-ready operations briefing for the MAE bulk processing platform. Cover: total records processed this fiscal year, cumulative cost savings and efficiency gains, customer data quality improvements, regulatory compliance status (GDPR, CCPA), technology modernization progress, and the strategic value of autonomous data operations. Limit to 5 bullet points per section, each supporting a clear business outcome.'
  },

  // ── 9. AI Copilot Operations ─────────────────────────────────────────────────

  {
    id: 'AIC-001',
    cat: 'AI Copilot Operations',
    title: 'Job Creation Copilot Assistant',
    recommended: true,
    persona: 'Operations Manager',
    jobType: 'MAILING_ADDRESS_UPDATE',
    tags: 'copilot,job-creation,assistant,guided',
    text: 'Guide me through creating a MAILING_ADDRESS_UPDATE job for Allentown customers. Based on current data in the system, tell me how many customers are eligible, what the expected processing time will be, what parameters I should use (city, daysBack, addressSource), and whether to run in simulation mode first. Confirm when you have recommended parameters before I proceed.'
  },
  {
    id: 'AIC-002',
    cat: 'AI Copilot Operations',
    title: 'Failure Triage Assistance',
    recommended: true,
    persona: 'Operations Manager',
    jobType: null,
    tags: 'copilot,triage,failure,diagnosis',
    text: 'A bulk job has completed with a 15% failure rate. Help me triage the failures. Tell me the most likely root causes based on the error codes in the failure log, which failures are candidates for automated retry versus manual intervention, and in what order I should address them to restore the highest number of customer records in the shortest time.'
  },
  {
    id: 'AIC-003',
    cat: 'AI Copilot Operations',
    title: 'Executive Report Copilot Generator',
    recommended: false,
    persona: 'Executive',
    jobType: null,
    tags: 'copilot,executive-report,auto-generate',
    text: 'Generate an executive briefing on the current state of bulk operations. Use the most recent job data to populate: jobs completed today, overall success rate, records processed, estimated hours saved, and any open issues requiring executive attention. Format as a 5-bullet briefing suitable for a senior leadership standup.'
  },
  {
    id: 'AIC-004',
    cat: 'AI Copilot Operations',
    title: 'Optimal Job Scheduling Recommendation',
    recommended: false,
    persona: 'Operations Manager',
    jobType: null,
    tags: 'copilot,scheduling,optimal-timing,workload',
    text: 'Based on current queue depth, historical processing times for each job type, and scheduled maintenance windows, recommend the optimal time to schedule the next MAILING_ADDRESS_UPDATE job for maximum throughput. Consider current system load, time zones for the affected customers, and any interdependencies with other scheduled jobs.'
  },
  {
    id: 'AIC-005',
    cat: 'AI Copilot Operations',
    title: 'Data Quality Alert Interpreter',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'copilot,alerts,data-quality,interpretation',
    text: 'I have received a data quality alert for 127 contract accounts with mismatched billing classes. Explain what this means in plain business terms, what the financial risk is if left unaddressed, which accounts are highest priority to fix, and what bulk job type and parameters I should use to correct them efficiently.'
  },
  {
    id: 'AIC-006',
    cat: 'AI Copilot Operations',
    title: 'Job Parameter Optimization Advisor',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'copilot,parameters,optimization,tuning',
    text: 'Review my last 5 bulk job configurations and recommend parameter improvements. Identify patterns in my parameter choices that are leading to higher failure rates or slower processing, and suggest specific changes to chunk size, retry settings, and filter parameters that would improve outcomes. Explain the reasoning behind each recommendation.'
  },
  {
    id: 'AIC-007',
    cat: 'AI Copilot Operations',
    title: 'Platform Status Morning Briefing',
    recommended: true,
    persona: 'Operations Manager',
    jobType: null,
    tags: 'copilot,morning-briefing,status,daily-ops',
    text: 'Give me a morning operations briefing for the MAE platform. Include: what happened overnight (jobs completed, any failures), current system status (queue depth, jobs in progress), the top 3 things I need to act on today in priority order, and any anomalies I should investigate. Keep it to a 2-minute read.'
  },

  // ── 10. SAP Analytics ────────────────────────────────────────────────────────

  {
    id: 'SAP-001',
    cat: 'SAP Analytics',
    title: 'SAP Analytics Cloud Dashboard Refresh',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'SAC,analytics-cloud,dashboard,KPIs',
    text: 'Prepare the data package for the SAP Analytics Cloud monthly operations dashboard refresh. Include all KPIs in the required format: job volumes by type (table), success rate trend (time series), cost savings summary (KPI tile), customer impact metrics (bar chart), and failure analysis breakdown (pie chart). Validate that all data points are current as of the last completed job.'
  },
  {
    id: 'SAP-002',
    cat: 'SAP Analytics',
    title: 'Data Extraction for BI Reporting',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'extraction,BI,reporting,SAP-BI',
    text: 'Design the data extraction query for the weekly BI report on bulk processing operations. The report requires: all completed jobs from the past 7 days with their final status, total and success record counts, processing duration, and requested-by user ID. Ensure the extraction includes only non-simulation-mode jobs and excludes personally identifiable customer data to comply with data governance policies.'
  },
  {
    id: 'SAP-003',
    cat: 'SAP Analytics',
    title: 'SAP BW Performance Metrics Export',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'BW,export,performance,metrics,integration',
    text: 'Prepare the monthly performance metrics export for the SAP BW data warehouse. Format the PerformanceMetrics entity data to match the expected BW InfoObject structure: BATCH_ID as the key, METRIC_TYPE and METRIC_VALUE as facts, and RECORDED_AT as the time dimension. Include data quality validation rules to ensure no null values in required fields before export.'
  },
  {
    id: 'SAP-004',
    cat: 'SAP Analytics',
    title: 'Customer Segment Analytics Summary',
    recommended: false,
    persona: 'Executive',
    jobType: null,
    tags: 'segments,analytics,SAP,customer-breakdown',
    text: 'Generate a customer segment analytics summary compatible with SAP Analytics Cloud story format. Break down active customers by segment (RESIDENTIAL, COMMERCIAL, INDUSTRIAL), by region, and by notification opt-in status. Calculate the average number of contract accounts per customer in each segment and flag any segments with declining active account counts that may indicate customer attrition.'
  },
  {
    id: 'SAP-005',
    cat: 'SAP Analytics',
    title: 'Predictive Maintenance Alert Analysis',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'predictive,maintenance,anomaly,monitoring',
    text: 'Analyze throughput and error rate data from the last 30 days to build a predictive model for job failure risk. Identify leading indicators that precede high-failure jobs (such as elevated error rates in the preceding 3 hours, queue depth above threshold, or specific day-of-week patterns). Express the model as simple threshold rules that can be implemented in the monitoring dashboard.'
  },
  {
    id: 'SAP-006',
    cat: 'SAP Analytics',
    title: 'Cost Allocation Report by Department',
    recommended: true,
    persona: 'Executive',
    jobType: null,
    tags: 'cost,allocation,department,chargeback',
    text: 'Prepare a cost allocation report for bulk processing operations by requesting department. For each REQUESTED_BY user or department code, calculate the total records processed, processing time consumed, estimated cost per the standard rate card ($0.52 per record), and compare against the allocated budget for the period. Identify departments exceeding their allocation and recommend adjustments.'
  },
  {
    id: 'SAP-007',
    cat: 'SAP Analytics',
    title: 'Data Lineage Documentation',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'data-lineage,governance,audit-trail,compliance',
    text: 'Document the data lineage for a MAILING_ADDRESS_UPDATE job from source to final update. Trace: the source of the contract account list, the address history lookup that provides new addresses, the validation step outputs, the actual ContractAccounts table updates, the AddressHistory records created, and the audit trail in the failure logs. This documentation is required for the annual data governance audit.'
  },

  // ── 11. Process Optimization ─────────────────────────────────────────────────

  {
    id: 'OPT-001',
    cat: 'Process Optimization',
    title: 'N+1 Query Pattern Elimination',
    recommended: true,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'N+1,performance,database,optimization',
    text: 'Identify all N+1 query patterns in the current bulk processing implementation where individual database calls are made per record instead of using set-based batch queries. Estimate the performance impact of each N+1 pattern in terms of total database round-trips for a 10,000-record job, and recommend specific refactoring to batch queries using the existing BatchQueryClient pattern.'
  },
  {
    id: 'OPT-002',
    cat: 'Process Optimization',
    title: 'Chunk Size Optimization Analysis',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'chunk-size,optimization,tuning,performance',
    text: 'Analyze the relationship between chunk size and job throughput for all job types based on historical performance data. For each job type, identify the chunk size that maximizes throughput while keeping failure rates below 2%. Present results as a recommended chunk size configuration per job type, with the expected throughput improvement versus the current default chunk size of 500.'
  },
  {
    id: 'OPT-003',
    cat: 'Process Optimization',
    title: 'Database Index Optimization Recommendations',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'indexes,database,query-performance,optimization',
    text: 'Analyze the most frequent query patterns against the BatchJobs, BatchJobFailureLogs, ContractAccounts, and AddressHistory tables. Identify queries that perform full table scans due to missing indexes on commonly filtered columns (STATUS, CREATED_ON, BATCH_ID, CONTRACT_ACCOUNT). Recommend a prioritized list of index additions with estimated query performance improvement for each.'
  },
  {
    id: 'OPT-004',
    cat: 'Process Optimization',
    title: 'Parallel Processing Architecture Review',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'parallel,architecture,concurrency,throughput',
    text: 'Review the current sequential step execution in the BulkJobEngine and identify steps that could be parallelized. Estimate the throughput improvement from parallelizing PROCESSING_TRANSACTION across multiple workers. Design a parallel execution model that maintains transactional integrity and provides accurate progress reporting throughout the job lifecycle.'
  },
  {
    id: 'OPT-005',
    cat: 'Process Optimization',
    title: 'Memory Efficiency Analysis',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'memory,efficiency,heap,Node.js',
    text: 'Analyze memory usage patterns during large bulk job execution. Identify operations that load entire record sets into memory and estimate the memory footprint for jobs with 50K, 100K, and 500K records. Recommend streaming or pagination patterns that would allow processing arbitrarily large record sets without memory exhaustion on a 512MB Cloud Foundry instance.'
  },
  {
    id: 'OPT-006',
    cat: 'Process Optimization',
    title: 'Handler Preprocessing Pipeline Design',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'preprocessing,pipeline,validation,efficiency',
    text: 'Design a shared preprocessing pipeline for all four job type handlers that handles common tasks (deduplication of input contract accounts, status validation, existence check) before type-specific logic begins. Estimate the reduction in individual handler code complexity and identify any preprocessing steps that could be parallelized to reduce total job startup time.'
  },
  {
    id: 'OPT-007',
    cat: 'Process Optimization',
    title: 'Caching Strategy for Hot Data',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'caching,hot-data,performance,in-memory',
    text: 'Identify data sets that are repeatedly queried during bulk job processing but rarely change (such as valid billing class codes, active customer status lookup, ZIP code validation tables). Design a caching strategy using in-memory caching with appropriate TTL values to eliminate redundant database calls. Estimate the query reduction percentage and the impact on overall job throughput.'
  },

  // ── 12. Compliance ────────────────────────────────────────────────────────────

  {
    id: 'CMP-001',
    cat: 'Compliance',
    title: 'GDPR Data Rectification Audit',
    recommended: true,
    persona: 'Compliance Officer',
    jobType: null,
    tags: 'GDPR,rectification,Article-16,compliance-audit',
    text: 'Audit the platform\'s compliance with GDPR Article 16 (right to rectification). Verify that all address changes processed in the last 90 days have a complete audit trail including: timestamp of change, source of change request, operator ID, old and new values, and confirmation of completion sent to the customer. Identify any gaps in the audit trail and assess the regulatory risk exposure for incomplete records.'
  },
  {
    id: 'CMP-002',
    cat: 'Compliance',
    title: 'CCPA Opt-Out Compliance Verification',
    recommended: false,
    persona: 'Compliance Officer',
    jobType: null,
    tags: 'CCPA,opt-out,California,compliance',
    text: 'Verify that all notification campaigns in the last 30 days respected customer CCPA opt-out requests. For each campaign, confirm that the customer NOTIFICATION_OPT_IN flag was checked before sending, that opt-out requests received within the processing window were honored, and that a record exists showing the opt-out check was performed. Report any campaigns where the opt-out check cannot be confirmed.'
  },
  {
    id: 'CMP-003',
    cat: 'Compliance',
    title: 'SOX Controls Verification for Bulk Operations',
    recommended: false,
    persona: 'Compliance Officer',
    jobType: null,
    tags: 'SOX,controls,audit-trail,financial-data',
    text: 'Verify that all bulk operations affecting financial data (billing class changes, account status updates) comply with SOX controls. Confirm that operations above the 1,000-record threshold were approved by a second authorized user, that approval records exist in the audit log, and that changes are traceable to the approved work order. Identify any operations that bypassed the required approval workflow.'
  },
  {
    id: 'CMP-004',
    cat: 'Compliance',
    title: 'Data Retention Policy Compliance Check',
    recommended: false,
    persona: 'Compliance Officer',
    jobType: null,
    tags: 'data-retention,policy,archival,compliance',
    text: 'Review the current data retention posture for all bulk processing tables. Compare actual data age against the defined retention policy (2 years for job logs, 7 years for financial data, indefinite for audit trails). Identify tables where data exceeds the retention period, estimate the volume of data subject to deletion or archival, and assess the compliance risk of the current retention gap.'
  },
  {
    id: 'CMP-005',
    cat: 'Compliance',
    title: 'Access Control Audit for Sensitive Operations',
    recommended: false,
    persona: 'Compliance Officer',
    jobType: null,
    tags: 'access-control,roles,permissions,audit',
    text: 'Audit access controls for bulk operations affecting sensitive customer data. Verify that only users with the BulkJobOperator role can create and execute jobs, that the BulkJobAdmin role is assigned to the minimum number of users required, and that no test or service accounts have administrative access in production. Report any access control violations and recommend immediate remediation steps.'
  },
  {
    id: 'CMP-006',
    cat: 'Compliance',
    title: 'Breach Notification Readiness Assessment',
    recommended: false,
    persona: 'Compliance Officer',
    jobType: null,
    tags: 'breach,notification,GDPR,72-hour,readiness',
    text: 'Assess the platform\'s readiness to meet the 72-hour breach notification requirement under GDPR Article 33. Evaluate the completeness of data inventory for records that could be affected by a breach, the speed of detection and notification workflows, the completeness of breach response documentation, and the readiness of customer notification templates. Identify the top 3 gaps that would delay breach notification.'
  },
  {
    id: 'CMP-007',
    cat: 'Compliance',
    title: 'Third-Party Data Processing Agreement Review',
    recommended: false,
    persona: 'Compliance Officer',
    jobType: null,
    tags: 'third-party,DPA,SAP,AI-Core,compliance',
    text: 'Review the data processing agreements in place for all third-party services used by the MAE platform (SAP AI Core, Cloud Foundry, SAP HANA Cloud). Verify that each agreement covers the categories of personal data processed, the purposes of processing, data transfer mechanisms for cross-border processing, sub-processor lists, and breach notification obligations. Identify any agreements requiring renewal or amendment.'
  },

  // ── 13. Customer Support ──────────────────────────────────────────────────────

  {
    id: 'CSP-001',
    cat: 'Customer Support',
    title: 'Account Update Status Inquiry Response',
    recommended: true,
    persona: 'Support Agent',
    jobType: null,
    tags: 'customer-support,status,inquiry,address-update',
    text: 'A customer is calling to inquire about the status of their address update request submitted 5 days ago. Look up their contract account, check if it was included in a bulk job, report the current status of the address change, and provide the customer with a reference number, the expected completion date, and escalation options if the update has not been processed within the standard SLA.'
  },
  {
    id: 'CSP-002',
    cat: 'Customer Support',
    title: 'Duplicate Notification Complaint Resolution',
    recommended: false,
    persona: 'Support Agent',
    jobType: null,
    tags: 'duplicate,notification,complaint,resolution',
    text: 'A customer reports receiving 3 duplicate address confirmation notifications within 24 hours. Investigate the notification logs for their contract account, identify the root cause of the duplicate sends (such as multiple job runs or retry processing), confirm whether the underlying address update was applied correctly, and draft a customer response apologizing for the duplicate communications and confirming the final account state.'
  },
  {
    id: 'CSP-003',
    cat: 'Customer Support',
    title: 'Address History Dispute Investigation',
    recommended: false,
    persona: 'Support Agent',
    jobType: null,
    tags: 'dispute,address-history,investigation,correction',
    text: 'A customer is disputing an address change on their account that they did not authorize. Pull the complete address history for their contract account, identify all changes in the last 12 months with their source (DIRECT_UPDATE, BULK_JOB, or CUSTOMER_PORTAL), identify any changes that originated from a source other than the customer, and prepare a case summary for the fraud investigation team including all relevant timestamps and system user IDs.'
  },
  {
    id: 'CSP-004',
    cat: 'Customer Support',
    title: 'Notification Opt-Out Processing',
    recommended: false,
    persona: 'Support Agent',
    jobType: 'CUSTOMER_PREFERENCE_UPDATE',
    tags: 'opt-out,preference,TCPA,immediate-effect',
    text: 'A customer has requested to opt out of all SMS notifications immediately. Process the opt-out by updating their NOTIFICATION_OPT_IN flag and CHANNEL preference, confirm that no pending SMS notifications will be sent for their account, and generate a confirmation record with the opt-out timestamp and the support agent ID. Provide the customer with a reference number for their opt-out request.'
  },
  {
    id: 'CSP-005',
    cat: 'Customer Support',
    title: 'Missing Confirmation Email Investigation',
    recommended: false,
    persona: 'Support Agent',
    jobType: null,
    tags: 'missing-email,confirmation,deliverability,investigation',
    text: 'A customer reports not receiving their address update confirmation email after a recent change. Check the notification log for their email address, verify if the notification was created and sent, determine if the delivery failed and why, check if the customer email address is valid and spelled correctly, and recommend the appropriate resolution (resend, update email address, or escalate to the deliverability team).'
  },
  {
    id: 'CSP-006',
    cat: 'Customer Support',
    title: 'Bulk Update Impact Explanation',
    recommended: false,
    persona: 'Support Agent',
    jobType: null,
    tags: 'bulk-update,explanation,customer-communication,transparency',
    text: 'A customer is asking why their account details were changed without their explicit consent during a bulk update operation. Explain in plain, non-technical language what a bulk update job is, why their account was included in the update, what specific changes were made and when, and what rights they have to dispute or reverse any changes they did not request. Provide a customer-friendly summary of the data change audit trail.'
  },
  {
    id: 'CSP-007',
    cat: 'Customer Support',
    title: 'Service Recovery Action Plan',
    recommended: false,
    persona: 'Support Agent',
    jobType: null,
    tags: 'service-recovery,remediation,customer-satisfaction,escalation',
    text: 'A high-value commercial customer has experienced 3 consecutive failed bulk updates for their 12 contract accounts over the last 45 days. Design a personalized service recovery action plan: dedicate a manual review of all 12 accounts, schedule a direct update outside the bulk framework, assign a named customer success contact, provide a service credit recommendation for the inconvenience, and set up enhanced monitoring for their accounts for the next 60 days.'
  },

  // ── 14. Operational Analytics ────────────────────────────────────────────────

  {
    id: 'OAN-001',
    cat: 'Operational Analytics',
    title: '30-Day Operational Trend Report',
    recommended: true,
    persona: 'Operations Manager',
    jobType: null,
    tags: 'trends,30-day,analytics,operational',
    text: 'Generate a comprehensive 30-day operational trend report for the MAE bulk processing platform. Include daily job counts and success rates as a trend line, weekly averages for throughput and duration, month-over-month comparison for total records processed and cost avoidance, and identification of any emerging trends (positive or negative) that warrant management attention. Highlight the top 3 performance wins and the top 3 areas requiring improvement.'
  },
  {
    id: 'OAN-002',
    cat: 'Operational Analytics',
    title: 'Peak Load Pattern Analysis',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'peak-load,patterns,capacity,scheduling',
    text: 'Analyze job submission and processing patterns over the last 90 days to identify peak load periods. Determine the hours of day, days of week, and days of month with the highest job volumes and resource consumption. Calculate the gap between peak and average load, and recommend a job scheduling policy that distributes load more evenly to reduce peak resource requirements and improve overall system stability.'
  },
  {
    id: 'OAN-003',
    cat: 'Operational Analytics',
    title: 'Operator Efficiency Scorecard',
    recommended: false,
    persona: 'Executive',
    jobType: null,
    tags: 'operator,efficiency,scorecard,performance-management',
    text: 'Generate an operator efficiency scorecard for all users who submitted bulk jobs in the last 30 days. For each operator, calculate: total jobs submitted, average job success rate, percentage of jobs run in simulation mode first, average job size, and reprocessing rate (jobs requiring retry). Identify operators with below-average success rates who may benefit from additional training on job parameter optimization.'
  },
  {
    id: 'OAN-004',
    cat: 'Operational Analytics',
    title: 'Infrastructure Cost Attribution',
    recommended: false,
    persona: 'Executive',
    jobType: null,
    tags: 'infrastructure,cost,attribution,Cloud-Foundry,SAP-BTP',
    text: 'Estimate the Cloud Foundry infrastructure cost attributable to bulk processing operations for the current month. Using the MAE backend memory allocation (512MB) and estimated CPU utilization per record processed, calculate the total compute cost, compare against the cost avoidance generated by the platform, and present a cost-benefit analysis showing the net financial benefit per 1,000 records processed.'
  },
  {
    id: 'OAN-005',
    cat: 'Operational Analytics',
    title: 'Error Code Frequency Distribution',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'error-codes,frequency,distribution,failure-patterns',
    text: 'Analyze the frequency distribution of all error codes in the BatchJobFailureLogs table over the last 90 days. Identify the top 10 error codes by occurrence count, calculate the percentage each represents of total failures, determine the trend (increasing or decreasing) for each top error code, and recommend which error codes should receive the highest priority for root cause elimination based on frequency, trend, and remediability.'
  },
  {
    id: 'OAN-006',
    cat: 'Operational Analytics',
    title: 'Cross-Job-Type Correlation Analysis',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'correlation,cross-job,dependencies,timing',
    text: 'Analyze whether there are timing correlations between jobs of different types that suggest operational dependencies. For example, do MAILING_ADDRESS_UPDATE jobs tend to be followed by NOTIFICATION_REQUEST jobs within 24 hours? Do CONTRACT_ACCOUNT_UPDATE jobs precede CUSTOMER_PREFERENCE_UPDATE jobs? Map these operational sequences and recommend standardized job workflows for common operational scenarios.'
  },
  {
    id: 'OAN-007',
    cat: 'Operational Analytics',
    title: 'Real-Time KPI Anomaly Alert Design',
    recommended: false,
    persona: 'Operations Manager',
    jobType: null,
    tags: 'real-time,KPI,anomaly,alerts,monitoring',
    text: 'Design an anomaly detection framework for real-time KPI monitoring. Define threshold rules for: job success rate below 95% (alert), throughput below 100 records/minute for more than 5 minutes (warning), queue depth above 5 jobs for more than 10 minutes (alert), failure rate above 5% for any single job (critical alert). Specify the notification recipients, escalation path, and auto-remediation actions for each alert type.'
  },

  // ── 15. AI Performance ────────────────────────────────────────────────────────

  {
    id: 'AIP-001',
    cat: 'AI Performance',
    title: 'Copilot Intent Accuracy Baseline',
    recommended: true,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'intent,accuracy,baseline,copilot,evaluation',
    text: 'Establish a baseline measurement of Operations Copilot intent recognition accuracy. Test the copilot with 20 representative queries across 5 intent categories (status-check, job-creation, failure-analysis, executive-reporting, data-lookup). For each query, record the detected intent, the response quality score, and whether the response was actionable. Calculate the baseline accuracy percentage and identify the intent categories with the highest error rates.'
  },
  {
    id: 'AIP-002',
    cat: 'AI Performance',
    title: 'Response Quality Score Trend Analysis',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'quality-score,trends,monitoring,AI-responses',
    text: 'Analyze the trend in AI response quality scores over the last 30 days across all executed prompts. Calculate the week-over-week change in average quality, alignment, and business impact scores. Identify any categories where quality scores have declined more than 5 points, hypothesize whether the decline is due to changing data patterns or prompt degradation, and recommend specific prompts for optimization.'
  },
  {
    id: 'AIP-003',
    cat: 'AI Performance',
    title: 'Hallucination Risk Assessment',
    recommended: true,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'hallucination,risk,grounding,accuracy,safety',
    text: 'Assess the hallucination risk in AI Copilot responses for the last 14 days. Identify responses where the AI cited specific record counts, dates, or financial figures that do not match the actual database state. Calculate the hallucination rate by intent category, estimate the business risk of undetected hallucinations in each category, and recommend grounding improvements such as requiring the AI to cite specific database query results before making factual claims.'
  },
  {
    id: 'AIP-004',
    cat: 'AI Performance',
    title: 'Model Performance Comparison',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'model-comparison,benchmarking,performance,cost',
    text: 'Compare the performance of available AI models for MAE Platform operations across 5 dimensions: response accuracy for factual queries, hallucination rate, average response latency, cost per 1,000 tokens, and operator satisfaction rating. Use the last 500 prompt executions as the benchmark dataset. Recommend the optimal model configuration for each use case category (quick status checks, complex analysis, executive reporting).'
  },
  {
    id: 'AIP-005',
    cat: 'AI Performance',
    title: 'Prompt Category Quality Benchmarks',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'benchmarks,quality,categories,targets',
    text: 'Establish quality benchmarks for each of the 15 prompt library categories. For each category, define: minimum acceptable quality score (baseline), target quality score (95%), the most important quality dimension (accuracy, actionability, business relevance, or completeness), and the threshold below which a prompt should be flagged for optimization. Create a monitoring dashboard definition that tracks quality against these benchmarks.'
  },
  {
    id: 'AIP-006',
    cat: 'AI Performance',
    title: 'Optimization Cycle Effectiveness Report',
    recommended: false,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'optimization,effectiveness,improvement,automated',
    text: 'Evaluate the effectiveness of the automated prompt optimization cycle. For all prompts that have been through at least one optimization iteration, compare quality scores before and after optimization. Calculate the average quality improvement per optimization iteration, the percentage of prompts that reached the 95% quality target, and the average number of iterations required. Identify any prompts where optimization has not converged and recommend manual review.'
  },
  {
    id: 'AIP-007',
    cat: 'AI Performance',
    title: 'AI Core Integration Health Check',
    recommended: true,
    persona: 'Data Analyst',
    jobType: null,
    tags: 'AI-Core,health-check,integration,SAP,availability',
    text: 'Perform a health check on the SAP AI Core integration for the MAE Platform. Verify that the OAuth token refresh is working correctly, that the deployment ID resolves to an available model, that request latency is within the 5-second SLA, and that fallback to rule-based responses is triggering correctly when AI Core is unavailable. Report the current AI Core availability percentage for the last 7 days and recommend any configuration changes to improve reliability.'
  }

];

// ── Core seed function ────────────────────────────────────────────────────────

/**
 * Seed all 105 prompts into the PromptLibrary table.
 *
 * @param {object} db - Open CDS database connection
 * @returns {Promise<number>} Number of prompts inserted
 */
async function seedPrompts(db) {
  const now = new Date().toISOString();

  // Idempotency check: skip if any prompts already exist
  const existing = await db.run(
    SELECT.from('mae.db.PromptLibrary').limit(1)
  ).catch(() => []);

  if (existing && existing.length > 0) {
    const count = await db.run(
      SELECT.one.from('mae.db.PromptLibrary').columns('count(*) as CNT')
    ).catch(() => ({ CNT: 0 }));
    const n = count ? count.CNT : 0;
    console.log(`[seed-prompts] Prompt library already contains ${n} record(s) — skipping seed.`);
    return 0;
  }

  let inserted = 0;

  for (const p of PROMPTS) {
    await db.run(
      INSERT.into('mae.db.PromptLibrary').entries({
        PROMPT_ID:           uuidv4(),
        TITLE:               p.title,
        DESCRIPTION:         p.text.length > 200
          ? p.text.substring(0, 197) + '...'
          : p.text,
        CATEGORY:            p.cat,
        PROMPT_TEXT:         p.text,
        SYSTEM_CONTEXT:      SYSTEM_CONTEXT,
        TAGS:                p.tags,
        PERSONA:             p.persona,
        JOB_TYPE:            p.jobType || null,
        VERSION:             1,
        STATUS:              'ACTIVE',
        OWNER:               'SYSTEM',
        USAGE_COUNT:         0,
        AVG_QUALITY_SCORE:   0,
        AVG_ALIGNMENT_SCORE: 0,
        AVG_BUSINESS_SCORE:  0,
        IS_FAVORITE:         false,
        IS_RECOMMENDED:      p.recommended || false,
        CREATED_ON:          now,
        UPDATED_ON:          now
      })
    );
    inserted++;
  }

  console.log(`[seed-prompts] Inserted ${inserted} prompts across 15 categories.`);
  return inserted;
}

// ── Standalone execution ──────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    try {
      const cds = require('@sap/cds');

      // Bootstrap CDS to resolve the model and connect to db
      await cds.connect();
      const db = await cds.connect.to('db');

      const count = await seedPrompts(db);
      if (count > 0) {
        console.log(`[seed-prompts] Done. ${count} prompts seeded successfully.`);
      }
      process.exit(0);
    } catch (err) {
      console.error('[seed-prompts] Fatal error:', err.message);
      process.exit(1);
    }
  })();
}

module.exports = seedPrompts;
