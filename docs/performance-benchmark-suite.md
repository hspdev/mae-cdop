# MAE Autonomous Customer Data Operations Platform
## Performance Benchmark Suite

---

## Benchmark Objectives

- Validate throughput at 10K, 50K, and 100K records
- Confirm HANA set-based query performance vs OData OR-filter pattern
- Measure retry framework overhead
- Establish baseline metrics for production monitoring

---

## Benchmark Scenarios

### BENCH-001: HANA Set-Based Query — Batch Load

**Method:** POST /api/customers/batch  
**Payload sizes:** 10K, 50K, 100K contract account numbers

| Records | Expected Response | Acceptable Max |
|---------|------------------|----------------|
| 10,000  | < 0.5 seconds    | 2 seconds      |
| 50,000  | < 2 seconds      | 5 seconds      |
| 100,000 | < 5 seconds      | 10 seconds     |

**Why it matters:** Every bulk job begins with batch data loading. This is the critical path.

---

### BENCH-002: Full Job Throughput — Simulation Mode

**Method:** POST /api/bulk-jobs/MAILING_ADDRESS_UPDATE (simulationMode=true)

| Records | Expected Throughput | Expected Duration |
|---------|--------------------|--------------------|
| 10,000  | ≥ 850 rec/sec      | ≤ 12 seconds       |
| 50,000  | ≥ 780 rec/sec      | ≤ 65 seconds       |
| 100,000 | ≥ 720 rec/sec      | ≤ 140 seconds      |

---

### BENCH-003: Full Job Throughput — Real Mode (HANA writes)

| Records | Expected Throughput | Expected Duration |
|---------|--------------------|--------------------|
| 10,000  | ≥ 200 rec/sec      | ≤ 50 seconds       |
| 50,000  | ≥ 180 rec/sec      | ≤ 5 minutes        |
| 100,000 | ≥ 150 rec/sec      | ≤ 12 minutes       |

*Note: Real mode is slower due to HANA write commits and address history inserts.*

---

### BENCH-004: Retry Framework Overhead

**Setup:** 10% failure rate injected into processing (100 of 1000 accounts)

| Metric | Expected |
|--------|----------|
| Retry 1 delay | 1,000ms |
| Retry 2 delay | 2,000ms |
| Retry 3 delay | 4,000ms |
| Max total overhead | ≤ 7 seconds per failed record |
| Success rate after retries | ≥ 85% recovery |

---

### BENCH-005: Concurrent Job Processing

**Setup:** 5 simultaneous bulk jobs, each with 1,000 accounts

| Metric | Expected |
|--------|----------|
| All 5 jobs complete | Yes |
| No cross-job data corruption | Yes |
| Total time | ≤ 60 seconds |
| Memory usage | ≤ 1.5 GB |

---

## Running Benchmarks

```bash
# 1. Generate performance dataset
node scripts/seed-data.js --scenario=performance --count=100000

# 2. Run benchmark via API
node scripts/run-benchmarks.js --sizes=10000,50000,100000 --modes=simulation,real

# 3. Check results
cat benchmark-results.json
```

---

## Benchmark Results Template

| Benchmark | Date | Environment | Records | Throughput | Duration | Memory | HANA CPU | Status |
|-----------|------|-------------|---------|-----------|---------|--------|----------|--------|
| BENCH-001 | | BTP CF eu10 | 10K | | | | | |
| BENCH-001 | | BTP CF eu10 | 100K | | | | | |
| BENCH-002 | | BTP CF eu10 | 10K | | | | | |
| BENCH-002 | | BTP CF eu10 | 100K | | | | | |
| BENCH-003 | | BTP CF eu10 | 10K | | | | | |
| BENCH-003 | | BTP CF eu10 | 100K | | | | | |

---

## Performance Monitoring in Production

Key metrics to track via SAP Cloud ALM or custom HANA dashboards:

```sql
-- Average throughput per job type (last 7 days)
SELECT
  j.JOB_TYPE,
  COUNT(*) AS JOBS,
  AVG(j.THROUGHPUT_RPS) AS AVG_THROUGHPUT,
  AVG(j.DURATION_SECONDS) AS AVG_DURATION_SEC,
  SUM(j.TOTAL_ACCOUNTS) AS TOTAL_RECORDS
FROM Z_BATCH_JOB j
WHERE j.CREATED_ON >= ADD_DAYS(CURRENT_TIMESTAMP, -7)
  AND j.STATUS IN ('COMPLETED', 'PARTIALLY_COMPLETED')
GROUP BY j.JOB_TYPE
ORDER BY AVG_THROUGHPUT DESC;

-- Slowest jobs (candidates for optimization)
SELECT BATCH_ID, JOB_TYPE, TOTAL_ACCOUNTS, DURATION_SECONDS, THROUGHPUT_RPS
FROM Z_BATCH_JOB
WHERE DURATION_SECONDS > 300  -- > 5 minutes
ORDER BY DURATION_SECONDS DESC
LIMIT 20;
```
