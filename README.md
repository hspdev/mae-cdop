# MAE Autonomous Customer Data Operations Platform

**Demo Utilities Company Inc. (DUCI)**  
SAP BTP Cloud Foundry | CAP Node.js | SAPUI5 Fiori | SAP HANA Cloud | SAP Generative AI Hub

---

## Overview

A reusable **MAE Bulk Job Processing Framework** for Demo Utilities Company Inc. that supports:
- ✅ Mailing Address Updates
- ✅ Contract Account Updates
- ✅ Customer Preference Updates
- ✅ Notification Requests
- ✅ Future MAE Transactions (zero framework changes required)

**Primary Demo Scenario:** *"Find all active customers in Allentown with address changes in the last 90 days and update customer records using the new mailing address campaign data."*

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SAP BTP Cloud Foundry                        │
│                                                                 │
│  ┌───────────────────┐      ┌──────────────────────────────┐   │
│  │  SAPUI5 Fiori App │      │      CAP Node.js Backend      │   │
│  │                   │      │                               │   │
│  │ • Dashboard       │─────▶│  /api/bulk-jobs/{jobType}    │   │
│  │ • Copilot         │      │  /api/customers/batch         │   │
│  │ • Create Job      │      │  /odata/v4/BulkJobService     │   │
│  │ • Job Monitor     │      │  /odata/v4/CopilotService     │   │
│  │ • Failure Analysis│      │                               │   │
│  │ • Exec Summary    │      │  IBulkJobHandler Framework    │   │
│  │ • Platform Insights│     │  ├── MailingAddressHandler    │   │
│  └───────────────────┘      │  ├── ContractAccountHandler   │   │
│                             │  ├── CustomerPreferenceHandler│   │
│                             │  └── NotificationHandler       │   │
│                             └──────────────┬─────────────────┘   │
│                                            │                     │
│              ┌─────────────────────────────┼──────────────┐     │
│              │                             │              │     │
│       SAP HANA Cloud              SAP Gen AI Hub    Job Scheduler│
│       Z_BATCH_JOB                 (Copilot)         (Scheduling) │
│       Z_JOB_TRACK                                               │
│       Z_BATCH_JOB_FAILURE_LOGS                                  │
│       Z_CUSTOMERS (100K)                                        │
│       Z_CONTRACT_ACCOUNTS (125K)                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites
- SAP BTP account with CF space
- Service entitlements: HANA Cloud, XSUAA, Destination, Job Scheduler, AI Core, HTML5 Repo
- Node.js 20+, `mbt`, `@sap/cds-dk`, CF CLI v8+

### Install & Seed
```bash
npm --prefix assets/mae-cap-backend ci
node assets/mae-cap-backend/scripts/seed-data.js --scenario=demo
```

### Local Development
```bash
cd assets/mae-cap-backend
cds watch
# CAP server: http://localhost:4004
# OData V4: http://localhost:4004/odata/v4/BulkJobService
# REST API:  http://localhost:4004/api
```

### Deploy to BTP
```bash
mbt build -p cf
cf deploy mta_archives/mae-cdop_1.0.0.mtar -f
```

---

## Framework APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/bulk-jobs/{jobType}` | Create and queue a bulk job |
| GET  | `/api/bulk-jobs/{batchId}/status` | Real-time job status |
| GET  | `/api/bulk-jobs/{batchId}/result` | Completed job results |
| POST | `/api/bulk-jobs/{batchId}/reprocess` | Reprocess failed records |
| POST | `/api/bulk-jobs/{batchId}/cancel` | Cancel queued/running job |
| POST | `/api/customers/batch` | Set-based customer retrieval (no OR filters) |

---

## Supported Job Types

| Job Type | Handler | Description |
|----------|---------|-------------|
| `MAILING_ADDRESS_UPDATE` | MailingAddressHandler | Update customer mailing addresses |
| `CONTRACT_ACCOUNT_UPDATE` | ContractAccountHandler | Update billing class, type, status |
| `CUSTOMER_PREFERENCE_UPDATE` | CustomerPreferenceHandler | Opt-in/out, language, timing |
| `NOTIFICATION_REQUEST` | NotificationHandler | Bulk email/SMS/mail dispatch |

---

## Job Status Lifecycle

```
QUEUED → IN_PROGRESS → COMPLETED
                    ↘ PARTIALLY_COMPLETED
                    ↘ FAILED → RETRYING → COMPLETED
              ↘ CANCELLED
```

