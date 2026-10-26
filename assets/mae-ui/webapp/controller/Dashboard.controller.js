sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageToast",
  "com/duci/mae/cdop/service/BulkJobService"
], function (Controller, JSONModel, Filter, FilterOperator, MessageToast, BulkJobService) {
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
          costAvoidance: 0,
          totalAccounts: 0
        },
        loading: true,
        lastRefresh: null,
        error: null
      });
      this.getView().setModel(dashboardModel, "dashboard");
      this._loadKPIs();
      this._startAutoRefresh();
      // Apply list filters after view is rendered
      setTimeout(() => this._applyDashboardListFilters(), 0);

      const router = this.getOwnerComponent().getRouter();
      router.getRoute("dashboard").attachPatternMatched(this._onRouteMatched, this);
    },

    _onRouteMatched: function () {
      this._loadKPIs();
      this._applyDashboardListFilters();
    },

    _loadKPIs: async function () {
      const model = this.getView().getModel("dashboard");
      model.setProperty("/loading", true);
      try {
        const now    = new Date();
        const from30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const data   = await BulkJobService.getExecutiveSummary(
          from30.toISOString().substring(0, 10),
          now.toISOString().substring(0, 10)
        );
        const s = (data && data.summary) ? data.summary : {};

        model.setData({
          kpi: {
            recordsModernized: Math.round((s.totalSuccess || 0) / 1000),
            successRate:       s.overallSuccessRate  || 0,
            jobsCompleted:     s.completedJobs       || 0,
            failedJobs:        s.failedJobs          || 0,
            hoursSaved:        s.estimatedHoursSaved || 0,
            aiRecoveries:      s.aiRecoveries        || 0,
            costAvoidance:     Math.round((s.costAvoidance || 0) / 1000),
            totalAccounts:     s.totalAccounts       || 0
          },
          loading: false,
          lastRefresh: now.toLocaleTimeString(),
          error: null
        });
      } catch (err) {
        console.error('KPI load failed:', err);
        model.setProperty("/loading", false);
        model.setProperty("/error", err.message);
      }
    },

    _applyDashboardListFilters: function () {
      const oList = this.byId("activeJobsList");
      if (oList) {
        const oBinding = oList.getBinding("items");
        if (oBinding) {
          oBinding.filter([new Filter("STATUS", FilterOperator.EQ, "IN_PROGRESS")]);
        }
      }
      const oRecentList = this.byId("recentJobsList");
      if (oRecentList) {
        const oBinding = oRecentList.getBinding("items");
        if (oBinding) {
          oBinding.filter([new Filter({
            filters: [
              new Filter("STATUS", FilterOperator.EQ, "COMPLETED"),
              new Filter("STATUS", FilterOperator.EQ, "PARTIALLY_COMPLETED")
            ],
            and: false
          })]);
        }
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
