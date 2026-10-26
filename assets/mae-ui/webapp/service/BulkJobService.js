/**
 * BulkJobService — Frontend service module for REST API calls
 * Wraps /api/* endpoints with fetch
 */
sap.ui.define([], function () {
  "use strict";

  const BASE_URL = "/api";

  async function _fetch(path, options = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json", ...options.headers },
      ...options
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  }

  return {
    createJob: (payload) => _fetch(`/bulk-jobs/${payload.jobType}`, {
      method: "POST",
      body: JSON.stringify({ parameters: payload.parameters, simulationMode: payload.simulationMode, description: payload.description })
    }),
    getJobStatus:    (batchId) => _fetch(`/bulk-jobs/${batchId}/status`),
    getJobResult:    (batchId) => _fetch(`/bulk-jobs/${batchId}/result`),
    cancelJob:       (batchId) => _fetch(`/bulk-jobs/${batchId}/cancel`, { method: "POST" }),
    reprocessJob:    (batchId, opts) => _fetch(`/bulk-jobs/${batchId}/reprocess`, { method: "POST", body: JSON.stringify(opts) }),
    getBatchCustomers: (contractAccounts) => _fetch("/customers/batch", { method: "POST", body: JSON.stringify({ contractAccounts }) }),

    getExecutiveSummary: async (fromDate, toDate) => {
      const from = fromDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
      const to   = toDate   || new Date().toISOString().substring(0, 10);
      return _fetch(`/summary?fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}`);
    },

    getPerformanceMetrics: async () => {
      const res = await fetch('/odata/v4/BulkJobService/PerformanceMetrics?$top=100&$orderby=RECORDED_AT%20desc');
      if (!res.ok) return [];
      const d = await res.json();
      return d.value || [];
    },

    validateJob: async (payload) => {
      // Client-side pre-validation before API call
      const errors = [];
      if (!payload.jobType) errors.push("Job type is required");
      if (!payload.parameters) errors.push("Parameters are required");
      if (errors.length === 0 && payload.parameters?.contractAccounts?.length > 100000) {
        errors.push("Maximum 100,000 contract accounts per job");
      }
      return { valid: errors.length === 0, errors };
    }
  };
});
