# MAE Autonomous Customer Data Operations Platform
## Deployment Validation Checklist

---

## Pre-Deployment

- [ ] All unit tests passing (`npm run test:unit` — 0 failures)
- [ ] All integration tests passing (`npm run test:integration`)
- [ ] Lint clean (`npm run lint`)
- [ ] MTA build successful (`mbt build -p cf`)
- [ ] Seed data generated (`node scripts/seed-data.js --scenario=demo`)
- [ ] `xs-security.json` validated against XSUAA schema
- [ ] All BTP service entitlements confirmed (HANA Cloud, XSUAA, Destination, Job Scheduler, AI Core, HTML5 Repo)
- [ ] GitHub Actions CI pipeline green

## Deployment Execution

- [ ] `cf login` successful to target space
- [ ] `cf deploy mae-cdop_1.0.0.mtar -f` completes without errors
- [ ] All 4 modules deployed: mae-cap-backend, mae-hana-deployer, mae-ui-approuter, mae-ui-content

## Post-Deployment — Services

- [ ] `cf services` shows all service instances: CREATED
  - [ ] mae-hana (hana, hdi-shared)
  - [ ] mae-xsuaa (xsuaa, application)
  - [ ] mae-destination (destination, lite)
  - [ ] mae-job-scheduler (jobscheduler, lite)
  - [ ] mae-html5-repo-host (html5-apps-repo, app-host)
  - [ ] mae-html5-repo-runtime (html5-apps-repo, app-runtime)
  - [ ] mae-aicore (aicore, extended) — *optional, Copilot degrades gracefully*

## Post-Deployment — Applications

- [ ] `cf app mae-cap-backend` shows: running, 1/1 instances
- [ ] `cf app mae-ui-approuter` shows: running, 1/1 instances

## API Smoke Tests

```bash
# Health check
curl -f https://mae-cap-backend.<cf-domain>/health

# OData service metadata
curl -f "https://mae-cap-backend.<cf-domain>/odata/v4/BulkJobService/$metadata"

# Batch endpoint (unauthenticated — should return 401)
curl -f -X POST "https://mae-cap-backend.<cf-domain>/api/customers/batch"
# Expected: 401 Unauthorized
```

- [ ] `/health` returns `{"status":"UP"}`
- [ ] `/odata/v4/BulkJobService/$metadata` returns OData metadata XML
- [ ] Unauthenticated requests return HTTP 401

## SAPUI5 Application

- [ ] App loads in browser without JavaScript errors
- [ ] All 7 navigation items visible in sidebar
- [ ] Dashboard KPIs render (0 values acceptable before first job)
- [ ] Job Monitor table loads
- [ ] Create Job wizard completes all 4 tabs
- [ ] Copilot page loads and accepts input

## Functional Smoke Tests

- [ ] Create a MAILING_ADDRESS_UPDATE job in SIMULATION_MODE=true
- [ ] Job transitions through all processing steps to COMPLETED
- [ ] Executive Summary generates for last 30 days
- [ ] Copilot creates a session and responds to first message

## Security Validation

- [ ] BulkJobAnalyst role cannot create jobs (HTTP 403)
- [ ] BulkJobOperator role can create and cancel jobs
- [ ] Unauthenticated API calls return 401
- [ ] XSUAA token validation working

## HANA Validation

```sql
-- Connect to HANA schema and verify tables
SELECT COUNT(*) FROM Z_CUSTOMERS;         -- Expected: > 0 (seed data)
SELECT COUNT(*) FROM Z_CONTRACT_ACCOUNTS; -- Expected: > 0
SELECT COUNT(*) FROM Z_BATCH_JOB;        -- Expected: >= 1 (smoke test job)
```

- [ ] Z_CUSTOMERS: record count matches seed data
- [ ] Z_CONTRACT_ACCOUNTS: record count matches seed data
- [ ] Z_BATCH_JOB: at least 1 record from smoke test
- [ ] P_BULK_LOAD_CONTRACT_ACCOUNTS procedure exists and callable

## Sign-Off

| Validator | Role | Date | Signature |
|-----------|------|------|-----------|
| | Dev Lead | | |
| | QA Lead | | |
| | Operations | | |

**Deployment Status:** [ ] Ready for Production  [ ] Issues Found (see notes)
