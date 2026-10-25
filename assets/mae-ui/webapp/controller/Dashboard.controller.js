sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "com/duci/mae/cdop/service/BulkJobService"
], function (Controller, JSONModel, MessageToast, BulkJobService) {
  "use strict";

  return Controller.extend("com.duci.mae.cdop.controller.Dashboard", {

    onInit: function () {
      const dashboardModel = new JSONModel({
        kpi: {
          recordsModernized: 0,
          successRate: 0,
          jobsCompleted: 0,
          failedJobs: 0,
          hoursSaved: 0,
          aiRecoveries: 0,
          costAvoidance: 0
        },
        loading: true
      });
      this.getView().setModel(dashboardModel, "dashboard");
      this._loadKPIs();
      this._startAutoRefresh();
    },

    _loadKPIs: async function () {
      try {
        const now     = new Date();
        const from30  = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const summary = await BulkJobService.getExecutiveSummary(
          from30.toISOString().substring(0, 10),
          now.toISOString().substring(0, 10)
        );

        const data    = typeof summary === 'string' ? JSON.parse(summary) : summary;
        const s       = data?.summary || {};

        this.getView().getModel("dashboard").setData({
          kpi: {
            recordsModernized: Math.round((s.totalSuccess || 0) / 1000),
            successRate:       parseFloat((s.overallSuccessRate || '0').replace('%', '')),
            jobsCompleted:     s.completedJobs || 0,
            failedJobs:        s.failedJobs || 0,
            hoursSaved:        parseFloat(s.estimatedHoursSaved || 0),
            aiRecoveries:      Math.round((s.totalSuccess || 0) * 0.15),
            costAvoidance:     Math.round((s.totalSuccess || 0) * 0.12)
          },
          loading: false
        });
      } catch (err) {
        console.error('KPI load failed:', err);
        this.getView().getModel("dashboard").setProperty("/loading", false);
      }
    },

    _startAutoRefresh: function () {
      this._refreshTimer = setInterval(() => this._loadKPIs(), 30000);
    },

    onExit: function () {
      if (this._refreshTimer) clearInterval(this._refreshTimer);
    },

    onRefresh: function () {
      MessageToast.show("Refreshing dashboard...");
      this._loadKPIs();
    },

    onCreateJob: function () {
      this.getOwnerComponent().getRouter().navTo("createJob");
    },

    onJobPress: function (oEvent) {
      const batchId = oEvent.getSource().getBindingContext()?.getProperty("BATCH_ID");
      if (batchId) {
        this.getOwnerComponent().getRouter().navTo("failureAnalysis", { batchId });
      }
    },

    onKpiPress: function () {
      this.getOwnerComponent().getRouter().navTo("executiveSummary");
    },

    onLaunchDemo: async function () {
      try {
        const result = await BulkJobService.createJob({
          jobType: "MAILING_ADDRESS_UPDATE",
          parameters: {
            filter: { city: "Allentown", daysBack: 90 },
            useExistingAddressHistory: true
          },
          simulationMode: false,
          description: "DUCI Demo: Allentown mailing address campaign"
        });
        MessageToast.show(`Demo job created: ${result.batchId}`);
        this.getOwnerComponent().getRouter().navTo("jobMonitor");
      } catch (err) {
        sap.m.MessageBox.error(`Failed to create demo job: ${err.message}`);
      }
    },

    onLaunchDemoSimulation: async function () {
      try {
        const result = await BulkJobService.createJob({
          jobType: "MAILING_ADDRESS_UPDATE",
          parameters: {
            filter: { city: "Allentown", daysBack: 90 },
            useExistingAddressHistory: true
          },
          simulationMode: true,
          description: "DUCI Demo: Allentown simulation run"
        });
        MessageToast.show(`Simulation job created: ${result.batchId}`);
        this.getOwnerComponent().getRouter().navTo("jobMonitor");
      } catch (err) {
        sap.m.MessageBox.error(`Failed: ${err.message}`);
      }
    }
  });
});
