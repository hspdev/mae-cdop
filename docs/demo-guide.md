# MAE Autonomous Customer Data Operations Platform
## DUCI Demo Guide

---

## Demo Overview

**Audience:** Utility company operations leaders, IT architects, business analysts  
**Duration:** 45-60 minutes  
**Scenario:** Allentown Mailing Address Campaign

---

## Primary Demo Scenario

> "Find all active customers in Allentown with address changes in the last 90 days and update customer records using the new mailing address campaign data."

---

## Demo Script

### Act 1: The Problem (5 min)

**Talking Points:**
- DUCI manages 100,000 customers across PA, NJ, DE
- Address changes occur constantly — move-ins, mail campaigns, NCOA updates
- Current process: manual extraction → Excel → manual S/4HANA updates → 40+ hours per campaign
- Error rate: ~8% requiring manual rework
- No audit trail, no progress visibility, no retry intelligence

**Show:** Home Dashboard with zero KPIs (before any jobs run)

---

### Act 2: DUCI Operations Copilot (10 min)

**Navigate to: Copilot**

1. Click "Create Allentown Job" suggested action chip
2. Show Copilot response — it understands the request and prepares job configuration
3. Highlight: **"Copilot NEVER executes without approval"** — show the approval gate
4. Show Copilot explaining what the job will do
5. Click "Approve and Execute"

**Key Message:** AI-assisted job creation with human-in-the-loop control

---

### Act 3: Job Creation & Monitoring (10 min)

**Navigate to: Create Job**

Manual demo (alternative to Copilot path):
1. Select **MAILING_ADDRESS_UPDATE**
2. Set filter: City = Allentown, Days Back = 90
3. Address Source = Use Existing Address History
4. Enable **Simulation Mode** for first run
5. Click Create Job

**Navigate to: Job Monitor**

Show real-time progress:
- Status: QUEUED → IN_PROGRESS → PROCESSING_TRANSACTION → COMPLETED
- Progress bar updating
- Live counts: Total / Processed / Success / Failed
- Current processing step indicator

**Key Message:** Full visibility into every step of bulk processing

---

### Act 4: Failure Analysis & AI Recovery (10 min)

**Navigate to: Failure Analysis** (select a partially completed job)

Show:
1. Error pattern analysis — top 3 error categories
2. Failed contract accounts with specific error messages
3. "Ask Copilot" → AI explains root causes in plain English
4. Copilot recommends: "8 of the 12 failures are due to locked accounts. Suggest retrying after 4 hours."
5. Click "Reprocess Failed" → new job created for only the 12 failed accounts

**Key Message:** AI-powered failure triage reduces rework from hours to minutes

---

### Act 5: Executive Summary (5 min)

**Navigate to: Executive Summary**

Show:
- Hero KPI: Customer Records Modernized
- Success Rate: 99.1%
- Hours Saved: 38.4 hours vs manual
- Cost Avoidance: $4,608 (estimated)
- Jobs breakdown by type

**Key Message:** Instant executive visibility — no manual reporting needed

---

### Act 6: Performance at Scale (5 min)

**Navigate to: Platform Insights**

Show benchmark table:
| Batch Size | Throughput | Duration |
|-----------|-----------|---------|
| 10K records | ~850 rec/sec | ~12 sec |
| 50K records | ~780 rec/sec | ~64 sec |
| 100K records | ~720 rec/sec | ~139 sec |

**Key Message:** Sub-3-minute processing for 100,000 records

---

### Act 7: Framework Extensibility (5 min — technical audience)

Show:
- HandlerFactory.js — register a new handler in one line
- IBulkJobHandler interface — 5 methods, consistent contract
- "Future MAE transactions require zero framework changes"

---

## Demo Data Reference

| Dataset | Count | Notes |
|---------|-------|-------|
| Total Customers | 100,000 | Realistic PA/NJ/DE utility data |
| Contract Accounts | 125,000 | 1.25x multiplier |
| Allentown Customers | ~12,000 | Primary demo city |
| 90-Day Address Changes | ~1,800 | Seeded for demo scenario |
| Failure Scenarios | 50 | Known error conditions |

**Allentown Demo Accounts:** See `db/data/allentown-demo-accounts.json`

---

## Troubleshooting During Demo

| Issue | Fix |
|-------|-----|
| Copilot shows fallback response | AI Core not configured — use structured UI path instead |
| Job stuck in QUEUED | Job Scheduler not bound — restart mae-cap-backend |
| No seed data visible | Run: `node scripts/seed-data.js --scenario=demo` |
| 100K job takes too long | Use simulation mode or reduce to 10K for demo |
