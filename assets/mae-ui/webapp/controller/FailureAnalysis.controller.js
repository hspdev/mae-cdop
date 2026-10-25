sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "com/duci/mae/cdop/service/BulkJobService"
], function (Controller, JSONModel, Filter, FilterOperator, MessageToast, MessageBox, BulkJobService) {
  "use strict";

  return Controller.extend("com.duci.mae.cdop.controller.FailureAnalysis", {

    onInit: function () {
      const model = new JSONModel({
        batchId: null,
        job: {},
        successRate: "0%",
        totalFailures: 0,
        errorPatterns: []
      });
      this.getView().setModel(model, "failure");

      const router = this.getOwnerComponent().getRouter();
      router.getRoute("failureAnalysis").attachPatternMatched(this._onRouteMatched, this);
    },

    _onRouteMatched: async function (oEvent) {
      const batchId = oEvent.getParameter("arguments").batchId;
      if (batchId) {
        this.getView().getModel("failure").setProperty("/batchId", batchId);
        await this._loadJobData(batchId);
      }
    },

    _loadJobData: async function (batchId) {
      try {
        const result = await BulkJobService.getJobResult(batchId);
        const model  = this.getView().getModel("failure");

        const successRate = result.totalAccounts > 0
          ? ((result.successCount / result.totalAccounts) * 100).toFixed(1) + '%'
          : '0%';

        // Calculate error patterns
        const errorMap = {};
        (result.failedAccounts || []).forEach(f => {
          const code = f.ERROR_CODE || 'UNKNOWN';
          if (!errorMap[code]) errorMap[code] = { errorCode: code, count: 0, sample: f.ERROR_MESSAGE };
          errorMap[code].count++;
        });
        const patterns = Object.values(errorMap).sort((a, b) => b.count - a.count);

        model.setProperty("/job", result);
        model.setProperty("/successRate", successRate);
        model.setProperty("/totalFailures", result.failedCount || 0);
        model.setProperty("/errorPatterns", patterns);
      } catch (err) {
        MessageBox.error(`Failed to load job data: ${err.message}`);
      }
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("jobMonitor");
    },

    onSearchFailures: function (oEvent) {
      const query = oEvent.getParameter("newValue");
      const filters = query
        ? [new Filter("CONTRACT_ACCOUNT", FilterOperator.Contains, query)]
        : [];
      this.byId("failuresTable").getBinding("rows").filter(filters);
    },

    onReprocessFailed: async function () {
      const batchId = this.getView().getModel("failure").getProperty("/batchId");
      const failedCount = this.getView().getModel("failure").getProperty("/totalFailures");

      MessageBox.confirm(
        `Reprocess ${failedCount} failed records from batch ${batchId}?`,
        {
          onClose: async (action) => {
            if (action === MessageBox.Action.OK) {
              try {
                const result = await BulkJobService.reprocessJob(batchId, { onlyFailed: true });
                MessageToast.show(`Reprocessing job started: ${result.newBatchId}`);
                this.getOwnerComponent().getRouter().navTo("jobMonitor");
              } catch (err) {
                MessageBox.error(`Reprocess failed: ${err.message}`);
              }
            }
          }
        }
      );
    },

    onExport: function () {
      MessageToast.show("Export to CSV — feature available in production deployment");
    },

    onAskCopilot: function () {
      const batchId = this.getView().getModel("failure").getProperty("/batchId");
      // Navigate to copilot with pre-populated query
      sessionStorage.setItem("copilotContext", JSON.stringify({
        action: "analyzeFailures",
        batchId
      }));
      this.getOwnerComponent().getRouter().navTo("copilot");
    }
  });
});
