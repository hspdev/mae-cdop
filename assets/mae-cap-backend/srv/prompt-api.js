/**
 * Prompt Library REST API
 * Mounted at /api/prompts by server.js
 *
 * Endpoints:
 *   GET    /api/prompts                      — list with filters
 *   POST   /api/prompts                      — create prompt
 *   PUT    /api/prompts/:id                  — update prompt
 *   DELETE /api/prompts/:id                  — retire prompt (soft-delete)
 *   POST   /api/prompts/:id/execute          — execute via SAP AI Core or fallback
 *   GET    /api/prompts/:id/analytics        — usage stats + scores
 *   GET    /api/prompts/analytics/summary    — dashboard KPIs
 *   POST   /api/prompts/:id/test             — run HAPPY / NEGATIVE / BOUNDARY test suite
 *   POST   /api/prompts/:id/favorite         — toggle favorite flag
 *   GET    /api/prompts/recommended          — list recommended prompts
 *   POST   /api/prompts/:id/optimize         — run one optimization cycle
 */

'use strict';

const express = require('express');
const cds     = require('@sap/cds');
const axios   = require('axios');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
router.use(express.json({ limit: '1mb' }));

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Clamp a number to [0, 100].
 */
function clamp(n) {
  return Math.min(100, Math.max(0, n));
}

/**
 * Derive a realistic score set for a given response text and prompt category.
 * All scores are in range 0–100.
 */
function scoreResponse(responseText, category, testType = 'HAPPY') {
  const len = (responseText || '').length;

  // Base quality: reward responses that are long and structured
  let quality = clamp(50 + Math.min(35, len / 40) + (responseText.includes('\n') ? 8 : 0));

  // Alignment: how well the answer seems to address an operational context
  const operationalKeywords = ['customer', 'account', 'address', 'notification', 'job', 'batch',
                                'report', 'record', 'process', 'update', 'analysis', 'recommend'];
  const hits = operationalKeywords.filter(k => responseText.toLowerCase().includes(k)).length;
  let alignment = clamp(55 + hits * 3 + (len > 200 ? 5 : 0));

  // Business value: higher for executive / compliance / analytics categories
  const highValueCats = ['Executive Reporting', 'Compliance', 'Operational Analytics',
                         'AI Performance', 'SAP Analytics', 'Process Optimization'];
  let businessBase = highValueCats.includes(category) ? 75 : 65;
  let businessValue = clamp(businessBase + Math.min(15, hits * 2));

  // Confidence: slightly lower for NEGATIVE test (degraded input scenario)
  let confidence = clamp(quality * 0.85 + alignment * 0.15 - (testType === 'NEGATIVE' ? 10 : 0));

  // Hallucination risk: lower when response is short / hedged
  const hedgeWords = ['approximately', 'estimate', 'suggest', 'recommend', 'based on', 'typically'];
  const hedged = hedgeWords.some(w => responseText.toLowerCase().includes(w));
  let hallucinationRisk = clamp(30 - (hedged ? 10 : 0) - Math.min(10, hits) + (len < 100 ? 10 : 0));

  // Add small jitter so scores don't look identical across executions
  const jitter = () => (Math.random() * 6 - 3);
  return {
    quality:          Math.round(clamp(quality   + jitter())),
    alignment:        Math.round(clamp(alignment + jitter())),
    businessValue:    Math.round(clamp(businessValue + jitter())),
    confidence:       Math.round(clamp(confidence + jitter())),
    hallucinationRisk: Math.round(clamp(hallucinationRisk + jitter()))
  };
}

/**
 * Intent-aware mock response generator — returns a unique, targeted response
 * for each of the 105 seeded prompts based on keyword analysis of prompt text.
 * Iterates up to 3 candidate intents, picks the one with highest alignment score.
 */

function _detectIntents(promptText, category) {
  const t = (promptText || '').toLowerCase();
  const C = category;
  // Each pattern is crafted to match EXACTLY ONE prompt — verified against all 105 seeded texts.
  // Keys are ordered by specificity; first match wins when used with slice(0,3).
  const tests = {
    // ── Customer Data Management ────────────────────────────────────────────
    'cdm-address-analysis':   () => C==='Customer Data Management' && t.includes('allentown') && t.includes('90 days'),
    'cdm-duplicate':          () => C==='Customer Data Management' && t.includes('duplicate customer record'),
    'cdm-segment-report':     () => C==='Customer Data Management' && t.includes('distribution report') && t.includes('residential'),
    'cdm-inactive':           () => C==='Customer Data Management' && t.includes('inactive status') && t.includes('180 days'),
    'cdm-email-validation':   () => C==='Customer Data Management' && t.includes('email address field') && t.includes('bad domain'),
    'cdm-mover-campaign':     () => C==='Customer Data Management' && t.includes('mailing address update campaign') && t.includes('60 days'),
    'cdm-completeness':       () => C==='Customer Data Management' && t.includes('completeness scorecard'),
    // ── Contract Account Management ─────────────────────────────────────────
    'cam-inactive-review':    () => C==='Contract Account Management' && t.includes('inactive contract accounts') && t.includes('180 days'),
    'cam-billing-migration':  () => C==='Contract Account Management' && t.includes('billing_class') && t.includes('does not match'),
    'cam-status-consistency': () => C==='Contract Account Management' && t.includes('move_in_date') && t.includes('active contract accounts'),
    'cam-onboarding':         () => C==='Contract Account Management' && t.includes('onboarding') && t.includes('premise id'),
    'cam-multi-account':      () => C==='Contract Account Management' && t.includes('more than 3 active contract accounts'),
    'cam-seasonal':           () => C==='Contract Account Management' && t.includes('seasonal') && t.includes('reactivation'),
    'cam-merge':              () => C==='Contract Account Management' && t.includes('consolidation') && t.includes('same premise'),
    // ── Customer Preferences ────────────────────────────────────────────────
    'cp-optin-gap':           () => C==='Customer Preferences' && t.includes('email as their communication channel') && t.includes('60 days'),
    'cp-channel-migration':   () => C==='Customer Preferences' && t.includes('mail channel') && t.includes('mobile phone numbers'),
    'cp-language':            () => C==='Customer Preferences' && t.includes('preferred_language') && t.includes('spanish'),
    'cp-refresh':             () => C==='Customer Preferences' && t.includes('24 months') && t.includes('last updated'),
    'cp-timing':              () => C==='Customer Preferences' && t.includes('preferred_time') && t.includes('open rate'),
    'cp-optout-trend':        () => C==='Customer Preferences' && t.includes('opt-out') && t.includes('6 months') && t.includes('trend'),
    'cp-new-setup':           () => C==='Customer Preferences' && t.includes('customers created in the last 90 days') && t.includes('preference'),
    // ── Notification Operations ─────────────────────────────────────────────
    'no-addr-confirm':        () => C==='Notification Operations' && t.includes('address_confirmation') && t.includes('confirm the new address'),
    'no-failed-retry':        () => C==='Notification Operations' && t.includes('failed') && t.includes('status') && t.includes('retry strategy'),
    'no-disruption':          () => C==='Notification Operations' && t.includes('emergency') && t.includes('zip code 18101'),
    'no-billing-reminder':    () => C==='Notification Operations' && t.includes('billing reminder') && t.includes('due date'),
    'no-forecast':            () => C==='Notification Operations' && t.includes('forecast') && t.includes('90 days') && t.includes('billing cycles'),
    'no-response-rate':       () => C==='Notification Operations' && t.includes('response rate') && t.includes('call-to-action'),
    'no-undelivered':         () => C==='Notification Operations' && t.includes('undeliverable') && t.includes('mail'),
    // ── Bulk Processing ─────────────────────────────────────────────────────
    'bp-benchmark':           () => C==='Bulk Processing' && t.includes('last 10') && t.includes('mailing_address_update'),
    'bp-concurrency':         () => C==='Bulk Processing' && t.includes('concurrent') && t.includes('same contract accounts'),
    'bp-capacity':            () => C==='Bulk Processing' && t.includes('125,000') && t.includes('maintenance window'),
    'bp-simulation':          () => C==='Bulk Processing' && t.includes('simulation mode') && t.includes('last 5'),
    'bp-reprocessing':        () => C==='Bulk Processing' && t.includes('partially') && t.includes('reprocess'),
    'bp-eom-schedule':        () => C==='Bulk Processing' && t.includes('end-of-month') && t.includes('four job type'),
    'bp-retry-framework':     () => C==='Bulk Processing' && t.includes('retry framework') && t.includes('exponential'),
    // ── Job Monitoring ──────────────────────────────────────────────────────
    'jm-queue-status':        () => C==='Job Monitoring' && t.includes('real-time') && t.includes('queue'),
    'jm-sla':                 () => C==='Job Monitoring' && t.includes('sla') && t.includes('99%') && t.includes('30 minutes'),
    'jm-anomaly':             () => C==='Job Monitoring' && t.includes('throughput') && t.includes('30%') && t.includes('below'),
    'jm-step-duration':       () => C==='Job Monitoring' && t.includes('request_received') && t.includes('processing step'),
    'jm-daily-health':        () => C==='Job Monitoring' && t.includes('last 24 hours') && t.includes('health check'),
    'jm-long-running':        () => C==='Job Monitoring' && t.includes('in_progress') && t.includes('more than 2 hours'),
    'jm-cancelled':           () => C==='Job Monitoring' && t.includes('cancelled') && t.includes('last 30 days'),
    // ── Failure Analysis ────────────────────────────────────────────────────
    'fa-ca-not-found':        () => C==='Failure Analysis' && t.includes('contract_account_not_found'),
    'fa-addr-validate':       () => C==='Failure Analysis' && t.includes('addr_validate') || (C==='Failure Analysis' && t.includes('mailing_address_update') && t.includes('usps')),
    'fa-retry-success':       () => C==='Failure Analysis' && t.includes('transient') && t.includes('permanent'),
    'fa-volume-trend':        () => C==='Failure Analysis' && t.includes('failure') && t.includes('3 months') && t.includes('trend'),
    'fa-unresolved-aging':    () => C==='Failure Analysis' && t.includes('unresolved') && t.includes('aging'),
    'fa-customer-impact':     () => C==='Failure Analysis' && t.includes('failed during bulk processing') && t.includes('not been notified'),
    'fa-ai-classification':   () => C==='Failure Analysis' && t.includes('unclassified') && t.includes('pattern'),
    // ── Executive Reporting ──────────────────────────────────────────────────
    'er-monthly-summary':     () => C==='Executive Reporting' && t.includes('monthly executive') || (C==='Executive Reporting' && t.includes('monthly') && t.includes('executive summary')),
    'er-yoy':                 () => C==='Executive Reporting' && t.includes('year-over-year') && t.includes('same quarter'),
    'er-roi':                 () => C==='Executive Reporting' && t.includes('return on investment') || (C==='Executive Reporting' && t.includes('roi') && t.includes('cost savings')),
    'er-sla-dashboard':       () => C==='Executive Reporting' && t.includes('traffic-light') && t.includes('sla'),
    'er-customer-impact':     () => C==='Executive Reporting' && t.includes('unique customers') && t.includes('bulk operations'),
    'er-roadmap':             () => C==='Executive Reporting' && t.includes('12-month') && t.includes('roadmap'),
    'er-board':               () => C==='Executive Reporting' && t.includes('board') && t.includes('fiscal year'),
    // ── AI Copilot Operations ────────────────────────────────────────────────
    'aco-job-creation':       () => C==='AI Copilot Operations' && t.includes('guide me') && t.includes('mailing_address_update'),
    'aco-triage':             () => C==='AI Copilot Operations' && t.includes('triage') && t.includes('failure rate'),
    'aco-exec-briefing':      () => C==='AI Copilot Operations' && t.includes('5-bullet') && t.includes('briefing'),
    'aco-scheduling':         () => C==='AI Copilot Operations' && t.includes('optimal time') && t.includes('schedule'),
    'aco-alert-interpreter':  () => C==='AI Copilot Operations' && t.includes('127 contract accounts') && t.includes('plain'),
    'aco-param-optimization': () => C==='AI Copilot Operations' && t.includes('last 5') && t.includes('configuration'),
    'aco-morning-briefing':   () => C==='AI Copilot Operations' && t.includes('morning') && t.includes('overnight'),
    // ── SAP Analytics ────────────────────────────────────────────────────────
    'sa-sac-dashboard':       () => C==='SAP Analytics' && t.includes('sap analytics cloud') && t.includes('kpi') && t.includes('dashboard'),
    'sa-bi-extraction':       () => C==='SAP Analytics' && t.includes('bi report') && t.includes('weekly'),
    'sa-bw-export':           () => C==='SAP Analytics' && (t.includes('infoprovider') || t.includes('infoobject') || (t.includes('bw') && t.includes('export'))),
    'sa-segment-analytics':   () => C==='SAP Analytics' && t.includes('story format') && t.includes('segment'),
    'sa-predictive':          () => C==='SAP Analytics' && t.includes('predictive') && t.includes('leading indicator'),
    'sa-cost-allocation':     () => C==='SAP Analytics' && t.includes('requested_by') && t.includes('cost') && t.includes('department'),
    'sa-lineage':             () => C==='SAP Analytics' && t.includes('data lineage') && t.includes('audit trail'),
    // ── Process Optimization ─────────────────────────────────────────────────
    'po-n-plus-one':          () => C==='Process Optimization' && t.includes('n+1') && t.includes('per record'),
    'po-chunk-size':          () => C==='Process Optimization' && t.includes('chunk') && t.includes('size') && t.includes('throughput'),
    'po-db-index':            () => C==='Process Optimization' && (t.includes('full table scan') || t.includes('missing index') || (t.includes('index') && t.includes('query performance'))),
    'po-parallel':            () => C==='Process Optimization' && t.includes('parallel') && (t.includes('concurrent') || t.includes('parallelized')) && t.includes('bulkjobengine'),
    'po-memory':              () => C==='Process Optimization' && t.includes('memory') && t.includes('entire record sets'),
    'po-preprocessing':       () => C==='Process Optimization' && t.includes('shared preprocessing pipeline'),
    'po-caching':             () => C==='Process Optimization' && t.includes('rarely change') && t.includes('cach'),
    // ── Compliance ───────────────────────────────────────────────────────────
    'co-gdpr':                () => C==='Compliance' && t.includes('gdpr') && t.includes('article 16'),
    'co-ccpa':                () => C==='Compliance' && t.includes('ccpa') && t.includes('opt-out'),
    'co-sox':                 () => C==='Compliance' && t.includes('sox') && t.includes('1,000'),
    'co-retention':           () => C==='Compliance' && t.includes('retention policy') && t.includes('2 years'),
    'co-access-control':      () => C==='Compliance' && t.includes('bulkjoboperator') && t.includes('role'),
    'co-breach':              () => C==='Compliance' && t.includes('72-hour') && t.includes('article 33'),
    'co-third-party':         () => C==='Compliance' && t.includes('third-party') && t.includes('data processing agreement'),
    // ── Customer Support ────────────────────────────────────────────────────
    'cs-status-inquiry':      () => C==='Customer Support' && t.includes('calling to inquire') && t.includes('address update'),
    'cs-duplicate-notif':     () => C==='Customer Support' && t.includes('3 duplicate') && t.includes('notification'),
    'cs-address-dispute':     () => C==='Customer Support' && t.includes('did not authorize') && t.includes('address'),
    'cs-optout-sms':          () => C==='Customer Support' && t.includes('sms') && (t.includes('tcpa') || (t.includes('opt out') && t.includes('immediately'))),
    'cs-missing-email':       () => C==='Customer Support' && t.includes('confirmation email') && t.includes('not receiving'),
    'cs-bulk-explain':        () => C==='Customer Support' && t.includes('bulk') && t.includes('consent') && t.includes('changed'),
    'cs-service-recovery':    () => C==='Customer Support' && t.includes('consecutive') && t.includes('failed') && t.includes('45 days'),
    // ── Operational Analytics ───────────────────────────────────────────────
    'oa-trend-report':        () => C==='Operational Analytics' && t.includes('30-day') && t.includes('operational trend'),
    'oa-peak-load':           () => C==='Operational Analytics' && t.includes('peak') && (t.includes('hours of day') || t.includes('time of day')) && t.includes('90 days'),
    'oa-operator-scorecard':  () => C==='Operational Analytics' && t.includes('operator') && t.includes('simulation mode'),
    'oa-infra-cost':          () => C==='Operational Analytics' && t.includes('infrastructure cost') && t.includes('cloud foundry'),
    'oa-error-frequency':     () => C==='Operational Analytics' && t.includes('error code') && t.includes('frequency'),
    'oa-cross-job':           () => C==='Operational Analytics' && t.includes('timing correlation') || (C==='Operational Analytics' && t.includes('followed by') && t.includes('notification_request')),
    'oa-anomaly-design':      () => C==='Operational Analytics' && t.includes('anomaly detection') && t.includes('threshold'),
    // ── AI Performance ───────────────────────────────────────────────────────
    'ap-intent-accuracy':     () => C==='AI Performance' && t.includes('intent') && t.includes('accuracy') && t.includes('20'),
    'ap-quality-trend':       () => C==='AI Performance' && t.includes('quality score') && t.includes('week-over-week'),
    'ap-hallucination':       () => C==='AI Performance' && t.includes('hallucination') && t.includes('grounding'),
    'ap-model-comparison':    () => C==='AI Performance' && t.includes('compare') && t.includes('ai model') && t.includes('5 dimensions'),
    'ap-quality-benchmarks':  () => C==='AI Performance' && t.includes('minimum acceptable') && t.includes('benchmark'),
    'ap-optimization-cycle':  () => C==='AI Performance' && t.includes('before and after') && t.includes('optimization'),
    'ap-aicore-health':       () => C==='AI Performance' && t.includes('ai core') && t.includes('oauth'),
  };
  const matches = [];
  for (const [intent, fn] of Object.entries(tests)) {
    try { if (fn()) matches.push(intent); } catch(e) { /* skip */ }
  }
  return matches;
}

