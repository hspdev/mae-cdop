# MAE Autonomous Customer Data Operations Platform

Demo Utilities Company Inc. (DUCI) — MAE Bulk Job Processing Framework

## Business challenge

Demo Utilities Company Inc. (DUCI) needs to modernize and automate bulk customer data operations at scale (up to 100,000 records). Operations teams currently face manual, error-prone, high-latency processes for mailing address updates, contract account updates, customer preference updates, and notification requests. The solution must provide a reusable, configuration-driven MAE Bulk Job Processing Framework with an AI-powered Operations Copilot, progress monitoring, failure analysis, reprocessing capabilities, and executive reporting — all deployed on SAP BTP Cloud Foundry.

Primary demo scenario: "Find all active customers in Allentown with address changes in the last 90 days and update customer records using the new mailing address campaign data."

## Business Goals & Success Criteria

| Metric | Baseline | Target | Timeline | Process / Capability | Source |
|--------|----------|--------|----------|----------------------|--------|
| Customer Records Modernized per Job Run | Manual / ad-hoc | 100,000 records per batch | Phase 1 Go-Live | Bulk Customer Data Operations | agent-derived |
| Bulk Job Success Rate | Unknown / unmeasured | ≥ 99% success rate | Phase 1 Go-Live | MAE Transaction Processing | agent-derived |
| Operational Hours Saved per Campaign | Baseline manual effort ~40 hrs | ≥ 80% reduction (≤ 8 hrs) | Phase 1 Go-Live | Operations Automation | agent-derived |
| Failed Record Recovery via AI | 0% automated recovery | ≥ 70% AI-assisted recovery | Phase 1 Go-Live | Retry & Remediation Framework | agent-derived |
| Time to Deploy New MAE Transaction Type | Weeks (custom code) | ≤ 1 day (handler config only) | Phase 2 | Framework Extensibility | agent-derived |
| Batch Throughput | Not measured | 10K / 50K / 100K records supported | Phase 1 Go-Live | HANA Set-Based Processing | agent-derived |

## Key Milestones

- **Framework Foundation Complete**: CDS models, CAP services, IBulkJobHandler interface, Factory/Strategy patterns deployed to BTP
- **Handler Library v1 Ready**: MailingAddressHandler, ContractAccountHandler, CustomerPreferenceHandler, NotificationHandler all tested
- **Batch API Operational**: POST /api/bulk-jobs/{jobType}, status, result, reprocess, cancel endpoints live with QUEUED→COMPLETED lifecycle
- **DUCI Demo Scenario Runnable**: Allentown mailing address campaign executes end-to-end with 100K seed data
- **Operations Copilot Live**: SAP Gen AI Hub-powered copilot creates jobs, explains failures, recommends remediation, generates executive summaries
- **SAPUI5 Application Complete**: All 7 views (Dashboard, Copilot, Create Job, Job Monitor, Failure Analysis, Executive Summary, Platform Insights) deployed
- **BTP Deployment Validated**: mta.yaml, xs-security.json, GitHub Actions CI/CD pipeline green

## Business Architecture (RBA)

### End-to-End Process

Lead to Cash for Utilities (Grid Usage / New Connection / Retailer variants)

### Process Hierarchy

```
Lead to Cash Standard B2B (E2E)
└── Manage Customers and Channels (B2B) (Phase)
    └── Manage Customers (B2B) (BPS-370_001)
        └── Manage Customers and Accounts
        └── Onboard Customer
        └── Bulk Update Mailing Address (MAE Extension)
        └── Bulk Update Contract Account (MAE Extension)
        └── Bulk Update Customer Preferences (MAE Extension)
        └── Bulk Send Notification Requests (MAE Extension)
```

### Summary

Utility bulk customer data operations map to Lead to Cash → Manage Customers and Channels → Manage Customers (B2B), with four MAE-specific extensions for bulk address, contract account, preference, and notification processing. The framework architecture extends the standard customer management capability with a reusable BTP-native batch engine.

## Fit Gap Analysis

| Requirement (business) | Standard asset(s) found | API ORD ID | MCP Server ORD ID | MCP Server Version | Webhook API ORD ID | Data Product ORD ID | Gap? | Notes / assumptions |
| ---------------------- | ----------------------- | ---------- | ----------------- | ------------------ | ------------------ | ------------------- | ---- | ------------------- |
| Bulk mailing address update for 100K customers | SAP S/4HANA Cloud Private/Public — Customer Master Data Management (SC5682, SC1172) | `sap.s4:apiResource:OP_API_BUSINESS_PARTNER_SRV:v1` | — | — | — | — | Partial | Business Partner OData API available; no MCP server found; bulk orchestration is a custom CAP framework gap |
| Contract account updates at scale | SAP S/4HANA — Contract Account OData | `sap.s4:apiResource:CONTRACTACCOUNT_0001:v1`, `sap.s4:apiResource:OP_CONTRACTACCOUNT_0001:v1` | — | — | — | — | Partial | Contract Account APIs available; bulk replication SOAP also available; no MCP server; bulk job orchestration is custom |
| Bulk contract account replication | SAP S/4HANA — Contract Account Bulk Replicate | `sap.s4:apiResource:OP_CONTRACTACCOUNTBULKREPLICATERE:v1` | — | — | — | — | No | Bulk replicate API exists; use as integration endpoint |
| Customer preference management | SAP Customer Data Cloud — Preference Management (SC3218), Profile Management (SC3209) | — | — | — | — | — | Yes | CustData Cloud is a separate SaaS product not in scope; preference data modeled locally in HANA |
| Customer consent & identity management | SAP Customer Data Cloud — Consent (SC3215), SAP Customer Identity (SC3176, SC3208) | — | — | — | — | — | Yes | Out of scope for this framework; noted for future integration |
| Notification request processing | No standard asset for bulk notification dispatch | — | — | — | — | — | Yes | Custom NotificationHandler implementation required in framework |
| Reusable MAE batch job engine (QUEUED→COMPLETED lifecycle) | No standard SAP product | — | — | — | — | — | Yes | Full custom build: CAP Node.js + SAP HANA Cloud + Job Scheduler |
| AI Operations Copilot (job creation, failure explanation, remediation) | SAP AI Core / Generative AI Hub | — | — | — | — | — | Partial | SAP Gen AI Hub available for LLM calls; orchestration and prompt engineering are custom |
| Retry framework with exponential backoff | No standard SAP product | — | — | — | — | — | Yes | Custom implementation in CAP service layer with HANA persistence |
| SAPUI5 Fiori operations dashboard | SAP BTP HTML5 Repository + XSUAA | — | — | — | — | — | No | Standard BTP hosting; custom SAPUI5 application |
| Performance: 10K / 50K / 100K record batches | SAP HANA Cloud set-based processing | — | — | — | — | — | No | HANA set-based SQL, POST /api/customers/batch pattern, no large OData OR filters |