---

## Performance

| Batch Size | Simulation Throughput | Real Mode Throughput |
|-----------|-----------------------|----------------------|
| 10K records | ~850 rec/sec | ~200 rec/sec |
| 50K records | ~780 rec/sec | ~180 rec/sec |
| 100K records | ~720 rec/sec | ~150 rec/sec |

---

## Repository Structure

```
mae-cdop/
├── solution.yaml                          # SAP Build solution descriptor
├── mta.yaml                               # MTA deployment descriptor
├── xs-security.json                       # XSUAA security config
├── intent.md                              # Business intent document
├── assets/
│   ├── mae-cap-backend/                   # CAP Node.js backend
│   │   ├── asset.yaml
│   │   ├── package.json
│   │   ├── server.js
│   │   ├── db/
│   │   │   ├── schema.cds                 # HANA entities
│   │   │   ├── data-model.cds             # CDS projections
│   │   │   └── src/procedures/            # HANA stored procedures
│   │   ├── srv/
│   │   │   ├── service.cds               # OData V4 service definitions
│   │   │   ├── bulk-job-service.js        # Service handler
│   │   │   ├── copilot-service.js         # Copilot handler
│   │   │   ├── rest-api.js               # REST endpoints
│   │   │   ├── handlers/
│   │   │   │   ├── IBulkJobHandler.js     # Framework interface
│   │   │   │   ├── HandlerFactory.js      # Factory + registry
│   │   │   │   ├── MailingAddressHandler.js
│   │   │   │   ├── ContractAccountHandler.js
│   │   │   │   ├── CustomerPreferenceHandler.js
│   │   │   │   └── NotificationHandler.js
│   │   │   └── lib/
│   │   │       ├── BulkJobEngine.js       # Job orchestration
│   │   │       ├── BatchQueryClient.js    # HANA set-based queries
│   │   │       └── RetryFramework.js      # Exponential backoff
│   │   ├── scripts/
│   │   │   └── seed-data.js              # Demo data generator
│   │   └── test/
│   │       ├── unit/                      # Unit tests
│   │       └── integration/               # Integration tests
│   └── mae-ui/                            # SAPUI5 Fiori application
│       ├── asset.yaml
│       ├── xs-app.json
│       └── webapp/
│           ├── manifest.json
│           ├── Component.js
│           ├── view/                      # 7 SAPUI5 views
│           ├── controller/               # 7 controllers
│           ├── service/                  # API service modules
│           ├── model/
│           └── i18n/
├── docs/
│   ├── business-architecture.md
│   ├── deployment-guide.md
│   ├── demo-guide.md
│   ├── uat-scenarios.md
│   ├── deployment-validation-checklist.md
│   └── performance-benchmark-suite.md
└── .github/
    └── workflows/
        └── ci-cd.yml                      # GitHub Actions CI/CD
```

---

## Documentation

| Document | Location |
|---------|---------|
| Business Architecture | `docs/business-architecture.md` |
| Deployment Guide | `docs/deployment-guide.md` |
| Demo Script | `docs/demo-guide.md` |
| UAT Scenarios | `docs/uat-scenarios.md` |
| Deployment Checklist | `docs/deployment-validation-checklist.md` |
| Performance Benchmarks | `docs/performance-benchmark-suite.md` |

---

## Security Roles

| Role Collection | Permissions |
|----------------|-------------|
| `DUCI_MAE_Operators` | Create, monitor, cancel, reprocess jobs + Copilot |
| `DUCI_MAE_Analysts` | View results, failure analysis, executive summary + Copilot |
| `DUCI_MAE_Admins` | Full access including admin OData service |

---

## Assumptions

1. S/4HANA API integration is via the available Business Partner and Contract Account OData APIs; utility-specific APIs (Multichannel Foundation) were not available in the customer landscape
2. Customer preference and notification data is managed locally in HANA (not via SAP Customer Data Cloud)
3. SAP Generative AI Hub (AI Core) is used for the Copilot; the application gracefully degrades to structured responses if AI Core is unavailable
4. HANA Cloud set-based SQL is used for all bulk operations; no large OData OR filters are used anywhere in the codebase
5. Bulk Payments are explicitly excluded per requirements
6. Simulation Mode processes all steps without HANA writes — safe for UAT and demos

---

*Built for Demo Utilities Company Inc. (DUCI) — MAE Autonomous Customer Data Operations Platform v1.0.0*