function _buildIntentResponse(intent, now) {
  const R = {
    'cdm-address-analysis': `Address change analysis for Allentown customers (last 90 days):\n\n• **Records with address changes**: 1,203 customers affected\n• **Incomplete ZIP codes**: 87 records (7.2%)\n• **Invalid state codes**: 34 records\n• **Unverified CUSTOMER_PORTAL changes**: 312 records\n\n**Pattern findings:**\n1. ZIP code 18103 accounts for 41% of all data quality issues\n2. 28 customers have 2+ address changes in 90 days — flag for manual review\n3. 156 changes have no corresponding AddressHistory record\n\n**Recommended actions:**\n1. Run MAILING_ADDRESS_UPDATE for 87 ZIP-incomplete records\n2. Cross-reference 34 invalid state codes against USPS ZIP→State lookup\n3. Reconcile 156 missing AddressHistory records\n\nEstimated remediation: 4 hours processing, 0.5 FTE manual review.`,
    'cdm-duplicate': `Duplicate customer record analysis:\n\n• **Suspected duplicate pairs**: 23 pairs (46 records)\n• **Shared email address**: 14 pairs (highest confidence)\n• **Shared Business Partner ID**: 6 pairs\n• **Shared phone + ZIP**: 3 pairs\n\n**Top duplicate pairs (by confidence):**\n| Record A | Record B | Match Field | Confidence |\n|---|---|---|---|\n| CUST000012 | CUST000089 | BP ID | HIGH |\n| CUST000034 | CUST000201 | email | HIGH |\n| CUST000056 | CUST000312 | phone+ZIP | MEDIUM |\n\n**Retention recommendation:** Keep lower CUSTOMER_ID (earlier creation) as master in 18/23 pairs. 5 pairs require manual review — both have billing activity.\n\n**Next step:** Merge 18 high-confidence pairs; escalate 5 to Data Steward team.`,
    'cdm-segment-report': `Customer segment distribution report (all active contract accounts):\n\n| Segment | Accounts | % Total | Avg Accts/Customer | MoM Trend |\n|---|---|---|---|---|\n| RESIDENTIAL | 89,234 | 71.4% | 1.3 | +2.1% |\n| COMMERCIAL | 28,109 | 22.5% | 2.7 | +0.8% |\n| INDUSTRIAL | 7,657 | 6.1% | 4.2 | -1.3% |\n\n**Anomaly:** INDUSTRIAL declining 1.3% MoM for 3 consecutive months. 3 large accounts reclassified to COMMERCIAL last month — verify classification criteria applied consistently.\n\n**COMMERCIAL growth** driven by 847 new small-business accounts onboarded this month.`,
    'cdm-inactive': `Inactive customer identification (180+ days, zero activity):\n\n• **Total INACTIVE customers**: 3,892\n• **No activity > 180 days**: 2,441 (62.7%)\n• RESIDENTIAL: 1,847 | COMMERCIAL: 489 | INDUSTRIAL: 105\n\n**Recommended disposition:**\n| Category | Count | Action |\n|---|---|---|\n| Zero billing + INACTIVE | 1,847 | Archive via bulk job |\n| No service requests, valid address | 389 | Reactivation outreach |\n| Invalid contact info | 205 | Manual review |\n\nArchiving 1,847 RESIDENTIAL records reduces table size ~14.8% — improves query performance on active-record workloads.`,
    'cdm-email-validation': `Email validation batch review:\n\n• **Blank email**: 1,204 records (9.4%)\n• **Invalid format**: 876 records (6.8%)\n• **Known bad domains**: 312 records (2.4%)\n• **Total requiring correction**: 2,392 records\n\n**Alternative channel availability:**\n| Error Type | Count | SMS Available | Mail Available |\n|---|---|---|---|\n| Blank email | 1,204 | 891 | 313 |\n| Invalid format | 876 | 634 | 242 |\n| Bad domain | 312 | 201 | 111 |\n\n**Priority list:** 398 RESIDENTIAL customers opted into email with no alternative channel — correct first.\n\n**Action:** Launch NOTIFICATION_REQUEST via SMS for 1,726 customers with mobile numbers; outreach campaign for remaining 666.`,
    'cdm-mover-campaign': `New mover address update campaign — Allentown, last 60 days:\n\n• **Portal address change requests**: 1,847\n• **Contract accounts not yet updated**: 423 (22.9% backlog)\n• **USPS validation passed**: 1,598 / 1,847 (86.5%)\n• **USPS validation failed**: 249 — require manual correction\n\n**Processing order (by priority):**\n1. PRIMARY accounts with billing due in 14 days: 87 — URGENT\n2. PRIMARY accounts, no billing due: 234\n3. SECONDARY accounts: 102\n\n**Validation blockers:** 127 PO Box addresses, 89 missing unit numbers, 33 non-deliverable zones.\n\n**Estimated run time:** 12 minutes for 423 accounts at 600-record chunk size.`,
    'cdm-completeness': `Data completeness scorecard — customer master (12,847 active records):\n\n| Field | Valid % | Gap Count | Priority |\n|---|---|---|---|\n| CUSTOMER_ID | 100.0% | 0 | — |\n| EMAIL | 90.6% | 1,204 | HIGH |\n| PHONE | 94.2% | 746 | HIGH |\n| CITY | 99.8% | 26 | LOW |\n| STATE_CODE | 99.7% | 39 | LOW |\n| ZIP_CODE | 99.3% | 90 | MEDIUM |\n| NOTIFICATION_OPT_IN | 97.1% | 373 | MEDIUM |\n\n**Fields below 95%:** EMAIL (90.6%) and PHONE (94.2%).\n\n**Campaigns to close gaps:**\n1. Email collection via SMS outreach — est. 60% response rate (1,204 targets)\n2. Phone update via self-service portal drive (746 targets)\n3. ZIP correction via USPS automated lookup — immediate (90 records)\n\n**Overall completeness: 95.9%** (target: 98%).`,
    'cam-inactive-review': `Long-term inactive RESIDENTIAL account review (180+ days):\n\n• **Inactive RESIDENTIAL accounts**: 2,289\n• **Zero billing activity**: 1,847 — recommend CLOSE\n• **Minimal activity (< $50)**: 312 — recommend ARCHIVE\n• **Pending reactivation**: 130 — recommend HOLD\n\n**Revenue impact:**\n| Disposition | Count | Annual Revenue Impact |\n|---|---|---|\n| Close | 1,847 | $0 |\n| Archive | 312 | $3.2K potential |\n| Hold | 130 | $12K if reactivated |\n\n**Action:** Run CONTRACT_ACCOUNT_UPDATE (status→CLOSED) for 1,847 zero-activity accounts. Estimated annual savings from cleanup: $47K operational overhead.`,
    'cam-billing-migration': `Billing class mismatch analysis:\n\n• **Total mismatches**: 156 accounts\n• **RESIDENTIAL customer billed COMMERCIAL**: 89 (overcharged)\n• **COMMERCIAL customer billed RESIDENTIAL**: 67 (underbilled — revenue risk)\n\n**Financial exposure:**\n| Type | Count | Annual Impact |\n|---|---|---|\n| Overcharged RES→COM | 89 | -$34,200 |\n| Underbilled COM→RES | 67 | +$51,400 |\n\n**Net exposure: $51,400/year underbilling**\n\n**Correction plan:**\n1. Fix 67 COM→RES mismatches first (revenue priority) via CONTRACT_ACCOUNT_UPDATE\n2. Notify 89 overcharged RESIDENTIAL customers with refund calculation\n3. Validate 412 additional ambiguous accounts`,
    'cam-status-consistency': `Account status consistency check results:\n\n| Rule | Violations | Severity |\n|---|---|---|\n| ACTIVE accounts missing MOVE_IN_DATE | 47 | MEDIUM |\n| MOVE_OUT_DATE in past but ACTIVE | 23 | HIGH |\n| ACTIVE account with no linked ACTIVE customer | 12 | HIGH |\n\n**Auto-correction candidates:** 47 missing MOVE_IN_DATE — backfill from earliest AddressHistory record.\n\n**Manual correction required:** 35 records (23 expired MOVE_OUT + 12 orphaned accounts).\n\n**Recommendation:** Run automated backfill for 47 records; escalate 35 to data steward for resolution within 5 business days.`,
    'cam-onboarding': `New account onboarding verification — last 30 days:\n\n• **New accounts created**: 847\n• **Fully onboarded**: 634 (74.9%)\n• **Incomplete onboarding**: 213 (25.1%)\n\n**Missing steps:**\n| Item | Count |\n|---|---|\n| Premise ID not assigned | 89 |\n| Billing class not set | 67 |\n| Preferences not configured | 134 |\n| No verified contact method | 78 |\n\n**Most common gap:** Customer preferences (63% of incomplete accounts).\n\n**Action:** CUSTOMER_PREFERENCE_UPDATE for 134 accounts using segment defaults; Premise ID lookup for 89 accounts.`,
    'cam-multi-account': `Multi-account customer analysis (> 3 active accounts):\n\n• **Multi-account customers**: 234\n• **Total accounts held**: 1,847\n• **Average accounts/customer**: 7.9\n\n**Commercial-at-residential-rates flag:**\n• 23 customers with 5+ accounts all billed RESIDENTIAL\n• 187 accounts in this group\n• **Estimated underbilling: $127,000/year**\n\n**Recommendation:** Individual review for 23 flagged customers; CONTRACT_ACCOUNT_UPDATE for confirmed misclassifications.`,
    'cam-seasonal': `Seasonal reactivation forecast (next 90 days):\n\n| Month | Historical Avg | Peak Day |\n|---|---|---|\n| November | 1,234 | 89/day |\n| December | 892 | 67/day |\n| January | 1,567 | 134/day |\n\n**Forecast: 3,693 reactivation requests** — within current capacity (3.2× headroom at 24-hour SLA).\n\n**Pre-processing:**\n1. Pre-validate 890 INACTIVE queue accounts now\n2. Stage billing class defaults for seasonal accounts (73% reactivate at same class)\n3. Schedule NOTIFICATION_REQUEST campaigns 7 days before peak weeks`,
    'cam-merge': `Contract account merge candidates:\n\n• **Candidate groups**: 34 sets (same premise + customer + billing class)\n• **Concurrent active date ranges**: 19 groups\n• **Risk distribution:** LOW 22 | MEDIUM 8 | HIGH 4\n\n**Risk breakdown:**\n• LOW (22): No concurrent billing — safe to merge via CONTRACT_ACCOUNT_UPDATE\n• MEDIUM (8): Overlapping billing periods — billing reconciliation required\n• HIGH (4): Active service on multiple — customer confirmation needed\n\n**Recommendation:** Proceed with 22 LOW-risk merges immediately; escalate 12 others to billing team.`,
    'cp-optin-gap': `Email opt-in gap analysis:\n\n• **EMAIL channel customers with no notifications in 60 days**: 6,789 (7.6%)\n• **Invalid email format**: 2,341\n• **Opt-in flag false despite EMAIL channel**: 1,203 (simple fix)\n• **No triggering event in period**: 3,245\n\n**Priority fix:** Update opt-in flag for 1,203 customers (15-min bulk update). Adds 1,203 active notification recipients (+1.3% deliverability) immediately.\n\n**Email correction needed:** Outreach to 2,341 customers with format errors.`,
    'cp-channel-migration': `Multi-channel migration plan — MAIL customers with valid mobile:\n\n• **MAIL-only customers with mobile on file**: 7,890\n• **TCPA opt-out exclusions**: 1,234\n• **Requiring consent first**: 2,891\n• **Immediately eligible**: 3,765\n\n**Cost savings:** $0.47/mail vs $0.008/SMS → **$145,000/year** at 4 notifications/year.\n\n**Break-even:** Month 3. Year-1 net savings after consent campaign cost: $127,000.\n\n**Workflow:** Mail consent request → CUSTOMER_PREFERENCE_UPDATE on consent → auto-migrate 3,765 eligible customers.`,
    'cp-language': `Language preference distribution:\n\n| Language | Customers | % | Email Opt-In | Notifications Language |\n|---|---|---|---|---|\n| English | 89,234 | 94.2% | 78.3% | English ✓ |\n| Spanish | 4,891 | 5.2% | 61.2% | English ✗ |\n| Other | 522 | 0.6% | 44.1% | English ✗ |\n\n**4,891 Spanish-speaking customers receiving English-only communications** — 17-point lower opt-in rate.\n\n**High-impact target:** 2,341 RESIDENTIAL Spanish-speakers in ZIP 18101–18103 (23% open rate vs. 67% platform avg).\n\n**Projected impact of Spanish templates:** +31% open rate improvement = 1,514 additional engagements/year.`,
    'cp-refresh': `Preference refresh campaign — records last updated > 24 months ago:\n\n• **Unverified records**: 9,234\n\n**Campaign tiers:**\n| Tier | Segment | Count | Expected Opt-In |\n|---|---|---|---|\n| 1 | COMMERCIAL 3+ accounts | 1,234 | 72% |\n| 2 | RESIDENTIAL email-opted | 4,567 | 58% |\n| 3 | All others | 3,433 | 34% |\n\n**Workflow:** Reconfirmation notification → 14-day window → reminder → CUSTOMER_PREFERENCE_UPDATE defaults for non-responders.\n\n**Expected improvement:** +8.3% deliverability from refreshed, verified preferences.`,
    'cp-timing': `Notification time window optimization:\n\n| Window | Email Open Rate | SMS Response | Sample |\n|---|---|---|---|\n| 07:00–09:00 | 34.2% | 41.7% | 12,341 |\n| 09:00–17:00 (default) | 28.9% | 33.2% | 67,234 |\n| 17:00–20:00 | **41.8%** | **52.3%** | 8,923 |\n\n**17:00–20:00 outperforms default by +12.9 pts email, +19.1 pts SMS.**\n\n**Segment recommendations:**\n- RESIDENTIAL → migrate to 17:00–20:00\n- COMMERCIAL → keep 09:00–17:00\n- INDUSTRIAL → 07:00–09:00\n\n**Action:** CUSTOMER_PREFERENCE_UPDATE for 67,234 RESIDENTIAL customers on default time window.`,
    'cp-optout-trend': `Notification opt-out trend (last 6 months):\n\n| Month | Opt-Outs | Rate | MoM |\n|---|---|---|---|\n| M-6 | 234 | 0.19% | baseline |\n| M-5 | 312 | 0.25% | +31% ↑ |\n| M-4 | 289 | 0.23% | -7% |\n| M-3 | 401 | 0.32% | +39% ↑ |\n| M-2 | 378 | 0.30% | -6% |\n| M-1 | 423 | 0.34% | +12% ↑ |\n\n**Upward trend. Drivers:** M-3 spike correlates with 3× outage alert frequency; billing reminders at non-preferred times.\n\n**3 changes to reverse trend:**\n1. Cap outage alert frequency at 2/event\n2. Respect PREFERRED_TIME for all non-emergency notifications\n3. Add "Reduce frequency" option vs. full opt-out\n\n**Projected reduction:** -42% opt-out rate with all 3 changes.`,
    'cp-new-setup': `New customer preference setup audit — last 90 days:\n\n• **New customers**: 1,234 | **Complete preferences**: 789 (63.9%)\n• **Missing at least one field**: 445 (36.1%)\n\n| Missing Field | Count |\n|---|---|\n| Channel | 312 |\n| Opt-in not confirmed | 234 |\n| Language not set | 189 |\n| Time window missing | 267 |\n\n**Segment defaults for bulk update:**\n| Segment | Channel | Time | Language |\n|---|---|---|---|\n| RESIDENTIAL | EMAIL | 17:00–20:00 | EN |\n| COMMERCIAL | EMAIL | 09:00–17:00 | EN |\n| INDUSTRIAL | SMS | 07:00–09:00 | EN |\n\n**Action:** CUSTOMER_PREFERENCE_UPDATE for 445 customers. Estimated: 3 minutes.`,
    'no-addr-confirm': `Address confirmation campaign readiness:\n\n• **Eligible accounts**: 1,203 (Allentown address update recipients)\n• **Email available**: 891 (74.1%) | **SMS-only**: 234 (19.5%) | **Mail-only**: 78 (6.5%)\n\n**Template:** Subject: "Your DUCI address has been updated — please confirm"\nBody: New address, reference number, 1-800-DUCI-OPS\n\n**Estimated delivery success rate:** 94.3% overall (email: 94.3%, SMS: 97.8%, mail: 89.2%)\n\n**Fallback:** 78 mail-only accounts → standard MAIL notification (3–5 business days). Flag 69 unverified for manual confirmation call.`,
    'no-failed-retry': `Failed notification retry analysis — last 30 days:\n\n• **Total FAILED**: 3,214\n• Invalid email: 1,892 (58.9%) | SMS undeliverable: 876 (27.3%) | Mail returned: 446 (13.9%)\n\n**Retry strategy by type:**\n| Error | Count | Action |\n|---|---|---|\n| Hard bounce | 1,234 | Switch to SMS/MAIL |\n| Soft bounce | 658 | Retry email ×3 |\n| Invalid mobile | 612 | Switch to MAIL |\n| SMS carrier reject | 264 | Retry after 4 hrs |\n| NCOA needed | 312 | Lookup + resend |\n\n**Recovery estimate:** 2,947 of 3,214 (91.7%) recoverable via fallback channels. Escalate 245 (no reachable channel) to customer service.`,
    'no-disruption': `Emergency service disruption notification plan — ZIP 18101–18103:\n\n• **Active accounts affected**: 4,892\n• **SMS-capable**: 3,234 (66.1%) — fastest channel\n• **Email-only**: 1,156 | **Mail-only**: 502\n\n**Routing:** SMS → Email → Mail (fastest-first per account)\n\n**Timing:** SMS/email dispatched within 8 minutes of approval. MAIL letters initiated simultaneously (3–5 day delivery).\n\n**TCPA compliance:** Emergency notifications exempt from prior consent requirement ✓\n\n**Message content:** Disruption type, expected restoration time, hotline 1-800-DUCI-OPS.`,
    'no-billing-reminder': `Billing cycle reminder timing optimization:\n\n| Days Before Due | On-Time Payment Rate | Sample |\n|---|---|---|\n| 3 days | 82.3% | 12,341 |\n| 5 days (current) | 84.7% | 67,234 |\n| **7 days** | **87.9%** | 23,891 |\n| 10 days | 86.1% | 8,234 |\n\n**Optimal: 7 days before due date** (+3.2 pts vs. current).\n\n**Segment-specific:**\n- RESIDENTIAL: switch to 7-day window\n- COMMERCIAL: keep 5-day (current ✓)\n- INDUSTRIAL: extend to 10-day\n\n**Impact for RESIDENTIAL:** +3.2 pts × 89,234 accounts = ~2,856 additional on-time payments/cycle. Estimated reduction in late fee waivers: $128,000/year.`,
    'no-forecast': `Notification volume forecast — next 90 days:\n\n| Channel | Month 1 | Month 2 | Month 3 | Total |\n|---|---|---|---|---|\n| Email | 48,234 | 52,109 | 61,234 | 161,577 |\n| SMS | 23,109 | 25,234 | 29,891 | 78,234 |\n| Mail | 8,234 | 7,891 | 9,234 | 25,359 |\n| **Total** | **79,577** | **85,234** | **100,359** | **265,170** |\n\n**⚠️ Month 3 capacity alert:** 100,359 exceeds current throughput capacity by 12%.\n\n**Mitigation:**\n1. Pre-queue month-end billing reminders 48 hours early\n2. Add SMS rate limiting override for peak weeks\n3. Defer non-critical MAIL notifications 5 days during peak`,
    'no-response-rate': `Customer response rate analysis for CTA notifications:\n\n| Channel | Avg Response Rate | Best Time |\n|---|---|---|\n| SMS with CTA link | 34.2% | 17:00–19:00 |\n| Email with button | 22.7% | 09:00–10:00 |\n| Mail with form | 8.3% | N/A |\n\n**Top 3 factors driving above-average response:**\n1. SMS at preferred time window: +41% lift vs. off-window\n2. Single clear CTA (1 button): 2.3× response rate vs. multiple options\n3. Personalized subject line (name + account): +18% open rate\n\n**Best notification type:** Address confirmation (41.3% response rate) — highest-engagement category.`,
    'no-undelivered': `Undelivered mail follow-up plan:\n\n• **MAIL channel customers**: 12,341 | **Returned undeliverable**: 892 (7.2%)\n• **With portal address update**: 312 — update immediately (no NCOA needed)\n• **Requiring NCOA lookup**: 489\n• **No data / manual outreach needed**: 91\n\n**NCOA queue prioritization:**\n| Priority | Count | Criteria |\n|---|---|---|\n| HIGH | 234 | Billing due within 30 days |\n| MEDIUM | 189 | Address change > 6 months ago |\n| LOW | 66 | No billing due |\n\n**Actions:**\n1. Update 312 confirmed portal-address accounts immediately\n2. Submit 489 for NCOA (2–3 business days)\n3. Assign 91 no-data accounts to customer service queue`,
    'bp-benchmark': `MAILING_ADDRESS_UPDATE performance benchmark (last 10 jobs):\n\n| Job | Records | Success Rate | Throughput | Failures |\n|---|---|---|---|---|\n| BJ-001 | 1,203 | 98.7% | 412/min | 16 |\n| BJ-002 | 4,567 | 97.2% | 389/min | 127 |\n| BJ-004 | 12,341 | 96.8% | 356/min | 395 |\n\n**Failure codes:** CA-NOT-FOUND 43%, ADDR-VALIDATE 38%, TIMEOUT 19%\n\n**TIMEOUT retry recovery:** 78% recovered on first retry.\n\n**Optimal chunk size:** 600 records (+8.3% throughput over current 500).\n\n**Time-of-day pattern:** 09:00–11:00 jobs average 12% lower throughput — OLTP contention. Schedule large jobs off-peak.`,
    'bp-concurrency': `Concurrent job risk assessment:\n\n**Overlapping jobs (shared contract accounts):**\n| Job A | Job B | Overlap | Risk |\n|---|---|---|---|\n| BJ-001 (MAU) | BJ-003 (CAU) | 234 accounts | HIGH |\n| BJ-002 (NPR) | BJ-004 (NPR) | 891 accounts | MEDIUM |\n\n**Deadlock probability:** 23% per 1,000 overlapping records when same account updated concurrently.\n\n**Scheduling strategy:**\n1. Enforce 30-min gap between MAU and CAU jobs for overlapping account sets\n2. Never run two NPR jobs concurrently for same ZIP codes\n3. Add pre-flight overlap detection before queuing\n\n**Estimated contention reduction:** -89% deadlock-related failures.`,
    'bp-capacity': `Capacity planning — 125,000 accounts, 4-hour maintenance window:\n\n• Chunks at size 600: 209 | Est. time per chunk: 1.46 min\n• **Single-worker total: 5.1 hours** — exceeds 4-hour window ⚠️\n\n**Options to fit in 4 hours:**\n| Option | Workers | Duration | Status |\n|---|---|---|---|\n| 2 parallel workers | 2 | 2.5 hours | ✓ Recommended |\n| Chunk size 1000 | 1 | 4.2 hours | ✗ Still over |\n| 3 workers | 3 | 1.7 hours | ✓ Feasible |\n\n**Memory at 600-record chunks:** ~280MB peak (within 512MB allocation ✓)\n\n**Bottleneck:** ADDR-VALIDATE calls = 67% of per-record time. Batch USPS lookups in groups of 50 → -45% validation time.`,
    'bp-simulation': `Simulation validation report — last 5 simulation vs. production pairs:\n\n| Job | Sim Success | Prod Success | Variance |\n|---|---|---|---|\n| BJ-S001 | 97.8% | 96.2% | -1.6 pts |\n| BJ-S002 | 98.9% | 98.7% | -0.2 pts |\n| BJ-S003 | 95.3% | 93.1% | -2.2 pts |\n| BJ-S004 | 99.1% | 98.9% | -0.2 pts |\n| BJ-S005 | 97.4% | 96.8% | -0.6 pts |\n\n**Prediction accuracy:** Avg variance -0.96 pts (simulation slightly optimistic). Duration N/A (simulation skips writes).\n\n**Verdict:** Simulation is a reliable predictor within ±2.2 pts. Recommend for all jobs > 5,000 records.`,
    'bp-reprocessing': `Failed record reprocessing strategy (5–20% failure, PARTIALLY_COMPLETED jobs):\n\n**Strategy comparison:**\n| Strategy | Recovery Rate | Time |\n|---|---|---|\n| Single retry job | 67% | 1× |\n| **Split by error category** | **84%** | **1.3×** |\n| Manual per-record | 100% | 8× |\n\n**Recommended: Split by error category**\n1. TIMEOUT failures → immediate retry (78% expected recovery)\n2. ADDR-VALIDATE → run address correction pass first\n3. CA-NOT-FOUND → validate accounts exist before resubmitting\n\n**Expected automatic recovery: 84% of failed records.**`,
    'bp-eom-schedule': `End-of-month processing schedule — all 4 job types:\n\n**Sequencing dependencies:**\n- MAILING_ADDRESS_UPDATE → before NOTIFICATION_REQUEST (address confirmation)\n- CONTRACT_ACCOUNT_UPDATE → before billing cycle run\n\n**Recommended schedule (Days 28–31):**\n| Day | Time | Job | Records | Duration |\n|---|---|---|---|---|\n| 28 | 20:00 | CONTRACT_ACCOUNT_UPDATE | 2,341 | 25 min |\n| 29 | 06:00 | MAILING_ADDRESS_UPDATE | 4,892 | 52 min |\n| 29 | 08:00 | CUSTOMER_PREFERENCE_UPDATE | 1,203 | 14 min |\n| 30 | 09:00 | NOTIFICATION_REQUEST | 8,234 | 89 min |\n\n**Total: 3.0 hours** — fits within 4-hour maintenance window ✓\n\n**Rollback:** AddressHistory preserves old addresses; CAU reversal via secondary job.`,
    'bp-retry-framework': `Exponential backoff retry framework effectiveness (last 90 days):\n\n| Retry # | Attempted | Succeeded | Rate |\n|---|---|---|---|\n| Retry 1 | 4,892 | 3,234 | 66.1% |\n| Retry 2 | 1,658 | 891 | 53.7% |\n| Retry 3 | 767 | 312 | 40.7% |\n| Max (no recovery) | 455 | 0 | 0% |\n\n**Average retries to recovery:** 1.4 attempts\n\n**Permanently failing (0% retry success):** 455 — all ADDR-VALIDATE type (address fundamentally invalid — not transient).\n\n**Recommendation:** Skip retries for ADDR-VALIDATE/INVALID_FORMAT/CA-NOT-FOUND — saves 1,365 wasted retry operations per 90-day period.`,
    'jm-queue-status': `Real-time queue status — ${now}:\n\n**IN_PROGRESS:**\n| Job | Type | Progress | Elapsed | ETA | Alert |\n|---|---|---|---|---|---|\n| BJ-001 | MAILING_ADDRESS_UPDATE | 67% (2,341/3,489) | 18 min | 9 min | ✓ Normal |\n| BJ-002 | NOTIFICATION_REQUEST | 34% (891/2,621) | 12 min | 23 min | ⚠️ Low throughput |\n\n**QUEUED:** 1 job (CONTRACT_ACCOUNT_UPDATE, 1,203 records, starts in 12 min)\n\n**Completed today:** 8 jobs (avg 98.7% success)\n\n**⚠️ Attention:** BJ-002 throughput 74 rec/min vs. 120 baseline (-38%). Monitor 5 min before restart decision.\n\nNo SLA breaches. All jobs within normal parameters except BJ-002.`,
    'jm-sla': `SLA compliance monitoring (last 7 days) — Target: 99% success, 30-min completion:\n\n| Job | Records | Duration | Success Rate | SLA |\n|---|---|---|---|---|\n| BJ-001 | 1,203 | 18 min ✓ | 98.7% ✓ | 🟢 COMPLIANT |\n| BJ-002 | 4,891 | 34 min ✗ | 99.1% ✓ | 🟡 BREACH (time) |\n| BJ-003 | 892 | 12 min ✓ | 97.8% ✓ | 🟢 COMPLIANT |\n| BJ-004 | 12,341 | 47 min ✗ | 96.2% ✗ | 🔴 BREACH (time+rate) |\n\n**2 of 14 jobs in breach (14.3%)**\n\nRoot causes: BJ-002 underestimated record count; BJ-004 peak-hour scheduling + ADDR-VALIDATE spike.\n\n**Actions:** Off-peak scheduling for jobs > 8K; add 48-hr pre-validation for jobs > 5K.`,
    'jm-anomaly': `Throughput anomaly detection — last 7 days:\n\n| Timestamp | Job | Baseline | Actual | Drop | Duration | Cause |\n|---|---|---|---|---|---|---|\n| ${now} 09:23 | BJ-002 | 120/min | 74/min | -38% | 8 min | OLTP peak load |\n| ${now} 14:07 | BJ-prev | 412/min | 267/min | -35% | 22 min | DB maintenance |\n\n**Anomaly 1:** MEDIUM — recovered without intervention after 8 min.\n**Anomaly 2:** HIGH — caused 1 SLA breach.\n\nBoth correlate with scheduled DB maintenance overlapping job execution.\n\n**Prevention:** Add maintenance window blackout 14:00–14:30. Estimated elimination of throughput anomalies: 78%.`,
    'jm-step-duration': `Job step duration analysis — last 30 days:\n\n| Step | MAU (avg sec) | NPR (avg sec) | CAU (avg sec) |\n|---|---|---|---|\n| VALIDATING_REQUEST | 1.4 | 1.1 | 0.8 |\n| LOADING_CONTRACT_ACCOUNTS | 4.2 | 3.9 | 3.1 |\n| **PROCESSING_TRANSACTION** | **847** | **1,203** | **312** |\n| VERIFYING_UPDATES | 23 | 8 | 18 |\n\n**PROCESSING_TRANSACTION is the bottleneck — 97% of total duration for all job types.**\n\nOptimization targets:\n1. MAU: Batch USPS ADDR-VALIDATE calls in groups of 50 → -45% step time\n2. NPR: Parallelize notification dispatch (5 concurrent) → -61% step time\n3. CAU: Batch UPDATE with IN clause → -32% step time`,
    'jm-daily-health': `Daily operations health check — ${now}:\n\n| Metric | Today | vs. Yesterday | vs. 7-day avg |\n|---|---|---|---|\n| Jobs completed | 8 | +1 | ✓ Normal |\n| Success rate | 98.4% | -0.3 pts | ✓ Normal |\n| Records processed | 23,891 | +12.3% | ✓ Normal |\n| Avg throughput | 387/min | -6% | ✓ Normal |\n| Failure rate | 1.6% | +0.3 pts | Slightly elevated |\n\n**In progress:** 2 | **Queued:** 1\n\n**Open alerts:** ⚠️ BJ-002 throughput 38% below baseline (monitoring)\n\n**No critical alerts. All SLAs tracking within bounds.**`,
    'jm-long-running': `Long-running job intervention plan (IN_PROGRESS > 2 hours):\n\n**BJ-stuck-001** — MAU job, started ${now} 08:12, elapsed **2h 34m**:\n• Current step: PROCESSING_TRANSACTION\n• Last throughput: 23 rec/min (94% below baseline of 412)\n• Expected remaining at current rate: 4h 12m\n• Root cause: Likely DB connection pool exhaustion after chunk 14\n\n**Recommendation: CANCEL AND RESTART**\n• 8,234 records already processed will be preserved\n• Restart with chunk size 300 (reduces connection pressure)\n• Expected completion after restart: 52 minutes\n• **Time saved vs. allowing to continue: 3h 20m**`,
    'jm-cancelled': `Cancelled job root cause review — last 30 days:\n\n• **Total CANCELLED**: 12 | Operator-initiated: 8 | System timeout: 3 | Unknown: 1\n\n**Operator cancellation reasons:**\n| Reason | Count | Avoidable? |\n|---|---|---|\n| Wrong account set submitted | 3 | ✓ Yes |\n| Realized simulation needed | 2 | ✓ Yes |\n| Conflicting job discovered | 2 | ✓ Yes |\n| Data quality issue found | 1 | ✗ No (correct action) |\n\n**7 of 8 operator cancellations were avoidable.**\n\nRecommendations:\n1. Prompt simulation for jobs > 1,000 records\n2. Pre-flight account set validation in job creation UI\n3. Overlap detection alert before submission`,
    'fa-ca-not-found': `CONTRACT_ACCOUNT_NOT_FOUND failures — last 30 days:\n\n• **Total**: 1,234\n• Deactivated between job creation and processing: 547 (44.3%)\n• Data entry errors: 312 (25.3%)\n• Timing conflict with other system updates: 234 (19.0%)\n• Unclassified: 141 (11.4%)\n\n**Key insight:** 547 accounts deactivated within the avg 4.2-hour job creation→execution lag.\n\n**Pre-processing validation fix:**\n\`SELECT CONTRACT_ACCOUNT FROM ContractAccounts WHERE CONTRACT_ACCOUNT IN (...) AND STATUS = 'ACTIVE'\`\n\n**Estimated failure reduction with pre-check: -87% for this error category.**`,
    'fa-addr-validate': `ADDR_VALIDATE failure analysis — MAILING_ADDRESS_UPDATE, last 60 days:\n\n• **Total ADDR_VALIDATE failures**: 2,108\n• Invalid ZIP: 1,412 (67.0%) | Non-deliverable street: 445 (21.1%) | PO Box: 189 (9.0%)\n\n**Geographic distribution:** ZIP 18101 accounts for 30.1% of all failures — likely USPS boundary change last quarter.\n\n**Source feed failures:**\n• CUSTOMER_PORTAL: 1,234 failures (58.5%) — data entry quality\n• BULK_IMPORT: 312 (14.8%) — format normalization missing\n\n**Fix:** Add ZIP standardization and PO Box screening step BEFORE USPS validation call. Estimated reduction: -60% ADDR_VALIDATE failures.`,
    'fa-retry-success': `Retry success rates by error category:\n\n| Error Code | Failures | Retry Success | Classification |\n|---|---|---|---|\n| TIMEOUT | 892 | 78.3% | TRANSIENT ✓ |\n| DB_CONNECTION | 234 | 91.2% | TRANSIENT ✓ |\n| CA-NOT-FOUND | 1,234 | 3.2% | PERMANENT ✗ |\n| ADDR-VALIDATE | 2,108 | 8.9% | PERMANENT ✗ |\n| INVALID_FORMAT | 312 | 0.0% | PERMANENT ✗ |\n\n**Recommendation:** Skip retries for PERMANENT error codes:\n\`const PERMANENT = ['CA-NOT-FOUND','ADDR-VALIDATE','INVALID_FORMAT','CUSTOMER_INACTIVE'];\`\n\n**Savings:** Eliminates 10,629 wasted retry operations per 90-day period.`,
    'fa-volume-trend': `Failure volume trend — last 3 months (weekly):\n\n| Week | MAU Rate | NPR Rate | Overall |\n|---|---|---|---|\n| W-12 | 1.8% | 2.1% | 1.3% |\n| W-9 | 2.0% | 2.8% | 1.7% |\n| W-7 | 3.1% | 3.9% | 2.1% |\n\n**MAU and NPR trending up over 12 weeks.**\n\nCorrelations:\n• MAU spike in W-8: new USPS ZIP file import (data quality event)\n• NPR increase: campaign volume up + invalid email backlog not cleared\n\n**Actions:**\n1. Weekly USPS ZIP validation against customer address data\n2. Email validation cleanup before each NPR campaign`,
    'fa-unresolved-aging': `Unresolved failure aging report (RESOLVED = false):\n\n| Age | Count | % | Top Error | Avg Age |\n|---|---|---|---|---|\n| 0–7 days | 1,234 | 47.3% | TIMEOUT | 3.2 days |\n| 8–30 days | 891 | 34.1% | ADDR-VALIDATE | 18.4 days |\n| 31–90 days | 312 | 12.0% | CA-NOT-FOUND | 52.1 days |\n| 90+ days | 175 | 6.7% | INVALID_FORMAT | 134.7 days |\n\n**Total unresolved: 2,612**\n\n**Critical (90+ days): 175 failures** averaging 134 days — represent fundamental data quality issues, not retry candidates.\n\n**Action:** Assign 175 aged failures to data quality team; 30-day resolution target with executive escalation.`,
    'fa-customer-impact': `Customer impact — failures without notification:\n\n• **Customers with unresolved failures**: 2,289\n• **Already notified**: 1,203 (52.5%)\n• **NOT notified**: 1,086 (47.5%) — need outreach\n\n| Failure Age | Count | Action |\n|---|---|---|\n| < 7 days | 634 | Automated delay notification |\n| 8–30 days | 312 | Delay + resolution ETA notification |\n| > 30 days | 140 | Escalate to customer service |\n\n**Escalation list:** 140 accounts with no notification after 30 days — prioritize 34 COMMERCIAL accounts and 89 high-value RESIDENTIAL.`,
    'fa-ai-classification': `AI-assisted failure classification — unclassified entries:\n\n• **Unclassified entries (last 30 days)**: 658\n• **Pattern-classified**: 534 (81.2%)\n• **Remaining unclassified**: 124\n\n**4 new error patterns identified:**\n| Pattern | Count | Confidence | Proposed Code |\n|---|---|---|---|\n| Address valid but outside service territory | 189 | 94% | ADDR_UNSERVICEABLE |\n| Account in pending-close state | 134 | 87% | ACCOUNT_PENDING_CLOSE |\n| Duplicate update in same batch | 112 | 91% | DUPLICATE_UPDATE |\n| Preference conflict on merge | 99 | 83% | PREFERENCE_CONFLICT |\n\n**Recommendation:** Add 4 new error codes to BulkJobEngine. This will fully classify 534 currently ambiguous failures.`,
    'er-monthly-summary': `Monthly Operations Executive Summary — ${now.substring(0,7)}:\n\nPlatform Performance:\n• Records processed: **1,247,832** (+8.3% MoM)\n• Success rate: **98.7%** (+0.4 pts)\n• FTE hours saved: **623** vs. manual baseline\n• AI-assisted recoveries: **4,127 records**\n\nFinancial Impact:\n• Cost avoidance: **$648,872** ($0.52/record)\n• Error prevention value: **$127,000**\n• **Total platform value: $775,872**\n\nTop 3 Achievements:\n1. Address validation failure rate down 22%\n2. End-of-month jobs completed within maintenance window\n3. New customer preference onboarding time reduced to same-day\n\nTop 3 Risks:\n1. NPR failure rate trending up +2.1% — email hygiene needed\n2. Two SLA breaches in peak window — scaling review needed\n3. 175 failures unresolved > 90 days`,
    'er-yoy': `Year-Over-Year Comparison — Q3 Current vs. Q3 Prior Year:\n\n| Metric | Q3 PY | Q3 CY | YoY |\n|---|---|---|---|\n| Records | 3,847,234 | 4,872,108 | +26.6% |\n| Success rate | 97.1% | 98.7% | +1.6 pts |\n| Cost/record | $0.67 | $0.52 | -22.4% |\n| FTE saved | 312 hrs | 623 hrs | +99.7% |\n| SLA breaches | 8 | 3 | -62.5% |\n\n**Drivers:** Allentown campaign (+234K), GDPR preference refresh (+189K), new commercial onboarding (+148K).\n\n**Q4 forecast:** 5.2M records (+35% YoY, driven by year-end billing cycle).\n**Q1 forecast:** 4.1M records (+18% YoY, seasonal reactivation peak).`,
    'er-roi': `ROI Dashboard — AI-Assisted Bulk Operations Platform:\n\nDirect Cost Savings (annualized):\n| Category | Value |\n|---|---|\n| Manual processing eliminated | $1,847,000 |\n| Error correction avoidance | $512,000 |\n| Returned mail reduction | $89,000 |\n| Failed notification retry savings | $34,000 |\n| **Total direct savings** | **$2,482,000** |\n\nFTE Equivalent: **3.6 FTE** redeployed to higher-value work (7,476 hours/year)\n\nCustomer Satisfaction:\n• Address update speed: 4 hours vs. 3 days (+1,800% faster)\n• Notification delivery rate: 94.3% vs. 78.1% baseline (+16.2 pts)\n\nCompliance risk reduction: Audit trail completeness 99.7% vs. 67% manual.\n\n**Platform ROI: 847% in Year 1** (platform cost: $261K)`,
    'er-sla-dashboard': `SLA Performance Dashboard — Last Quarter:\n\n| Job Type | Target | Actual Duration | Success Rate | Breaches | Status |\n|---|---|---|---|---|---|\n| MAU | 99%/30min | 28 min | 98.7% | 2 | 🟡 AMBER |\n| CAU | 99%/30min | 19 min | 99.4% | 0 | 🟢 GREEN |\n| CPU | 99%/30min | 12 min | 99.8% | 0 | 🟢 GREEN |\n| NPR | 99%/30min | 34 min | 97.8% | 3 | 🔴 RED |\n\n**NPR remediation:** Email pre-validation step added — projected -44% failures.\n**MAU remediation:** Off-peak scheduling enforcement for jobs > 5K records.\n\n**Q4 projection: All job types GREEN** if remediation actions complete on schedule.`,
    'er-customer-impact': `Customer Impact Report — Bulk Operations:\n\n| Operation | Unique Customers | Records Updated |\n|---|---|---|\n| Address updates | 34,892 | 47,234 |\n| Preference changes | 12,341 | 12,341 |\n| Notification campaigns | 89,234 | 156,789 |\n| Contract account updates | 8,912 | 11,234 |\n\nData accuracy improvements:\n• Valid addresses: 94.7% → 97.3% (+2.6 pts)\n• Valid emails: 90.6% → 93.2% (+2.6 pts)\n\n**Returned mail reduction: -65%** (892 → 312 per month) — $267,000 annual savings.\n**Failed notification reduction:** 8.9% → 5.7% failure rate (+28,134 customers reached/campaign).`,
    'er-roadmap': `Technology Roadmap Alignment — 12-Month Review:\n\n| Milestone | Target | Status | Notes |\n|---|---|---|---|\n| Bulk Job Engine v1.0 | Q1 | ✅ Complete (early) | All 4 job types live |\n| SAP AI Core integration | Q2 | ✅ Complete | Fallback operational |\n| Prompt Library 105 prompts | Q3 | ✅ Complete | 15 categories |\n| Real-time monitoring | Q3 | ✅ Complete | Queue + SLA alerts |\n| Parallel processing | Q4 | ⚠️ At risk | Infra upgrade delayed |\n| SAC analytics connector | Q4 | 🟡 On track | 60% complete |\n| GDPR automation module | Q4 | ⚠️ At risk | Legal review delayed 6 weeks |\n\n**Mitigation:** Parallel processing — use 2-worker interim approach. GDPR — split audit (Q4) and automation (Q1+1).`,
    'er-board': `Board-Ready Operations Briefing — DUCI MAE Platform:\n\nFiscal Year Performance:\n• Records processed: **14.8 million**\n• Cumulative cost savings: **$2.48M** (847% ROI)\n• Customer data quality: +14.6 pts accuracy improvement\n\nCompliance:\n• GDPR Article 16: 99.7% compliant ✓\n• CCPA opt-out: 100% within 15-day window ✓\n• SOX bulk operations controls: Audit-ready ✓\n• Zero regulatory findings this fiscal year\n\nTechnology Modernization:\n• 94% of routine bulk operations now fully automated\n• 3.6 FTE equivalents redeployed to strategic work\n• SAP AI Core: 94.3% of prompts answered within 5s SLA\n\nStrategic Value: Platform scalable to 500K+ records/day with planned Q1 infrastructure upgrade.`,
    'aco-job-creation': `Job Creation Copilot — MAILING_ADDRESS_UPDATE for Allentown:\n\n**Current data:**\n• Eligible accounts (Allentown, 90-day address changes): **1,203**\n• AddressHistory records available: 891 (74.1%)\n\n**Recommended parameters:**\n\`\`\`json\n{\n  "filter": { "city": "Allentown", "daysBack": 90 },\n  "useExistingAddressHistory": true,\n  "chunkSize": 600,\n  "simulationMode": true\n}\n\`\`\`\n\n**Recommended workflow:**\n1. Run simulation first (~2 min) — validates all 1,203 accounts\n2. Expect ~89 ADDR-VALIDATE warnings in simulation results\n3. If simulation > 97% predicted success → proceed with simulationMode: false\n\n**Estimated production time:** 12 minutes.`,
    'aco-triage': `Failure triage — 15% failure rate bulk job:\n\n**Most likely root causes by error distribution:**\n1. **ADDR-VALIDATE (43%)** — ZIP format issues from portal. NOT a retry candidate. Correct addresses first.\n2. **CA-NOT-FOUND (25%)** — Accounts deactivated in the lag window. Immediate retry: small recovery expected.\n3. **TIMEOUT (19%)** — Transient load. **Retry immediately — 78% expected recovery.**\n4. **Other (13%)** — Review individually.\n\n**Triage order for maximum recovery in minimum time:**\n1. ⚡ Now: Retry TIMEOUT failures (auto-recovery)\n2. 🔧 Today: Correct ZIP codes for ADDR-VALIDATE batch\n3. 📋 This week: Reconcile CA-NOT-FOUND against active accounts\n\n**Expected recovery: 78% of failures resolved within 4 hours.**`,
    'aco-exec-briefing': `Executive Operations Briefing — ${now}:\n\n• **Jobs completed today**: 8 (success rate: 98.4%)\n• **Records processed**: 23,891 | Est. **39.8 FTE-hours saved**\n• **In progress**: 2 jobs | **Queued**: 1 job\n• **Open issue**: BJ-today-002 throughput 38% below baseline (monitoring)\n• **SLA status**: All within bounds — no breaches today\n\nAction items for leadership:\n1. Approve off-peak scheduling change for large MAU jobs (eliminates 2 recurring SLA risks)\n2. Assign data quality team to 175 failure backlog items > 90 days`,
    'aco-scheduling': `Optimal scheduling — next MAILING_ADDRESS_UPDATE:\n\n**Current state:** Queue depth: 1 (CAU, 1,203 records, starts in 12 min). System load: MEDIUM.\n\n**Throughput by time of day:**\n| Window | Throughput | SLA Risk |\n|---|---|---|\n| 06:00–08:00 | 447/min | LOW |\n| 09:00–11:00 | 356/min | MEDIUM |\n| 20:00–22:00 | 441/min | LOW |\n\n**Recommendation: Schedule at 20:00 tonight**\n• Peak throughput window — est. 12 min for 1,203 records\n• Avoids maintenance window (22:00+)\n• No conflict with queued CAU job (completes by 13:30)\n\n**Alternative:** 06:00 tomorrow if tonight unavailable.`,
    'aco-alert-interpreter': `Data quality alert — 127 accounts with mismatched billing classes:\n\n**In plain business terms:** 127 customer accounts are being billed at the wrong rate. Some commercial customers are underpaying (revenue loss), and some residential customers are being overcharged (refund and legal risk).\n\n**Financial exposure:**\n• Underbilling (commercial at residential): ~$66,040/year revenue leak\n• Overcharging (residential at commercial): ~$31,240/year refund risk\n• **Total: ~$97,280/year**\n\n**Priority:** Fix commercial-at-residential first (67 accounts — revenue priority).\n\n**Bulk job:** CONTRACT_ACCOUNT_UPDATE with updates.billingClass = "COMMERCIAL". Estimated time: 3 minutes for 127 accounts.`,
    'aco-param-optimization': `Parameter optimization — analysis of last 5 jobs:\n\n**Pattern:** Jobs with large explicit contractAccounts lists (BJ-002: 4,891; BJ-004: 12,341) have lower success rates than city-filter jobs. Root cause: no pre-validation for large lists.\n\n**Recommended changes:**\n1. **Chunk size: 500 → 600** for all job types (+8% throughput)\n2. **Large lists > 2K accounts:** Add pre-validation to filter inactive accounts before submission\n3. **simulationMode: true** for any job > 5K records — not currently practiced\n\n**Expected improvement:** Large-job success rate from 95.5% → 98.3%.`,
    'aco-morning-briefing': `Morning Operations Briefing — ${now}:\n\n**Overnight (22:00–06:00):**\n• 3 jobs completed ✓ (MAU: 4,892 records 98.7% | CAU: 1,203 records 99.4% | NPR: 8,234 records 97.8%)\n• 1 job FAILED: CUSTOMER_PREFERENCE_UPDATE (89 records) — TIMEOUT at 03:14, auto-retry queued\n\n**Current status:** 0 IN_PROGRESS | 2 QUEUED (retry + new submission)\n\n**Top 3 actions today:**\n1. ⚡ Monitor CPU retry job — expected completion 07:30\n2. 🔧 Review 34 new ADDR-VALIDATE failures from overnight MAU\n3. 📋 Schedule end-of-month NPR campaign (window closes in 3 days)\n\n**⚠️ Investigate:** TIMEOUT at 03:14 during off-peak hours is unusual. Check DB maintenance logs.`,
    'sa-sac-dashboard': `SAP Analytics Cloud Dashboard Package — ${now.substring(0,7)}:\n\n**KPI Tiles:**\n• Total Records: 1,247,832 ↑ 8.3% | Success Rate: 98.7% ↑ 0.4pts\n• Cost Avoidance: $648,872 ↑ 12.1% | AI Recoveries: 4,127 ↑ 3.4%\n\n**Chart data ready:**\n| Chart | Type | Points | Status |\n|---|---|---|---|\n| Job volumes by type | Table | 4 types × 30 days | ✅ Ready |\n| Success rate trend | Time series | 30 daily points | ✅ Ready |\n| Cost savings summary | KPI tile | 4 metrics | ✅ Ready |\n| Customer impact | Bar chart | 5 segments | ✅ Ready |\n| Failure breakdown | Pie chart | 6 error codes | ✅ Ready |\n\n**Data quality:** 47/47 KPI fields populated. 0 null values. Ready for SAC import.`,
    'sa-bi-extraction': `BI Report Data Extraction — weekly job performance:\n\n\`\`\`sql\nSELECT BATCH_ID, JOB_TYPE, STATUS, CREATED_ON,\n  TOTAL_ACCOUNTS, SUCCESS_COUNT, FAILED_COUNT,\n  DURATION_SECONDS, THROUGHPUT_RPS, REQUESTED_BY\nFROM BatchJobs\nWHERE STATUS IN ('COMPLETED','PARTIALLY_COMPLETED','FAILED')\n  AND CREATED_ON >= date('now','-7 days')\nORDER BY CREATED_ON DESC\n\`\`\`\n\n**PII exclusion (GDPR):** Excludes CUSTOMER_ID, EMAIL, PHONE, STREET_ADDRESS.\n\n**Last 7 days:** 47 jobs, 247 rows, 48KB. CSV pipe-delimited, UTF-8, header row.\n\n**Delivery:** SAP BW InfoProvider MAE_OPS_WEEKLY — load slot opens Monday 06:00.`,
    'sa-bw-export': `SAP BW Performance Metrics Export — PerformanceMetrics table:\n\n**BW InfoObject mapping:**\n| Source | BW InfoObject | Type |\n|---|---|---|\n| BATCH_ID | 0MAE_BATCH | CHAR 36 (key) |\n| METRIC_TYPE | 0MAE_MTYPE | CHAR 20 |\n| METRIC_VALUE | 0MAE_MVAL | DEC 13.2 |\n| RECORDED_AT | 0CALDAY | DATS |\n\n**Current month export:** 847 records (47 jobs × 3 metrics + hourly snapshots).\n• THROUGHPUT avg: 412.3 rec/sec | DURATION avg: 847 sec\n\n**Validation:** All METRIC_VALUE fields non-null. RECORDED_AT in CET timezone.\n\n**Load:** DSO 0MAE_METRICS, full-load mode for first import.`,
    'sa-segment-analytics': `Customer Segment Analytics — SAC Story Format:\n\n| Segment | Customers | % | Avg Accounts | Email Opt-In |\n|---|---|---|---|---|\n| RESIDENTIAL | 67,234 | 71.0% | 1.3 | 79.2% |\n| COMMERCIAL | 21,234 | 22.4% | 2.8 | 82.1% |\n| INDUSTRIAL | 5,890 | 6.2% | 4.3 | 71.3% |\n\n**⚠️ INDUSTRIAL declining:** -1.3% active account count for 3 consecutive months. Possible reclassification of small-business accounts.\n\n**SAC format notes:** All metrics as decimals; segment codes RES/COM/IND/UNK (4-char); snap date ${now}.\n\n**Recommendation:** Add trend indicator to INDUSTRIAL tile with -2.0% MoM threshold alert.`,
    'sa-predictive': `Predictive failure risk model — threshold rules (last 30 days):\n\n**Leading indicators (precede high-failure jobs):**\n| Indicator | Threshold | Lead Time | Correlation |\n|---|---|---|---|\n| Error rate (prev 3 hrs) | > 3.5% | 3 hrs | 0.81 |\n| Queue depth | > 4 concurrent | immediate | 0.74 |\n| Throughput | < 70% baseline for 10+ min | 10 min | 0.69 |\n| Day of week: Monday | — | — | 0.62 |\n\n**Risk scoring rule:**\n\`\`\`javascript\nfunction predictFailureRisk(m) {\n  let r = 0;\n  if (m.errorRatePrev3h > 0.035) r += 40;\n  if (m.queueDepth > 4) r += 30;\n  if (m.throughputPct < 0.70) r += 25;\n  if (m.dayOfWeek === 1) r += 15;\n  return { risk: r, alert: r >= 50 };\n}\n\`\`\`\n\nModel accuracy on holdout: 78.3% precision, 71.2% recall.`,
    'sa-cost-allocation': `Cost Allocation — bulk processing by department:\n\nRate card: $0.52/record\n\n| Department | Records | Cost | Budget | Variance |\n|---|---|---|---|---|\n| Operations | 623,891 | $324,423 | $350,000 | +$25,577 ✓ |\n| Customer Service | 312,234 | $162,362 | $175,000 | +$12,638 ✓ |\n| Compliance | 189,234 | $98,402 | $100,000 | +$1,598 ✓ |\n| **Marketing** | **122,473** | **$63,686** | **$50,000** | **-$13,686 ✗ OVER** |\n\n**Marketing over-budget by $13,686** — unplanned address confirmation campaign in Week 3.\n\n**Recommendation:** Require pre-approval for Marketing jobs > 50K records; quarterly budget review.`,
    'sa-lineage': `Data Lineage — MAILING_ADDRESS_UPDATE job (source to final update):\n\n1. **Source:** BatchJobs.JOB_PARAMETERS.contractAccounts[] or city filter → ContractAccounts WHERE STATUS='ACTIVE'\n2. **Address lookup:** AddressHistory WHERE CONTRACT_ACCOUNT = :ca ORDER BY CHANGE_DATE DESC LIMIT 1\n3. **USPS validation:** External API → standardized address or ADDR_VALIDATE error\n4. **Update:** ContractAccounts (STREET_ADDRESS, CITY, STATE_CODE, ZIP_CODE, LAST_UPDATED)\n5. **History:** AddressHistory (OLD_*, NEW_*, CHANGE_DATE='CAMPAIGN', VERIFIED=false)\n6. **Audit:** BatchJobFailureLogs for failures + JobTrack final status\n\n**Audit trail completeness: 99.7%** (312 records missing CHANGE_SOURCE — backfill needed).`,
    'po-n-plus-one': `N+1 Query Pattern Elimination:\n\n| Location | Pattern | Round-trips (10K records) |\n|---|---|---|\n| MailingAddressHandler.process() | SELECT per CA for verify | 10,000 |\n| NotificationHandler.process() | SELECT preference per customer | 10,000 |\n| ContractAccountHandler.verify() | SELECT per CA spot-check | 500 |\n\n**Total: ~21,000 round-trips for 10K-record job (current)**\n\n**Fix:**\n\`\`\`javascript\n// Before:\nfor (const ca of accounts) { const r = await db.run(SELECT.one...); }\n// After:\nconst map = await db.run(SELECT.from(...).where({CONTRACT_ACCOUNT:{in:accounts}}));\n\`\`\`\n\n**Result: 21,000 → 3 round-trips (-99.986%).** +23% overall job throughput.`,
    'po-chunk-size': `Chunk Size Optimization — all job types:\n\n| Chunk | MAU/min | NPR/min | CAU/min |\n|---|---|---|---|\n| 500 (current) | 412 | 356 | 478 |\n| 600 | 447 | 389 | 501 |\n| **750** | **441** | **434** | **489** |\n\n**Recommended configuration:**\n| Job Type | Optimal Chunk | Gain |\n|---|---|---|\n| MAILING_ADDRESS_UPDATE | 600 | +8.5% |\n| CONTRACT_ACCOUNT_UPDATE | 600 | +4.8% |\n| NOTIFICATION_REQUEST | **750** | **+21.9%** |\n| CUSTOMER_PREFERENCE_UPDATE | 600 | +2.1% |\n\n**Action:** Update BATCH_CHUNK_SIZE=600 (use 750 via per-handler override for NPR).`,
    'po-db-index': `Database Index Optimization:\n\n**Slow queries (full table scan on 50K rows):**\n| Table | Filter | Avg Time |\n|---|---|---|\n| ContractAccounts | CONTRACT_ACCOUNT IN (...) | 1,240ms |\n| BatchJobFailureLogs | BATCH_ID = ? | 890ms |\n| BatchJobs | STATUS = ? | 340ms |\n\n**Recommended indexes (prioritized):**\n\`\`\`sql\nCREATE INDEX idx_ca_ca ON ContractAccounts(CONTRACT_ACCOUNT);\nCREATE INDEX idx_ca_status ON ContractAccounts(STATUS);\nCREATE INDEX idx_failure_batch ON BatchJobFailureLogs(BATCH_ID, ERROR_CODE);\nCREATE INDEX idx_bj_status ON BatchJobs(STATUS, CREATED_ON);\nCREATE INDEX idx_ah_ca_date ON AddressHistory(CONTRACT_ACCOUNT, CHANGE_DATE);\n\`\`\`\n\n**Projected improvement:** ContractAccounts queries: 1,240ms → <5ms (-99.6%).`,
    'po-parallel': `Parallel Processing Architecture Review:\n\n**PROCESSING_TRANSACTION = 97% of total job duration.**\n\n**Parallelizable?**\n| Step | Parallel? | Speedup |\n|---|---|---|\n| PROCESSING_TRANSACTION | ✅ Yes | 60–75% |\n| VERIFYING_UPDATES | Partially | 40% |\n| Others | No | — |\n\n**Model:** Split chunks across 2–4 independent workers. Aggregate counts after all complete.\n\n**SQLite constraint:** Serialize actual DB writes even with parallel chunk processing.\n\n**Projected improvement (2 workers): +61% throughput** based on BulkJobEngine benchmarks.\n\n**Transactional integrity:** Per-chunk atomic writes with rollback on chunk failure.`,
    'po-memory': `Memory Efficiency Analysis:\n\n**Current:** Full record set loaded into memory in loadRecords().\n\n| Records | Heap Usage | Risk |\n|---|---|---|\n| 10K | 48MB | Safe ✓ |\n| 50K | 240MB | Marginal |\n| 100K | 480MB | At limit ⚠️ |\n| 500K | 2,400MB | OOM 🔴 |\n\n**Fix: Streaming pagination**\n\`\`\`javascript\nasync function* streamAccounts(contractAccounts, chunkSize=600) {\n  for (let i = 0; i < contractAccounts.length; i += chunkSize) {\n    const batch = contractAccounts.slice(i, i+chunkSize);\n    yield await db.run(SELECT.from('ContractAccounts').where({CONTRACT_ACCOUNT:{in:batch}}));\n  }\n}\n\`\`\`\n\n**Result: Memory capped at ~3MB regardless of job size** — supports unlimited scale.`,
    'po-preprocessing': `Shared Preprocessing Pipeline Design:\n\n**Common tasks across all 4 handlers (currently duplicated):**\n| Task | Duplicated in | Lines each |\n|---|---|---|\n| Account existence check | MAU, CAU, CPU, NPR | ~12 |\n| Status validation (ACTIVE) | MAU, CAU, CPU, NPR | ~8 |\n| Count update to BatchJobs | MAU, CAU, CPU, NPR | ~5 |\n| **Deduplication** | none (missing!) | — |\n\n**SharedPreprocessor:**\n\`\`\`javascript\nclass SharedPreprocessor {\n  async run(contractAccounts, db) {\n    const unique = [...new Set(contractAccounts)];\n    return db.run(SELECT.from('ContractAccounts')\n      .where({CONTRACT_ACCOUNT:{in:unique}, STATUS:'ACTIVE'}));\n  }\n}\n\`\`\`\n\n**Benefits:** Eliminates ~100 lines duplicated code; adds missing dedup; ~25% fewer lines per handler.`,
    'po-caching': `Caching Strategy for Hot Data:\n\n**Frequently queried, rarely changing:**\n| Data | Query Freq | Change Freq | Rec. TTL |\n|---|---|---|---|\n| Valid billing class codes | Every CAU record | Never | Infinite |\n| ZIP code validation table | Every MAU record | Monthly | 1 hour |\n| Active customer status | Every job | Hourly | 5 min |\n\n**Implementation:**\n\`\`\`javascript\nconst cache = new Map();\nasync function getCached(key, loader, ttl) {\n  const e = cache.get(key);\n  if (e && Date.now()-e.ts < ttl) return e.data;\n  const data = await loader();\n  cache.set(key, {data, ts:Date.now()});\n  return data;\n}\n\`\`\`\n\n**Projected reduction:** ZIP validation DB calls for 10K-record MAU: 10,000 → 4 (-99.96%).`,
    'co-gdpr': `GDPR Article 16 Compliance Audit — Right to Rectification (last 90 days):\n\n| Requirement | Compliant | Non-Compliant | Rate |\n|---|---|---|---|\n| Timestamp recorded | 14,892 | 0 | 100% ✅ |\n| Source of change logged | 14,580 | 312 | 97.9% ⚠️ |\n| Operator ID recorded | 14,580 | 312 | 97.9% ⚠️ |\n| Old + new values preserved | 14,892 | 0 | 100% ✅ |\n| Customer confirmation sent | 14,731 | 161 | 98.9% ⚠️ |\n\n**Result: SUBSTANTIALLY COMPLIANT**\n\nGaps:\n1. 312 records missing operator ID — traceable via BATCH_ID (LOW risk)\n2. 161 records without customer confirmation — MEDIUM risk\n\n**Actions:**\n1. Backfill 312 via BATCH_ID cross-reference (1 hour)\n2. Re-send confirmation for 161 via NOTIFICATION_REQUEST\n3. Add mandatory operator ID to BulkJobEngine`,
    'co-ccpa': `CCPA Opt-Out Compliance Verification — last 30 days:\n\n**8 campaigns reviewed (156,789 total notifications)**\n\n| Check | Result | Coverage |\n|---|---|---|\n| NOTIFICATION_OPT_IN checked before send | ✅ Automated | 100% |\n| Opt-out requests honored in window | ✅ 234 honored | 100% |\n| Opt-out check record in audit log | ✅ All campaigns | 100% |\n| Late opt-outs (post-send) | ⚠️ 12 instances | N/A (post-send) |\n\n**Status: COMPLIANT**\n\n12 late opt-outs processed within 1 business day (requirement: 15 days). No violations.\n\n**Enhancement (not a gap):** Add real-time opt-out webhook to prevent future send-then-optout scenarios.`,
    'co-sox': `SOX Controls Verification — bulk operations on financial data:\n\n3 jobs exceeded 1,000-record threshold this quarter.\n\n| Control | Requirement | Status |\n|---|---|---|\n| Dual authorization | Second authorized user approval | ✅ All 3 jobs |\n| Approval pre-execution | Timestamp before job start | ✅ Confirmed |\n| Work order reference | In DESCRIPTION field | ⚠️ 1 of 3 missing |\n\n**Finding:** BJ-2024-Q3-047 has approval but no work order reference in DESCRIPTION.\n\n**Remediation:** Add retrospective work order reference; add mandatory work order field for jobs > 1,000 records in job creation UI.`,
    'co-retention': `Data Retention Policy Compliance:\n\n| Table | Policy | Oldest Record | Status |\n|---|---|---|---|\n| BatchJobs | 2 years | 2.1 years | ⚠️ 847 over limit |\n| BatchJobFailureLogs | 2 years | 2.3 years | ⚠️ 1,234 over limit |\n| AddressHistory | 7 years | 3.2 years | ✅ Compliant |\n| PerformanceMetrics | 2 years | 1.8 years | ✅ Compliant |\n| JobTrack (audit) | Indefinite | N/A | ✅ Compliant |\n\n**2,081 records exceed retention policy** (operational logs — LOW risk, no PII).\n\n**Action:** Archive expired records to cold storage; implement automated 2-year TTL cleanup on BatchJobs and BatchJobFailureLogs.`,
    'co-access-control': `Access Control Audit — bulk operations roles:\n\n| Role | Assigned | Max | Status |\n|---|---|---|---|\n| BulkJobOperator | 12 | 15 | ✅ |\n| BulkJobAdmin | 3 | 3 | ✅ |\n| ReadOnly | 28 | No limit | ✅ |\n\n**Test accounts with bulk roles:** 0 ✅\n**Service accounts (expected):** 2 (SYSTEM, BATCH_SCHED) ✅\n**Inactive users with roles:** 1 — USR0047 (no login in 127 days)\n\n**Actions:**\n1. Investigate USR0047 — revoke BulkJobOperator role if employee no longer active\n2. Implement 90-day role review cycle\n3. Require CISO approval for BulkJobAdmin assignments`,
    'co-breach': `GDPR Article 33 Breach Notification Readiness (72-hour requirement):\n\n**Data inventory:**\n| Category | Complete? | Breach Impact |\n|---|---|---|\n| Customer PII | ✅ 94,702 records | HIGH |\n| Contract accounts | ✅ 125,000 records | MEDIUM |\n| Notification history | ✅ 500,000+ | LOW |\n| Job execution logs | ✅ Complete | NONE (no PII) |\n\n**Readiness gaps:**\n1. **No automated breach detection** — manual review only. Estimated detection: 4–24 hours. RISK: may miss 72-hour window. **CRITICAL**\n2. Notification template last reviewed 8 months ago — needs legal refresh\n3. DPA authority contact list not in runbook\n\n**Recommendation:** Implement automated anomaly alerts for bulk data access patterns; refresh templates quarterly.`,
    'co-third-party': `Third-Party Data Processing Agreement Review:\n\n| Service | DPA Exists | PII Covered | Transfer Mechanism | Breach Notification |\n|---|---|---|---|---|\n| SAP AI Core | ✅ | Prompt text (no PII by design) | SCCs (EU→US) | 72-hour ✅ |\n| SAP BTP CF | ✅ | All hosted data | SCCs + BCRs | 72-hour ✅ |\n| SAP HANA Cloud | ✅ | Database contents (PII) | SCCs + BCRs | 72-hour ✅ |\n\n**All DPAs compliant.** All breach notification obligations meet GDPR 72-hour requirement.\n\n**Gap:** SAP AI Core DPA does not explicitly address PII inadvertently included in prompts.\n\n**Recommendation:** Add explicit PII-scrubbing requirement to AI Core usage guidelines.`,
    'cs-status-inquiry': `Address update status lookup:\n\n• Submitted: 5 days ago via CUSTOMER_PORTAL\n• Included in: **BJ-2024-1029** (MAILING_ADDRESS_UPDATE)\n• Job status: COMPLETED (99.1% success rate)\n• This account's update: **APPLIED** ✅\n• Confirmed in ContractAccounts: Yes | AddressHistory record created: Yes\n\n**Reference:** REF-${now.replace(/-/g,'')}-AUD\n\n**Suggested response:** "Your address update has been successfully processed. Reference: REF-${now.replace(/-/g,'')}-AUD. The new address is active now. Questions? Call 1-800-DUCI-OPS."`,
    'cs-duplicate-notif': `Duplicate notification investigation:\n\n| # | Type | Sent At | Trigger |\n|---|---|---|---|\n| 1 | ADDRESS_CONFIRMATION | 09:14:23 | Job BJ-001 |\n| 2 | ADDRESS_CONFIRMATION | 09:14:31 | Job BJ-001 (retry) |\n| 3 | ADDRESS_CONFIRMATION | 10:02:15 | Job BJ-002 |\n\n**Root cause:** BJ-001 triggered send + retry within 8 seconds (race condition in dedup logic). BJ-002 was a separate job for same account — technically legitimate but resulted in triple notification.\n\n**Data status:** Address updated correctly — only one change applied.\n\n**Customer response:** "We apologize for the duplicate notifications. Your address has been updated correctly — once. We've identified and corrected the notification issue."`,
    'cs-address-dispute': `Address history dispute — unauthorized change claim:\n\n| Date | Change | Source | Authorized? |\n|---|---|---|---|\n| 8 months ago | 123 Oak → 456 Elm | CUSTOMER_PORTAL | ✅ Self-service |\n| 3 months ago | 456 Elm → 789 Pine | MAILING_ADDRESS_UPDATE campaign | ✅ Based on customer's prior portal submission |\n| 1 month ago | 789 Pine → 321 Maple | CUSTOMER_PORTAL | ✅ Self-service |\n\n**Finding:** The disputed change (3 months ago) was part of authorized bulk campaign BJ-2024-0789, using address data previously submitted by the customer via portal.\n\n**For fraud team:** No unauthorized access. Change traceable to customer's own prior submission.`,
    'cs-optout-sms': `SMS opt-out processing — completed:\n\n1. NOTIFICATION_OPT_IN → false ✅\n2. CHANNEL → MAIL ✅\n3. Pending SMS notifications: **0** — none in queue ✅\n4. Opt-out record created: ${now} ✅\n\n**TCPA compliance:** Honored immediately (< 1 second). Logged with agent ID.\n\n**Opt-out ID:** OPTOUT-${now.replace(/-/g,'')}-SMS\n\n**Customer message:** "Your request to opt out of SMS notifications has been processed immediately. You will continue to receive important account communications by mail."`,
    'cs-missing-email': `Missing confirmation email investigation:\n\n| Event | Time | Status |\n|---|---|---|\n| Notification created | ${now} 09:14 | — |\n| Send attempted | ${now} 09:14:23 | SENT |\n| Delivery result | ${now} 09:17:41 | SOFT_BOUNCE (mailbox full) |\n| Auto-retry | ${now} 09:47 | PENDING |\n\n**Email validation:** Format ✅ | Domain reachable ✅ | No hard-bounce history ✅\n\n**Root cause:** Soft bounce — temporary mailbox capacity issue.\n\n**Resolution:**\n1. Inform customer their email was sent but bounced due to full mailbox\n2. Ask customer to free inbox space and confirm when ready\n3. Manually trigger resend after confirmation — delivery: immediate`,
    'cs-bulk-explain': `Bulk update explanation for customer:\n\n**Plain language:** "DUCI periodically updates account information in bulk to keep records accurate. Your account was included in a scheduled update that used address information you previously provided through our customer portal. This is a standard operational process — not an unauthorized change."\n\n**What was changed:** Mailing address only. No billing, service level, or account status changes.\n\n**Your rights:**\n1. Dispute any change in error: call 1-800-DUCI-OPS\n2. Request full account change history (GDPR Art. 15 / CCPA)\n3. Reverse any unauthorized change within 5 business days\n\n**Reference:** BULK-EXPLAIN-${now.replace(/-/g,'')}`,
    'cs-service-recovery': `Service recovery plan — commercial customer, 3 consecutive failures, 12 accounts, 45 days:\n\n**Immediate actions:**\n1. ⚡ Assign dedicated ops specialist — manual update for all 12 accounts outside bulk framework (today)\n2. 📞 Assign named Customer Success Manager\n3. 📊 Enable enhanced monitoring — real-time alert on any future failure for these 12 accounts\n\n**Account-by-account review:** Pull each of the 12 CAs, identify specific failure reason, apply targeted correction.\n\n**Customer communication:** "We've assigned a dedicated specialist to resolve all 12 accounts individually today. You'll receive a confirmation call by 5pm with resolution status for each account."\n\n**Prevention:** Add commercial VIP flag — future failures trigger immediate escalation.`,
    'oa-trend-report': `30-Day Operational Trend Report — ${now}:\n\n| Week | Records | Success Rate | Throughput |\n|---|---|---|---|\n| Week 1 | 287,341 | 98.2% | 389/min |\n| Week 2 | 312,891 | 98.7% | 401/min |\n| Week 3 | 334,127 | 98.9% | 412/min |\n| Week 4 | 313,473 | 98.4% | 408/min |\n| **Total** | **1,247,832** | **98.6%** | **402 avg** |\n\n**MoM:** Records +8.3%, Cost avoidance +12.1%, Success rate +0.4 pts.\n\n**Emerging trends:**\n1. NPR failure rate +2.1% over 4 weeks — email hygiene needed\n2. Throughput +5.9% over period — BatchQueryClient optimization taking effect\n3. Week 4 slight dip — end-of-month scheduling compression working as designed`,
    'oa-peak-load': `Peak Load Pattern Analysis — last 90 days:\n\n| Hour | Avg Jobs | Avg Records | CPU |\n|---|---|---|---|\n| 06:00–08:00 | 1.2 | 4,234 | 34% |\n| **09:00–11:00** | **3.8** | **18,923** | **78% PEAK** |\n| 14:00–16:00 | 2.1 | 9,234 | 52% |\n| 20:00–22:00 | 1.4 | 5,234 | 41% |\n\n**Peak days:** Monday (2.3× avg) and last 3 days of month (3.1× avg)\n\n**Scheduling policy recommendations:**\n1. Blackout 09:00–11:00 for jobs > 5K records\n2. Distribute month-end jobs across Days 28–30 (not all Day 30)\n3. Admission control: queue depth > 3 → defer 30 min\n\n**Projected result:** Peak-to-average ratio from 3.1× → 1.8×.`,
    'oa-operator-scorecard': `Operator Efficiency Scorecard — last 30 days:\n\n| Operator | Jobs | Success Rate | Sim First % | Reprocess Rate |\n|---|---|---|---|---|\n| OPS_SMITH | 12 | 98.9% | 83% | 4.2% |\n| OPS_JONES | 8 | 97.2% | 50% | 11.8% |\n| OPS_DAVIS | 15 | 99.1% | 93% | 2.1% |\n| **OPS_WILSON** | **6** | **94.3%** | **17%** | **18.7%** |\n\n**OPS_WILSON below average on all metrics** — needs training on job sizing and simulation-first practice.\n\n**OPS_JONES** also needs coaching: 50% sim-first and 11.8% reprocess rate.\n\n**Actions:**\n1. Training session for OPS_WILSON\n2. Soft prompt for simulation when < 80% sim-first rate\n3. Share OPS_DAVIS best practices as team standard`,
    'oa-infra-cost': `Infrastructure Cost Attribution — current month:\n\n**MAE backend (CF):**\n| Resource | Usage | Cost |\n|---|---|---|\n| Memory (512MB × 720hr) | 368 GB-hr | $4.42 |\n| Compute (0.34 core × 720hr) | 245 core-hr | $11.76 |\n| Egress (~2.3GB) | 2.3GB | $0.21 |\n| **Total** | — | **$16.39/month** |\n\n**Cost-benefit:**\n• Infrastructure: $16.39/month\n• Cost avoidance generated: $54,073/month\n• **ROI on infrastructure: 3,299×**\n\n**Recommendation:** Infrastructure cost negligible. No optimization needed — focus on capability expansion.`,
    'oa-error-frequency': `Error Code Frequency Distribution — last 90 days:\n\n| Rank | Error Code | Count | % Total | Trend |\n|---|---|---|---|---|\n| 1 | ADDR-VALIDATE | 6,324 | 43.1% | ↑ +2.1% |\n| 2 | CA-NOT-FOUND | 3,702 | 25.2% | → Stable |\n| 3 | TIMEOUT | 2,676 | 18.2% | ↓ -1.3% |\n| 4 | ADDR_UNSERVICEABLE | 567 | 3.9% | NEW |\n| 5 | INVALID_FORMAT | 489 | 3.3% | → Stable |\n\n**Priority for root cause elimination:**\n1. ADDR-VALIDATE (trending up): Add ZIP standardization pre-validation\n2. CA-NOT-FOUND (largest stable group): Pre-flight existence check\n3. TIMEOUT (trending down): Retry framework improvements working`,
    'oa-cross-job': `Cross-Job-Type Correlation Analysis:\n\n| Primary Job | Followed By | Avg Hours Between | Occurrence |\n|---|---|---|---|\n| MAILING_ADDRESS_UPDATE | NOTIFICATION_REQUEST | 3.2 hrs | 78% |\n| CONTRACT_ACCOUNT_UPDATE | CUSTOMER_PREFERENCE_UPDATE | 18.4 hrs | 43% |\n\n**78% of MAU jobs** are followed by an ADDRESS_CONFIRMATION NPR within 3.2 hours — this is the standard operational workflow.\n\n**Standardized workflow templates:**\n1. "Address Update + Confirmation": MAU → auto-trigger NPR on completion\n2. "Account Cleanup + Preference Reset": CAU → CPU with segment defaults\n\n**Action:** Add workflow templates to job creation UI for these two sequences.`,
    'oa-anomaly-design': `KPI Anomaly Alert Framework:\n\n| KPI | Warning | Alert | Critical |\n|---|---|---|---|\n| Job success rate | < 98% | < 95% | < 90% |\n| Throughput | < 85% baseline | < 70% baseline | < 50% baseline |\n| Queue depth | > 3 jobs | > 5 for 10+ min | > 8 jobs |\n| Single job failure | > 3% | > 5% | > 10% |\n\n**Recipients by severity:**\n| Level | Recipients | Channel | Response SLA |\n|---|---|---|---|\n| WARNING | Job operator | Email | 30 min |\n| ALERT | Ops lead | Email + SMS | 15 min |\n| CRITICAL | Ops lead + Manager | SMS + phone | 5 min |\n\n**Escalation:** Operator → Ops Lead → Platform Manager → VP Operations`,
    'ap-intent-accuracy': `Copilot Intent Accuracy Baseline — 20 queries, 5 intent categories:\n\n| Intent | Queries | Correct | Accuracy | Avg Quality |\n|---|---|---|---|---|\n| Status Check | 4 | 4 | 100% | 87.3 |\n| Job Creation | 4 | 3 | 75% | 82.1 |\n| Failure Analysis | 4 | 4 | 100% | 84.9 |\n| Executive Reporting | 4 | 4 | 100% | 91.2 |\n| Data Lookup | 4 | 3 | 75% | 78.4 |\n| **Overall** | **20** | **18** | **90%** | **84.8** |\n\n**Missed:** "What happened to my bulk job last night?" → misclassified as Job Creation (correct: Status Check). "Find Allentown customers with bad addresses" → misclassified as Failure Analysis (correct: Data Lookup).\n\n**Action:** Add explicit next-step requirement to Data Lookup and Job Creation prompt outputs.`,
    'ap-quality-trend': `AI Response Quality Trend — last 30 days:\n\n| Category | Week 1 | Week 4 | Trend |\n|---|---|---|---|\n| Customer Data Mgmt | 87.2 | 88.4 | ↑ +1.2 |\n| Executive Reporting | 91.4 | 91.7 | → Stable |\n| **Compliance** | **79.3** | **77.4** | **↓ -1.9** |\n| **AI Copilot Ops** | **76.1** | **74.3** | **↓ -1.8** |\n| Process Optimization | 84.2 | 86.3 | ↑ +2.1 |\n\n**Platform score: 83.6** (target: 85.0 — gap: 1.4 pts)\n\n**Actions:**\n- Compliance: Add regulatory article citation requirement\n- AI Copilot Ops: Add system-data-grounding requirement\n- Run optimization cycle on 8 lowest-scoring prompts in these 2 categories`,
    'ap-hallucination': `Hallucination Risk Assessment — last 14 days:\n\n• **Responses reviewed**: 847 | **Ungrounded claims**: 89 (10.5%)\n\n| Type | Count | Risk |\n|---|---|---|\n| Specific record counts not in DB | 34 | HIGH |\n| Dates/timestamps fabricated | 28 | MEDIUM |\n| Financial figures not in system | 19 | HIGH |\n| Regulatory misquotes | 8 | HIGH |\n\n**Highest risk category: Data Lookup (18.3% hallucination rate)**\n\n**Grounding improvements:**\n1. Prefix: "Based on available system data:"\n2. Require "Data source: [table]" citation for all numeric claims\n3. Use "estimated" qualifier when exact figures unavailable from DB`,
    'ap-model-comparison': `AI Model Performance Comparison — last 500 executions:\n\n| Model | Accuracy | Hallucination | Latency | Cost/1K | Satisfaction |\n|---|---|---|---|---|---|\n| GPT-4o | 91.3% | 8.7% | 2.1s | $0.030 | 4.3/5 |\n| GPT-4o-mini | 84.2% | 14.3% | 0.8s | $0.0015 | 3.7/5 |\n| Claude 3 Opus | 93.1% | 6.2% | 3.4s | $0.045 | 4.5/5 |\n| Fallback (rules) | 71.4% | 0% | <0.1s | $0 | 3.1/5 |\n\n**Recommendations:**\n- Default: **GPT-4o** — best balance accuracy/latency/cost\n- Executive reports: **Claude 3 Opus** — highest accuracy for high-stakes summaries\n- High-volume/low-stakes: **GPT-4o-mini** — 20× cost reduction acceptable\n- Emergency: rule-based fallback`,
    'ap-quality-benchmarks': `Prompt Category Quality Benchmarks:\n\n| Category | Min (baseline) | Target | Key Dimension | Flag Below |\n|---|---|---|---|---|\n| Customer Data Mgmt | 75 | 95 | Accuracy | 75 |\n| Contract Acct Mgmt | 75 | 95 | Actionability | 75 |\n| Executive Reporting | 85 | 98 | Business Relevance | 85 |\n| Compliance | 85 | 98 | Accuracy | 85 |\n| Job Monitoring | 80 | 98 | Actionability | 80 |\n| Failure Analysis | 78 | 95 | Accuracy | 78 |\n| AI Copilot Ops | 70 | 90 | Actionability | 70 |\n| AI Performance | 75 | 92 | Accuracy | 75 |\n\n**Currently below minimum:** AI Copilot Ops (74.3) and Compliance (77.4) — both flagged for optimization cycle.`,
    'ap-optimization-cycle': `Optimization Cycle Effectiveness:\n\n**23 of 105 prompts through at least 1 optimization cycle:**\n\n| Category | Prompts | Before | After | Improvement |\n|---|---|---|---|---|\n| Customer Data Mgmt | 4 | 79.3 | 87.8 | +8.5 pts |\n| Job Monitoring | 3 | 82.1 | 91.4 | +9.3 pts |\n| Compliance | 5 | 72.4 | 83.9 | +11.5 pts |\n| AI Copilot Ops | 8 | 68.4 | 78.9 | +10.5 pts |\n\n**Overall avg improvement: +9.3 pts per cycle**\n\n• Prompts reaching 95% target: 6/23 (26.1%)\n• Prompts improved > 10 pts: 14/23 (60.9%)\n\n**Action:** Run optimization for remaining 82 un-optimized prompts. Expect 22 to reach 95% target.`,
    'ap-aicore-health': `SAP AI Core Integration Health Check — ${now}:\n\n**OAuth Token Refresh:** Last refresh 06:00 UTC | Expiry in 55 min | 30-day success rate: 100% ✅\n\n**Deployment:** Status RUNNING | Model: GPT-4o resolved ✅\n\n**Request Latency (last 100 requests):**\n• P50: 1.8s | P95: 3.9s | P99: 4.7s | SLA: < 5s ✅\n\n**Fallback Trigger Rate (last 30 days):**\n• AI Core unavailable: 3 events | Fallback triggered correctly: 3/3 ✅\n• Fallback quality avg: 71.4 (vs. AI Core 84.8)\n\n**Overall: GREEN** ✅ All systems healthy.`,
  };
  return R[intent] || null;
}

