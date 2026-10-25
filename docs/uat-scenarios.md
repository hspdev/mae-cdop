# MAE Autonomous Customer Data Operations Platform
## UAT Scenarios

---

## UAT Scope

Validate: Framework correctness, API contract, UI completeness, security, performance, Copilot behavior.

---

## UAT-001: Mailing Address Update — Happy Path

**Role:** BulkJobOperator  
**Precondition:** Seed data loaded, HANA available

| Step | Action | Expected Result | Pass/Fail |
|------|--------|----------------|-----------|
| 1 | POST /api/bulk-jobs/MAILING_ADDRESS_UPDATE with 100 Allentown accounts | HTTP 202, batchId returned | |
| 2 | GET /api/bulk-jobs/{batchId}/status | Status transitions: QUEUED → IN_PROGRESS → COMPLETED | |
| 3 | GET /api/bulk-jobs/{batchId}/result | successCount = 100, failedCount = 0, successRate = 100% | |
| 4 | Query Z_CONTRACT_ACCOUNTS for updated accounts | New street addresses persisted | |
| 5 | Query Z_ADDRESS_HISTORY | New history records with CHANGE_SOURCE='CAMPAIGN' | |

**Pass Criteria:** All 5 steps pass

---

## UAT-002: Mailing Address Update — Simulation Mode

| Step | Action | Expected Result | Pass/Fail |
|------|--------|----------------|-----------|
| 1 | Create job with simulationMode=true | HTTP 202, batchId returned | |
| 2 | Wait for completion | Status = COMPLETED | |
| 3 | Query Z_CONTRACT_ACCOUNTS | Addresses NOT changed | |
| 4 | Check result | successCount reported but no HANA writes | |

---

## UAT-003: Retry Framework

| Step | Action | Expected Result | Pass/Fail |
|------|--------|----------------|-----------|
| 1 | Create job with 10 known-failure accounts (CA_FAIL*) | Job created | |
| 2 | Monitor job | Status = PARTIALLY_COMPLETED or FAILED | |
| 3 | GET result | failedAccounts[] populated with error details | |
| 4 | Check Z_BATCH_JOB_FAILURE_LOGS | 10 records with error messages | |
| 5 | POST /api/bulk-jobs/{batchId}/reprocess {onlyFailed:true} | New batch created with only failed accounts | |

---

## UAT-004: Job Cancellation

| Step | Action | Expected Result | Pass/Fail |
|------|--------|----------------|-----------|
| 1 | Create job with 100K accounts | Status = QUEUED | |
| 2 | Within 5 seconds: POST /api/bulk-jobs/{batchId}/cancel | success=true | |
| 3 | GET status | Status = CANCELLED | |
| 4 | Attempt to reprocess cancelled job | Error: job in terminal state OR new job created | |

---

## UAT-005: Batch Query — Large Scale

| Step | Action | Expected Result | Pass/Fail |
|------|--------|----------------|-----------|
| 1 | POST /api/customers/batch {contractAccounts: [10000 accounts]} | HTTP 200, count=10000 records | |
| 2 | POST /api/customers/batch {contractAccounts: [50000 accounts]} | HTTP 200, count=50000 records | |
| 3 | POST /api/customers/batch {contractAccounts: [100001 accounts]} | HTTP 400, max exceeded error | |
| 4 | POST /api/customers/batch {contractAccounts: []} | HTTP 400, empty array error | |

---

## UAT-006: Contract Account Update

| Step | Action | Expected Result | Pass/Fail |
|------|--------|----------------|-----------|
| 1 | Create CONTRACT_ACCOUNT_UPDATE with billingClass=BUDGET for 50 accounts | HTTP 202 | |
| 2 | Wait for COMPLETED | All 50 accounts updated | |
| 3 | Verify Z_CONTRACT_ACCOUNTS | BILLING_CLASS = 'BUDGET' for all 50 | |
| 4 | Submit with invalid billingClass=INVALID | Validation error returned | |

---

## UAT-007: Customer Preference Update

| Step | Action | Expected Result | Pass/Fail |
|------|--------|----------------|-----------|
| 1 | Create CUSTOMER_PREFERENCE_UPDATE (channel=EMAIL, optedIn=false) | HTTP 202 | |
| 2 | Wait for COMPLETED | Preferences updated | |
| 3 | Query Z_CUSTOMER_PREFERENCES | OPTED_IN = false for processed customers | |
| 4 | Rerun with optedIn=true | OPTED_IN flipped back | |

---

## UAT-008: Notification Request

| Step | Action | Expected Result | Pass/Fail |
|------|--------|----------------|-----------|
| 1 | Create NOTIFICATION_REQUEST (EMAIL, ADDRESS_CONFIRMATION) | HTTP 202 | |
| 2 | Wait for COMPLETED | Notifications recorded | |
| 3 | Query Z_NOTIFICATIONS | BATCH_ID matches, STATUS=SENT | |
| 4 | Verify opt-out filtering | Customers with NOTIFICATION_OPT_IN=false excluded | |

---

## UAT-009: Security — Role-Based Access Control

| Step | Action | Expected Result | Pass/Fail |
|------|--------|----------------|-----------|
| 1 | BulkJobAnalyst user: GET /api/bulk-jobs/{id}/status | HTTP 200 | |
| 2 | BulkJobAnalyst user: POST /api/bulk-jobs/MAILING_ADDRESS_UPDATE | HTTP 403 | |
| 3 | BulkJobOperator user: POST /api/bulk-jobs/MAILING_ADDRESS_UPDATE | HTTP 202 | |
| 4 | Unauthenticated request to any endpoint | HTTP 401 | |

---

## UAT-010: DUCI Operations Copilot

| Step | Action | Expected Result | Pass/Fail |
|------|--------|----------------|-----------|
| 1 | Create session | sessionId returned | |
| 2 | Send: "Create a mailing address update job for Allentown" | Response includes job configuration JSON for review | |
| 3 | Verify: Copilot does NOT auto-execute | Actions field populated, approval required | |
| 4 | Send: "Explain the most recent failures" | AI explains error patterns in plain English | |
| 5 | Send: "Generate executive summary" | Summary with KPIs returned | |

---

## UAT-011: Executive Summary

| Step | Action | Expected Result | Pass/Fail |
|------|--------|----------------|-----------|
| 1 | Load Executive Summary page | KPIs displayed | |
| 2 | Generate with last 30 days | Summary narrative generated | |
| 3 | Verify successRate calculation | (totalSuccess/totalAccounts)*100 matches | |
| 4 | Verify hoursSaved > 0 | Estimated hours computed | |

---

## UAT-012: Performance Benchmarks

| Test | Input | Expected Throughput | Max Duration | Pass/Fail |
|------|-------|---------------------|--------------|-----------|
| P-001 | 10K accounts, simulation | ≥ 500 rec/sec | 30 seconds | |
| P-002 | 50K accounts, simulation | ≥ 400 rec/sec | 2 minutes | |
| P-003 | 100K accounts, simulation | ≥ 300 rec/sec | 5 minutes | |
| P-004 | POST /api/customers/batch 100K accounts | Response < 5 seconds | 5 seconds | |

---

## UAT Sign-Off

| Section | Tester | Date | Result | Sign-Off |
|---------|--------|------|--------|---------|
| Framework APIs (001-005) | | | | |
| Handler Scenarios (006-008) | | | | |
| Security (009) | | | | |
| Copilot (010) | | | | |
| Reporting (011) | | | | |
| Performance (012) | | | | |

**Overall UAT Status:** [ ] Pass  [ ] Fail  [ ] Conditional Pass
