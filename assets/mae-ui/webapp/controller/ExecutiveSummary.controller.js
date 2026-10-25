sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "com/duci/mae/cdop/service/BulkJobService"
], function (Controller, JSONModel, MessageToast, MessageBox, BulkJobService) {
  "use strict";

  return Controller.extend("com.duci.mae.cdop.controller.ExecutiveSummary", {

    onInit: function () {
      const now   = new Date();
      const from  = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const model = new JSONModel({
        fromDate: from.toISOString().substring(0, 10),
        toDate:   now.toISOString().substring(0, 10),
        summary:  {
          totalSuccess: 0,
          overallSuccessRatePct: 0,
          completedJobs: 0,
          failedJobs: 0,
          estimatedHoursSaved: 0,
          totalAccounts: 0
        },
        jobs: [],
        narrative: "Click 'Generate' to load executive summary for the selected period."
      });
      this.getView().setModel(model, "exec");
    },

    onGenerate: async function () {
      const m    = this.getView().getModel("exec");
      const from = m.getProperty("/fromDate");
      const to   = m.getProperty("/toDate");
      try {
        const raw  = await BulkJobService.getExecutiveSummary(from, to);
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const s    = data?.summary || {};

        m.setProperty("/summary", {
          totalSuccess:          s.totalSuccess || 0,
          overallSuccessRatePct: parseFloat((s.overallSuccessRate || '0').replace('%', '')),
          completedJobs:         s.completedJobs || 0,
          failedJobs:            s.failedJobs || 0,
          estimatedHoursSaved:   parseFloat(s.estimatedHoursSaved || 0),
          totalAccounts:         s.totalAccounts || 0
        });
        m.setProperty("/jobs", data.jobs || []);
        m.setProperty("/narrative", this._buildNarrative(s, from, to));
        MessageToast.show("Executive summary generated");
      } catch (err) {
        MessageBox.error(`Failed to generate summary: ${err.message}`);
      }
    },

    _buildNarrative: function (s, from, to) {
      return `From ${from} to ${to}, DUCI processed ${(s.totalAccounts || 0).toLocaleString()} customer account records ` +
             `across ${s.totalJobs || 0} bulk jobs. Overall success rate: ${s.overallSuccessRate || '0%'}. ` +
             `${s.completedJobs || 0} jobs completed successfully, ${s.partialJobs || 0} partially completed, ` +
             `${s.failedJobs || 0} failed. Estimated ${s.estimatedHoursSaved || 0} hours saved versus manual processing.`;
    },

    onExport: function () {
      MessageToast.show("Export to PDF/Excel — available in production deployment");
    }
  });
});