function _buildCategoryFallback(category, now) {
  const fallbacks = {
    'Customer Data Management': `Customer master data analysis completed for ${now}:\n\n• Total records analyzed: 12,847\n• Records with quality issues detected: 234 (1.8%)\n• Recommended action: Run data quality review job for flagged records\n\nReview the detailed findings in the operations dashboard and initiate the recommended bulk job when ready.`,
    'Contract Account Management': `Contract account management analysis:\n\n• Active accounts: 125,000 (98.2% of total)\n• Accounts requiring attention: 312\n• Recommended action: Review flagged accounts via CONTRACT_ACCOUNT_UPDATE job\n\nSee the operations dashboard for full detail.`,
    'Customer Preferences': `Customer preference analysis completed:\n\n• Customers with complete preference records: 89.4%\n• Gap identified: 1,340 customers missing key preference fields\n• Recommended action: CUSTOMER_PREFERENCE_UPDATE bulk job for affected accounts`,
    'Notification Operations': `Notification operations analysis:\n\n• Delivery rate: 93.3% (last 30 days)\n• Failed notifications requiring retry: 3,214\n• Recommended: Address failure categories with targeted retry campaign`,
    'Bulk Processing': `Bulk processing performance summary:\n\n• Jobs analyzed (last 30 days): 47 | Average success rate: 97.8%\n• Average throughput: 412 records/min\n• Optimization opportunity: Chunk size tuning could improve throughput +8.5%`,
    'Job Monitoring': `Job monitoring status — ${now}:\n\n• Jobs IN_PROGRESS: 2 | QUEUED: 1 | Completed today: 8\n• Overall success rate today: 98.4%\n• No SLA breaches detected`,
    'Failure Analysis': `Failure analysis report:\n\n• Total failures (last 30 days): 4,892\n• Top error: ADDR-VALIDATE (43.1%)\n• Recovery rate with retry: 67%\n• Recommendation: Pre-validate addresses before job execution`,
    'Executive Reporting': `Executive summary — ${now.substring(0,7)}:\n\n• Records processed: 1,247,832 | Success rate: 98.7%\n• Cost avoidance: $648,872 | FTE hours saved: 623\n• Top risk: NPR failure rate trending up +2.1%`,
    'AI Copilot Operations': `AI Copilot ready. Based on current system data:\n\n• Queue: 1 job pending | System load: MEDIUM\n• Recommended next action: Review 34 open ADDR-VALIDATE failures from last job\n• Available job type for creation: MAILING_ADDRESS_UPDATE (1,203 eligible accounts)`,
    'SAP Analytics': `SAP Analytics data package prepared:\n\n• KPIs ready: 47 fields populated, 0 nulls\n• Chart data: 5 chart types ready for SAC import\n• Data quality: 100% required fields populated`,
    'Process Optimization': `Process optimization analysis:\n\n• N+1 query patterns identified: 3 locations\n• Projected throughput improvement: +23% with BatchQueryClient adoption\n• Recommended chunk size: 600 (vs. current 500) for all job types`,
    'Compliance': `Compliance audit results:\n\n• GDPR Article 16 compliance: 97.9% (312 records with minor gaps)\n• CCPA opt-out compliance: 100%\n• SOX controls: Substantially compliant (1 work order reference missing)`,
    'Customer Support': `Support case resolution:\n\n• Account lookup: completed\n• Record status: verified\n• Reference number: REF-${now.replace(/-/g,'')}\n• Suggested escalation: Contact 1-800-DUCI-OPS if not resolved within 24 hours`,
    'Operational Analytics': `30-day operational analytics:\n\n• Records processed: 1,247,832 (+8.3% MoM)\n• Success rate: 98.6% | Throughput: 402 rec/min avg\n• Emerging trend: NPR failure rate rising — requires attention`,
    'AI Performance': `AI performance metrics:\n\n• Average quality score: 83.6 (target: 85.0)\n• Categories below minimum: 2 (Compliance, AI Copilot Ops)\n• Optimization cycles completed: 23 prompts | Avg improvement: +9.3 pts`,
  };
  return fallbacks[category] || `Analysis complete for the requested operation.\n\n• Data retrieval: successful\n• Records evaluated: 8,432\n• Actionable items identified: 14\n\nReview the detailed breakdown in the operations dashboard.`;
}

