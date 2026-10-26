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
      const now  = new Date();
      const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const model = new JSONModel({
        fromDate: from.toISOString().substring(0, 10),
        toDate:   now.toISOString().substring(0, 10),
        loading:  false,
        summary: {
          totalSuccess:        0,
          overallSuccessRate:  0,
          completedJobs:       0,
          failedJobs:          0,
          estimatedHoursSaved: 0,
          totalAccounts:       0,
          aiRecoveries:        0,
          costAvoidance:       0
        },
        jobs:      [],
        narrative: ""
      });
      this.getView().setModel(model, "exec");

      const router = this.getOwnerComponent().getRouter();
      router.getRoute("executiveSummary").attachPatternMatched(this._onRouteMatched, this);
    },

    _onRouteMatched: function () {
      this.onGenerate();
    },

    onGenerate: async function () {
      const m    = this.getView().getModel("exec");
      const from = m.getProperty("/fromDate");
      const to   = m.getProperty("/toDate");
      m.setProperty("/loading", true);
      try {
        const data = await BulkJobService.getExecutiveSummary(from, to);
        const s    = (data && data.summary) ? data.summary : {};

        m.setProperty("/summary", {
          totalSuccess:        s.totalSuccess        || 0,
          overallSuccessRate:  s.overallSuccessRate   || 0,
          completedJobs:       s.completedJobs        || 0,
          failedJobs:          s.failedJobs           || 0,
          estimatedHoursSaved: s.estimatedHoursSaved  || 0,
          totalAccounts:       s.totalAccounts        || 0,
          aiRecoveries:        s.aiRecoveries         || 0,
          costAvoidance:       s.costAvoidance        || 0
        });
        m.setProperty("/jobs",      data.jobs || []);
        m.setProperty("/narrative", this._buildNarrative(s, from, to));
        m.setProperty("/loading",   false);
        MessageToast.show("Executive summary loaded");
      } catch (err) {
        m.setProperty("/loading", false);
        MessageBox.error("Failed to load summary: " + err.message);
      }
    },

    _buildNarrative: function (s, from, to) {
      const successPct = typeof s.overallSuccessRate === 'number'
        ? s.overallSuccessRate.toFixed(2) + '%'
        : (s.overallSuccessRate || '0%');
      return "From " + from + " to " + to + ", DUCI processed " +
             (s.totalAccounts || 0).toLocaleString() + " customer account records " +
             "across " + (s.totalJobs || 0) + " bulk jobs. Overall success rate: " + successPct + ". " +
             (s.completedJobs || 0) + " jobs completed successfully, " +
             (s.partialJobs || 0) + " partially completed, " +
             (s.failedJobs || 0) + " failed. Estimated " +
             (s.estimatedHoursSaved || 0) + " hours saved versus manual processing. " +
             "AI auto-recovered " + (s.aiRecoveries || 0) + " records via retry. " +
             "Estimated cost avoidance: $" + (s.costAvoidance || 0).toLocaleString() + ".";
    },

    onExport: function () {
      MessageToast.show("Export to PDF/Excel — available in production deployment");
    }
  });
});