> **Unavailable APIs (excluded from solution):** Multichannel Foundation for Utilities (`UT_ERP_ISU_UMC_0001:v1`), Utilities Sales Contract APIs, Address OData (no ORD ID), Customer Master Data OData (no ORD ID), Business Partners REST (no ORD ID) — all marked unavailable in the customer landscape.

### Key findings

- No MCP servers were found for any of the discovered APIs; all S/4HANA integrations will use direct OData/SOAP API calls from CAP services
- The core bulk job framework is a full custom build on SAP BTP (CAP + HANA Cloud) — no standard SAP product covers this capability
- Business Partner OData API (`API_BUSINESS_PARTNER:v1`) and Contract Account OData APIs are available and will serve as integration endpoints
- Customer preference and notification capabilities have no matching standard assets and require custom handler implementations
- SAP Generative AI Hub covers the AI Copilot requirement; prompt engineering and conversation orchestration are custom
- HANA Cloud set-based processing is the correct approach for 100K-record batch performance; large OData OR-filter patterns must not be used

## Recommendations

### MAE Autonomous Customer Data Operations Platform — Custom BTP Application

#### Executive Summary

Full custom SAP BTP application: CAP + HANA + SAPUI5 + Gen AI Hub Copilot

#### Recommended Solution

Build a deployment-ready SAP BTP Cloud Foundry application composed of:
1. **CAP Node.js Backend** — IBulkJobHandler framework with Strategy+Factory+DI patterns; four sample handlers (Mailing Address, Contract Account, Customer Preference, Notification); REST + OData V4 APIs; retry framework with exponential backoff; SAP Job Scheduler integration
2. **SAP HANA Cloud Database** — Z_JOB_TRACK, Z_BATCH_JOB, Z_BATCH_JOB_FAILURE_LOGS entities; set-based batch query pattern via POST /api/customers/batch; seed data for 100K customers / 125K contract accounts
3. **SAPUI5 Fiori Application** — 7 views: Home Dashboard (hero KPI: Customer Records Modernized), DUCI Operations Copilot, Create Job, Job Monitor, Failure Analysis, Executive Summary, Platform Insights; hosted on BTP HTML5 Repository
4. **DUCI Operations Copilot** — SAP Generative AI Hub-powered assistant for job creation, failure explanation, remediation recommendations, executive summaries; human-approval gate before any business action
5. **BTP Deployment Artifacts** — mta.yaml, xs-security.json, GitHub Actions CI/CD, deployment guide, demo guide, UAT scenarios, performance benchmark suite

#### Problem Statement

DUCI operations teams process bulk customer data changes manually or through fragile one-off scripts, resulting in high error rates, no visibility into processing status, no retry intelligence, and no ability to reuse logic across MAE transaction types. A reusable, monitored, AI-augmented framework is needed.

#### Affected User Roles

- Operations Manager (monitors batch jobs, reviews executive summaries)
- Data Operations Specialist (creates jobs, analyzes failures, triggers reprocessing)
- IT Administrator (manages platform, monitors HANA metrics)
- Executive Stakeholder (reviews KPI dashboards and executive summaries)

#### Important factors

##### Reusability eliminates framework code changes for new MAE types
The IBulkJobHandler interface + Factory pattern means new transaction types (future MAE variants) are added by implementing a handler class — no changes to the core engine.

##### Set-based HANA processing is mandatory for 100K-record performance
Large OData OR filters collapse under volume. The POST /api/customers/batch pattern with HANA set-based SQL (IN clauses / temp tables) is the correct architecture for 10K/50K/100K record batches.

##### Copilot must never execute without human approval
All copilot-generated job submissions require explicit user confirmation to prevent unintended mass data changes.

##### Simulation Mode enables safe demo and UAT
Simulation Mode processes records through all framework steps without committing changes, allowing safe performance benchmarking and demos.

#### Potential risks

##### S/4HANA API availability in customer landscape
Several utility-specific APIs were marked unavailable. The solution uses only the confirmed-available Business Partner and Contract Account OData APIs; future handlers must validate API availability before production use.

##### SAP Generative AI Hub model availability
Copilot quality depends on Gen AI Hub model availability and prompt engineering; fallback to structured form-based job creation must be implemented.

#### Recommended solution category

Custom CAP Application, SAPUI5 Fiori Application, AI Agent / Copilot (SAP Generative AI Hub)

#### Intent fit
97%