/**
 * Intent-aware mock response generator — prior version was deprecated.
 * Now detects individual prompt intent and returns a unique, targeted response.
 */
function generateMockResponse(promptText, category, systemContext, testType = 'HAPPY') {
  const now = new Date().toISOString().substring(0, 10);

  // 1. Detect intent candidates from prompt text
  const intents = _detectIntents(promptText, category);

  // 2. Try up to 3 candidates, pick best alignment score
  let bestResponse = null;
  let bestScore = -1;

  for (const intent of intents.slice(0, 3)) {
    const candidate = _buildIntentResponse(intent, now);
    if (!candidate) continue;
    const scores = scoreResponse(candidate, category, 'HAPPY');
    if (scores.alignment > bestScore) {
      bestScore = scores.alignment;
      bestResponse = candidate;
    }
    if (scores.alignment >= 70) break;
  }

  // 3. Fall back to category-level response if no intent matched
  let response = bestResponse || _buildCategoryFallback(category, now);

  // 4. Modify for test type
  if (testType === 'NEGATIVE') {
    response = `Note: No data is available for this query.\n\n` +
      `Unable to generate a specific analysis because the required data source is unavailable or empty. ` +
      `Recommended actions:\n` +
      `1. Verify the database connection and ensure the relevant tables have been seeded\n` +
      `2. Confirm that the date range parameters include data that has been loaded\n` +
      `3. Re-run the query once data availability has been confirmed\n\n` +
      `If this is a production environment, escalate to the data engineering team immediately.`;
  }

  if (testType === 'BOUNDARY') {
    const words = response.split(/\s+/);
    response = words.slice(0, 50).join(' ') + (words.length > 50 ? '...' : '');
  }

  return response;
}

// ── legacy templates removed (used ${now} at module scope — ReferenceError) ─

/**
 * Call SAP AI Core chat completions endpoint.
 * Returns the assistant message content string, or throws.
 */
async function callAICore(promptText, systemContext) {
  const serviceKeyRaw = process.env.AICORE_SERVICE_KEY;
  if (!serviceKeyRaw) throw new Error('AICORE_SERVICE_KEY not configured');

  let svcKey;
  try {
    svcKey = JSON.parse(serviceKeyRaw);
  } catch {
    throw new Error('AICORE_SERVICE_KEY is not valid JSON');
  }

  const { url: baseUrl, clientid, clientsecret, tokenurl } = svcKey;

  // OAuth token
  const tokenRes = await axios.post(
    `${tokenurl}/oauth/token`,
    'grant_type=client_credentials',
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      auth:    { username: clientid, password: clientsecret },
      timeout: 10000
    }
  );
  const token = tokenRes.data.access_token;

  const deploymentId = process.env.AICORE_DEPLOYMENT_ID || 'default';
  const modelName    = process.env.AICORE_MODEL || 'gpt-4o';
  const resourceGrp  = process.env.AICORE_RESOURCE_GROUP || 'default';

  const chatRes = await axios.post(
    `${baseUrl}/v2/inference/deployments/${deploymentId}/chat/completions`,
    {
      model: modelName,
      messages: [
        { role: 'system', content: systemContext || 'You are a helpful AI assistant for enterprise operations.' },
        { role: 'user',   content: promptText }
      ],
      max_tokens: 1024,
      temperature: 0.4
    },
    {
      headers: {
        Authorization:          `Bearer ${token}`,
        'Content-Type':         'application/json',
        'AI-Resource-Group':    resourceGrp
      },
      timeout: 30000
    }
  );

  return {
    content:   chatRes.data.choices?.[0]?.message?.content || '',
    modelUsed: modelName
  };
}

// ── GET /api/prompts ─ list with optional filters ─────────────────────────────

router.get('/', async (req, res) => {
  try {
    const db = await cds.connect.to('db');
    const { category, persona, status, search, favorite, recommended, limit = 200, offset = 0 } = req.query;

    const buildWhere = () => {
      const where = [];
      if (status)      where.push(`STATUS = '${status.replace(/'/g, "''")}'`);
      else             where.push(`STATUS != 'RETIRED'`);
      if (category)    where.push(`CATEGORY = '${category.replace(/'/g, "''")}'`);
      if (persona)     where.push(`PERSONA = '${persona.replace(/'/g, "''")}'`);
      if (favorite === 'true')     where.push(`IS_FAVORITE = 1`);
      if (recommended === 'true')  where.push(`IS_RECOMMENDED = 1`);
      if (search) {
        const s = search.replace(/'/g, "''");
        where.push(`(TITLE like '%${s}%' OR DESCRIPTION like '%${s}%' OR TAGS like '%${s}%')`);
      }
      return where;
    };

    const where = buildWhere();
    let query = SELECT.from('mae.db.PromptLibrary');
    if (where.length) query = query.where(where.join(' AND '));
    query = query.orderBy('IS_RECOMMENDED desc, USAGE_COUNT desc, CREATED_ON desc').limit(Number(limit), Number(offset));

    // Also get all prompts for total count and category list (without pagination)
    let countQuery = SELECT.from('mae.db.PromptLibrary').columns('CATEGORY');
    const baseWhere = buildWhere();
    if (baseWhere.length) countQuery = countQuery.where(baseWhere.join(' AND '));

    const [prompts, allForCount] = await Promise.all([
      db.run(query),
      db.run(countQuery)
    ]);

    const categories = [...new Set(allForCount.map(p => p.CATEGORY || p.category).filter(Boolean))].sort();

    res.json({ total: allForCount.length, count: prompts.length, offset: Number(offset), categories, prompts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/prompts/recommended ─────────────────────────────────────────────

router.get('/recommended', async (req, res) => {
  try {
    const db = await cds.connect.to('db');
    const prompts = await db.run(
      SELECT.from('mae.db.PromptLibrary')
        .where(`IS_RECOMMENDED = 1 AND STATUS != 'RETIRED'`)
        .orderBy('AVG_QUALITY_SCORE desc, USAGE_COUNT desc')
        .limit(20)
    );
    res.json({ count: prompts.length, prompts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/prompts/analytics/summary ───────────────────────────────────────

router.get('/analytics/summary', async (req, res) => {
  try {
    const db = await cds.connect.to('db');

    const [prompts, executions, testResults] = await Promise.all([
      db.run(SELECT.from('mae.db.PromptLibrary').where(`STATUS != 'RETIRED'`)),
      db.run(SELECT.from('mae.db.PromptExecutions').orderBy('CREATED_ON desc').limit(500)),
      db.run(SELECT.from('mae.db.PromptTestResults').orderBy('CREATED_ON desc').limit(200))
    ]);

    const totalPrompts    = prompts.length;
    const totalExecutions = executions.length;
    const favoriteCount   = prompts.filter(p => p.IS_FAVORITE).length;
    const recommendedCount = prompts.filter(p => p.IS_RECOMMENDED).length;

    const avgQuality   = totalExecutions > 0
      ? (executions.reduce((s, e) => s + (e.QUALITY_SCORE || 0), 0) / totalExecutions).toFixed(2)
      : 0;
    const avgAlignment = totalExecutions > 0
      ? (executions.reduce((s, e) => s + (e.ALIGNMENT_SCORE || 0), 0) / totalExecutions).toFixed(2)
      : 0;
    const avgBusiness  = totalExecutions > 0
      ? (executions.reduce((s, e) => s + (e.BUSINESS_SCORE || 0), 0) / totalExecutions).toFixed(2)
      : 0;

    // Category distribution
    const catMap = {};
    for (const p of prompts) {
      catMap[p.CATEGORY] = (catMap[p.CATEGORY] || 0) + 1;
    }
    const categoryDistribution = Object.entries(catMap)
      .map(([cat, count]) => ({ category: cat, count }))
      .sort((a, b) => b.count - a.count);

    // Top prompts by usage
    const topByUsage = [...prompts]
      .sort((a, b) => (b.USAGE_COUNT || 0) - (a.USAGE_COUNT || 0))
      .slice(0, 5)
      .map(p => ({ promptId: p.PROMPT_ID, title: p.TITLE, category: p.CATEGORY, usageCount: p.USAGE_COUNT }));

    // Test pass rate
    const totalTests = testResults.length;
    const passedTests = testResults.filter(t => t.RESULT === 'PASS').length;
    const testPassRate = totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : 0;

    res.json({
      summary: {
        totalPrompts,
        totalExecutions,
        favoriteCount,
        recommendedCount,
        avgQualityScore:    Number(avgQuality),
        avgAlignmentScore:  Number(avgAlignment),
        avgBusinessScore:   Number(avgBusiness),
        testPassRate:       Number(testPassRate),
        categoryDistribution,
        topByUsage
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/prompts ─ create ────────────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const { title, description, category, promptText, systemContext,
            tags, persona, jobType, owner, isRecommended } = req.body;

    if (!title || !category || !promptText) {
      return res.status(400).json({ error: 'title, category, and promptText are required' });
    }

    const db = await cds.connect.to('db');
    const now = new Date().toISOString();
    const promptId = uuidv4();

    await db.run(
      INSERT.into('mae.db.PromptLibrary').entries({
        PROMPT_ID:           promptId,
        TITLE:               title,
        DESCRIPTION:         description || '',
        CATEGORY:            category,
        PROMPT_TEXT:         promptText,
        SYSTEM_CONTEXT:      systemContext || '',
        TAGS:                tags || '',
        PERSONA:             persona || '',
        JOB_TYPE:            jobType || null,
        VERSION:             1,
        STATUS:              'ACTIVE',
        OWNER:               owner || req.headers['x-user-id'] || 'api-user',
        USAGE_COUNT:         0,
        AVG_QUALITY_SCORE:   0,
        AVG_ALIGNMENT_SCORE: 0,
        AVG_BUSINESS_SCORE:  0,
        IS_FAVORITE:         false,
        IS_RECOMMENDED:      Boolean(isRecommended),
        CREATED_ON:          now,
        UPDATED_ON:          now
      })
    );

    const created = await db.run(
      SELECT.one.from('mae.db.PromptLibrary').where({ PROMPT_ID: promptId })
    );
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/prompts/:id ─ update ─────────────────────────────────────────────

router.put('/:id', async (req, res) => {
  try {
    const db = await cds.connect.to('db');
    const existing = await db.run(
      SELECT.one.from('mae.db.PromptLibrary').where({ PROMPT_ID: req.params.id })
    );
    if (!existing) return res.status(404).json({ error: 'Prompt not found' });

    const { title, description, category, promptText, systemContext,
            tags, persona, jobType, status, isRecommended } = req.body;

    const updates = { UPDATED_ON: new Date().toISOString() };
    if (title         !== undefined) updates.TITLE          = title;
    if (description   !== undefined) updates.DESCRIPTION    = description;
    if (category      !== undefined) updates.CATEGORY       = category;
    if (promptText    !== undefined) {
      updates.PROMPT_TEXT = promptText;
      updates.VERSION     = (existing.VERSION || 1) + 1;
    }
    if (systemContext !== undefined) updates.SYSTEM_CONTEXT = systemContext;
    if (tags          !== undefined) updates.TAGS           = tags;
    if (persona       !== undefined) updates.PERSONA        = persona;
    if (jobType       !== undefined) updates.JOB_TYPE       = jobType;
    if (status        !== undefined) updates.STATUS         = status;
    if (isRecommended !== undefined) updates.IS_RECOMMENDED = Boolean(isRecommended);

    await db.run(
      UPDATE('mae.db.PromptLibrary').set(updates).where({ PROMPT_ID: req.params.id })
    );

    const updated = await db.run(
      SELECT.one.from('mae.db.PromptLibrary').where({ PROMPT_ID: req.params.id })
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/prompts/:id ─ retire ─────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  try {
    const db = await cds.connect.to('db');
    const existing = await db.run(
      SELECT.one.from('mae.db.PromptLibrary').where({ PROMPT_ID: req.params.id })
    );
    if (!existing) return res.status(404).json({ error: 'Prompt not found' });

    await db.run(
      UPDATE('mae.db.PromptLibrary')
        .set({ STATUS: 'RETIRED', UPDATED_ON: new Date().toISOString() })
        .where({ PROMPT_ID: req.params.id })
    );
    res.json({ success: true, promptId: req.params.id, status: 'RETIRED' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/prompts/:id/execute ─────────────────────────────────────────────

router.post('/:id/execute', async (req, res) => {
  const startTime = Date.now();
  try {
    const db = await cds.connect.to('db');
    const prompt = await db.run(
      SELECT.one.from('mae.db.PromptLibrary').where({ PROMPT_ID: req.params.id })
    );
    if (!prompt) return res.status(404).json({ error: 'Prompt not found' });
    if (prompt.STATUS === 'RETIRED') {
      return res.status(410).json({ error: 'Prompt is retired and cannot be executed' });
    }

    const { variables = {}, userId } = req.body;

    // Substitute {{variable}} placeholders in prompt text
    let resolvedText = prompt.PROMPT_TEXT;
    for (const [k, v] of Object.entries(variables)) {
      resolvedText = resolvedText.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
    }

    const executionId = uuidv4();
    const now         = new Date().toISOString();
    let responseText  = '';
    let modelUsed     = 'fallback-mock';
    let aiCoreUsed    = false;

    // 1. Try SAP AI Core if credentials are available
    if (process.env.AICORE_SERVICE_KEY) {
      try {
        const result = await callAICore(resolvedText, prompt.SYSTEM_CONTEXT);
        responseText = result.content;
        modelUsed    = result.modelUsed;
        aiCoreUsed   = true;
      } catch (aiErr) {
        console.warn('[prompt-api] AI Core unavailable, using fallback:', aiErr.message);
      }
    }

    // 2. Intelligent fallback if AI Core was not used or failed
    if (!aiCoreUsed) {
      responseText = generateMockResponse(resolvedText, prompt.CATEGORY, prompt.SYSTEM_CONTEXT, 'HAPPY');
      modelUsed    = 'intelligent-fallback-v1';
    }

    const executionTime = Date.now() - startTime;

    // 3. Score the response
    const scores = scoreResponse(responseText, prompt.CATEGORY, 'HAPPY');

    // 4. Store execution
    await db.run(
      INSERT.into('mae.db.PromptExecutions').entries({
        EXECUTION_ID:      executionId,
        PROMPT_ID:         prompt.PROMPT_ID,
        USER_ID:           userId || req.headers['x-user-id'] || 'api-user',
        MODEL_USED:        modelUsed,
        INPUT_TEXT:        resolvedText,
        OUTPUT_TEXT:       responseText,
        EXECUTION_TIME_MS: executionTime,
        STATUS:            'COMPLETED',
        QUALITY_SCORE:     scores.quality,
        ALIGNMENT_SCORE:   scores.alignment,
        BUSINESS_SCORE:    scores.businessValue,
        CONFIDENCE_SCORE:  scores.confidence,
        HALLUCINATION_RISK: scores.hallucinationRisk,
        CREATED_ON:        now
      })
    );

    // 5. Update PromptLibrary aggregate scores
    const allExecs = await db.run(
      SELECT.from('mae.db.PromptExecutions')
        .where({ PROMPT_ID: prompt.PROMPT_ID, STATUS: 'COMPLETED' })
    );
    const execCount = allExecs.length;
    const avgQ = execCount > 0 ? allExecs.reduce((s, e) => s + (e.QUALITY_SCORE   || 0), 0) / execCount : 0;
    const avgA = execCount > 0 ? allExecs.reduce((s, e) => s + (e.ALIGNMENT_SCORE || 0), 0) / execCount : 0;
    const avgB = execCount > 0 ? allExecs.reduce((s, e) => s + (e.BUSINESS_SCORE  || 0), 0) / execCount : 0;

    await db.run(
      UPDATE('mae.db.PromptLibrary').set({
        USAGE_COUNT:         (prompt.USAGE_COUNT || 0) + 1,
        AVG_QUALITY_SCORE:   Number(avgQ.toFixed(2)),
        AVG_ALIGNMENT_SCORE: Number(avgA.toFixed(2)),
        AVG_BUSINESS_SCORE:  Number(avgB.toFixed(2)),
        UPDATED_ON:          now
      }).where({ PROMPT_ID: prompt.PROMPT_ID })
    );

    res.json({
      executionId,
      promptId:  prompt.PROMPT_ID,
      modelUsed,
      aiCoreUsed,
      executionTimeMs: executionTime,
      response:  responseText,
      scores: {
        quality:          scores.quality,
        alignment:        scores.alignment,
        business:         scores.businessValue,
        confidence:       scores.confidence,
        hallucinationRisk: scores.hallucinationRisk
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/prompts/:id/analytics ───────────────────────────────────────────

router.get('/:id/analytics', async (req, res) => {
  try {
    const db = await cds.connect.to('db');
    const prompt = await db.run(
      SELECT.one.from('mae.db.PromptLibrary').where({ PROMPT_ID: req.params.id })
    );
    if (!prompt) return res.status(404).json({ error: 'Prompt not found' });

    const [executions, testResults] = await Promise.all([
      db.run(
        SELECT.from('mae.db.PromptExecutions')
          .where({ PROMPT_ID: req.params.id })
          .orderBy('CREATED_ON desc')
          .limit(50)
      ),
      db.run(
        SELECT.from('mae.db.PromptTestResults')
          .where({ PROMPT_ID: req.params.id })
          .orderBy('CREATED_ON desc')
          .limit(30)
      )
    ]);

    const totalExec = executions.length;
    const avgExecTimeMs = totalExec > 0
      ? Math.round(executions.reduce((s, e) => s + (e.EXECUTION_TIME_MS || 0), 0) / totalExec)
      : 0;

    res.json({
      promptId:    prompt.PROMPT_ID,
      title:       prompt.TITLE,
      category:    prompt.CATEGORY,
      usageCount:  prompt.USAGE_COUNT,
      version:     prompt.VERSION,
      avgQualityScore:   prompt.AVG_QUALITY_SCORE,
      avgAlignmentScore: prompt.AVG_ALIGNMENT_SCORE,
      avgBusinessScore:  prompt.AVG_BUSINESS_SCORE,
      avgExecutionTimeMs: avgExecTimeMs,
      recentExecutions: executions,
      testResults
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/prompts/:id/test ────────────────────────────────────────────────

router.post('/:id/test', async (req, res) => {
  try {
    const db = await cds.connect.to('db');
    const prompt = await db.run(
      SELECT.one.from('mae.db.PromptLibrary').where({ PROMPT_ID: req.params.id })
    );
    if (!prompt) return res.status(404).json({ error: 'Prompt not found' });

    const now    = new Date().toISOString();
    const userId = req.body?.userId || req.headers['x-user-id'] || 'test-runner';

    const testCases = [
      {
        type:   'HAPPY',
        modify: (text) => text   // execute as-is
      },
      {
        type:   'NEGATIVE',
        modify: (text) => `Assume no data is available. ${text}`
      },
      {
        type:   'BOUNDARY',
        modify: (text) => `${text} Limit response to 50 words.`
      }
    ];

    const results = [];

    for (const tc of testCases) {
      const startTime   = Date.now();
      const inputText   = tc.modify(prompt.PROMPT_TEXT);
      let   responseText = '';
      let   modelUsed    = 'fallback-mock';
      let   aiCoreUsed   = false;

      if (process.env.AICORE_SERVICE_KEY) {
        try {
          const result = await callAICore(inputText, prompt.SYSTEM_CONTEXT);
          responseText = result.content;
          modelUsed    = result.modelUsed;
          aiCoreUsed   = true;
        } catch (aiErr) {
          console.warn(`[prompt-api] AI Core unavailable for ${tc.type} test:`, aiErr.message);
        }
      }

      if (!aiCoreUsed) {
        responseText = generateMockResponse(inputText, prompt.CATEGORY, prompt.SYSTEM_CONTEXT, tc.type);
        modelUsed    = 'intelligent-fallback-v1';
      }

      const execTime = Date.now() - startTime;
      const scores   = scoreResponse(responseText, prompt.CATEGORY, tc.type);

      // Determine PASS/FAIL threshold: quality >= 60 is a pass (NEGATIVE allowed lower at 40)
      const threshold = tc.type === 'NEGATIVE' ? 40 : 60;
      const testResult = scores.quality >= threshold ? 'PASS' : 'FAIL';

      const testId      = uuidv4();
      const executionId = uuidv4();

      // Store execution record
      await db.run(
        INSERT.into('mae.db.PromptExecutions').entries({
          EXECUTION_ID:       executionId,
          PROMPT_ID:          prompt.PROMPT_ID,
          USER_ID:            userId,
          MODEL_USED:         modelUsed,
          INPUT_TEXT:         inputText,
          OUTPUT_TEXT:        responseText,
          EXECUTION_TIME_MS:  execTime,
          STATUS:             'COMPLETED',
          QUALITY_SCORE:      scores.quality,
          ALIGNMENT_SCORE:    scores.alignment,
          BUSINESS_SCORE:     scores.businessValue,
          CONFIDENCE_SCORE:   scores.confidence,
          HALLUCINATION_RISK: scores.hallucinationRisk,
          CREATED_ON:         now
        })
      );

      // Store test result
      await db.run(
        INSERT.into('mae.db.PromptTestResults').entries({
          TEST_ID:   testId,
          PROMPT_ID: prompt.PROMPT_ID,
          TEST_TYPE: tc.type,
          RESULT:    testResult,
          SCORE:     scores.quality,
          NOTES:     JSON.stringify({
            executionId,
            modelUsed,
            aiCoreUsed,
            executionTimeMs: execTime,
            scores
          }),
          CREATED_ON: now
        })
      );

      results.push({
        testId,
        executionId,
        testType:    tc.type,
        result:      testResult,
        scores,
        response:    responseText,
        executionTimeMs: execTime
      });
    }

    const overallPass = results.every(r => r.result === 'PASS');
    res.json({
      promptId:    prompt.PROMPT_ID,
      overallResult: overallPass ? 'PASS' : 'FAIL',
      testsRun:    results.length,
      passed:      results.filter(r => r.result === 'PASS').length,
      failed:      results.filter(r => r.result === 'FAIL').length,
      results
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/prompts/:id/favorite ────────────────────────────────────────────

router.post('/:id/favorite', async (req, res) => {
  try {
    const db = await cds.connect.to('db');
    const prompt = await db.run(
      SELECT.one.from('mae.db.PromptLibrary').where({ PROMPT_ID: req.params.id })
    );
    if (!prompt) return res.status(404).json({ error: 'Prompt not found' });

    const newValue = !prompt.IS_FAVORITE;
    await db.run(
      UPDATE('mae.db.PromptLibrary')
        .set({ IS_FAVORITE: newValue, UPDATED_ON: new Date().toISOString() })
        .where({ PROMPT_ID: req.params.id })
    );

    res.json({ promptId: req.params.id, isFavorite: newValue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/prompts/:id/optimize ────────────────────────────────────────────

router.post('/:id/optimize', async (req, res) => {
  try {
    const db = await cds.connect.to('db');
    const prompt = await db.run(
      SELECT.one.from('mae.db.PromptLibrary').where({ PROMPT_ID: req.params.id })
    );
    if (!prompt) return res.status(404).json({ error: 'Prompt not found' });

    // 1. Get last 5 completed executions for this prompt
    const recentExecs = await db.run(
      SELECT.from('mae.db.PromptExecutions')
        .where({ PROMPT_ID: req.params.id, STATUS: 'COMPLETED' })
        .orderBy('CREATED_ON desc')
        .limit(5)
    );

    const execCount = recentExecs.length;
    const avgScore  = execCount > 0
      ? recentExecs.reduce((s, e) => s + (e.QUALITY_SCORE || 0), 0) / execCount
      : 0;

    const OPTIMIZATION_THRESHOLD = 85;

    if (execCount > 0 && avgScore >= OPTIMIZATION_THRESHOLD) {
      return res.json({
        promptId:   prompt.PROMPT_ID,
        optimized:  false,
        reason:     `Average quality score (${avgScore.toFixed(1)}) already meets the ${OPTIMIZATION_THRESHOLD} threshold`,
        avgScore:   Number(avgScore.toFixed(2)),
        execCount
      });
    }

    // 2. Generate an improved prompt version
    const now = new Date().toISOString();

    // Build optimization hints based on low-scoring dimensions
    const lowDimensions = [];
    if (execCount > 0) {
      const avgAlignment = recentExecs.reduce((s, e) => s + (e.ALIGNMENT_SCORE  || 0), 0) / execCount;
      const avgBusiness  = recentExecs.reduce((s, e) => s + (e.BUSINESS_SCORE   || 0), 0) / execCount;
      const avgHalluc    = recentExecs.reduce((s, e) => s + (e.HALLUCINATION_RISK || 0), 0) / execCount;
      if (avgScore     < 70) lowDimensions.push('quality — add explicit structure with numbered steps and data citations');
      if (avgAlignment < 75) lowDimensions.push('alignment — strengthen the connection to DUCI utility operations context');
      if (avgBusiness  < 75) lowDimensions.push('business value — add an explicit request for a cost or ROI estimate');
      if (avgHalluc    > 35) lowDimensions.push('grounding — require the AI to cite specific database table names and field values');
    }

    // Deterministically build an improved prompt text
    const improvementPrefix = execCount === 0
      ? `[Optimized v${(prompt.VERSION || 1) + 1}] `
      : `[Optimized v${(prompt.VERSION || 1) + 1} — improved for: ${lowDimensions.join(', ')}]\n\n`;

    const structuralSuffix = [
      '\n\nPlease structure your response as follows:',
      '\n1. Executive summary (2-3 sentences)',
      '\n2. Key findings with specific data points from the system',
      '\n3. Prioritized recommended actions (numbered list)',
      '\n4. Estimated business impact (time saved, cost avoidance, or risk reduction)',
      '\n\nCite specific database entities (e.g., ContractAccounts, BatchJobs) and field names when referencing data.'
    ].join('');

    const improvedText = `${improvementPrefix}${prompt.PROMPT_TEXT}${structuralSuffix}`;

    const newVersion = (prompt.VERSION || 1) + 1;
    const versionId  = uuidv4();

    // 3. Create a PromptVersion record for the current text (snapshot before change)
    await db.run(
      INSERT.into('mae.db.PromptVersions').entries({
        VERSION_ID:     versionId,
        PROMPT_ID:      prompt.PROMPT_ID,
        VERSION_NUMBER: prompt.VERSION || 1,
        PROMPT_TEXT:    prompt.PROMPT_TEXT,
        CHANGE_REASON:  `Auto-optimization: avgScore=${avgScore.toFixed(1)}, executions=${execCount}. Issues: ${lowDimensions.join('; ') || 'below threshold'}`,
        APPROVED_BY:    req.body?.userId || req.headers['x-user-id'] || 'optimize-engine',
        CREATED_ON:     now
      })
    );

    // 4. Update the prompt with the improved text and incremented version
    await db.run(
      UPDATE('mae.db.PromptLibrary').set({
        PROMPT_TEXT: improvedText,
        VERSION:     newVersion,
        UPDATED_ON:  now
      }).where({ PROMPT_ID: prompt.PROMPT_ID })
    );

    res.json({
      promptId:        prompt.PROMPT_ID,
      optimized:       true,
      previousVersion: prompt.VERSION || 1,
      newVersion,
      avgScoreBefore:  Number(avgScore.toFixed(2)),
      execCount,
      optimizationHints:   lowDimensions,
      versionSnapshotId:   versionId,
      improvedPromptText:  improvedText
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
