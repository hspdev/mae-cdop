sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "com/duci/mae/cdop/service/BulkJobService"
], function (Controller, Filter, FilterOperator, MessageToast, MessageBox, BulkJobService) {
  "use strict";

  return Controller.extend("com.duci.mae.cdop.controller.JobMonitor", {

    onInit: function () {
      const router = this.getOwnerComponent().getRouter();
      router.getRoute("jobMonitor").attachPatternMatched(this._onRouteMatched, this);
      this._startAutoRefresh();
    },

    _onRouteMatched: function () {
      this._applyFilters();
    },

    _startAutoRefresh: function () {
      this._refreshTimer = setInterval(() => {
        this.getView().getModel().refresh(true);
      }, 10000);
    },

    onExit: function () {
      if (this._refreshTimer) clearInterval(this._refreshTimer);
    },

    onRefresh: function () {
      this.getView().getModel().refresh(true);
      MessageToast.show("Jobs refreshed");
    },

    onNewJob: function () {
      this.getOwnerComponent().getRouter().navTo("createJob");
    },

    onStatusFilterChange: function (oEvent) {
      this._applyFilters();
    },

    _applyFilters: function () {
      const oTable = this.byId("jobsTable");
      if (!oTable) return;
      const oBinding = oTable.getBinding("rows");
      if (!oBinding) {
        oTable.attachEventOnce("modelContextChange", this._applyFilters.bind(this));
        return;
      }
      const statusSel = this.byId("statusFilter").getSelectedKey();
      const filters = [];
      if (statusSel && statusSel !== "ALL") {
        filters.push(new Filter("STATUS", FilterOperator.EQ, statusSel));
      }
      oBinding.filter(filters);
    },

    onSearch: function (oEvent) {
      const query = oEvent.getParameter("newValue");
      const filters = [];
      if (query) {
        filters.push(new Filter({
          filters: [
            new Filter("BATCH_ID", FilterOperator.Contains, query),
            new Filter("JOB_TYPE", FilterOperator.Contains, query)
          ],
          and: false
        }));
      }
      this.byId("jobsTable").getBinding("rows").filter(filters);
    },

    onViewDetails: function (oEvent) {
      const context = oEvent.getSource().getBindingContext();
      const batchId = context.getProperty("BATCH_ID");
      MessageToast.show(`Viewing details for: ${batchId}`);
    },

    onViewFailures: function (oEvent) {
      const context = oEvent.getSource().getBindingContext();
      const batchId = context.getProperty("BATCH_ID");
      this.getOwnerComponent().getRouter().navTo("failureAnalysis", { batchId });
    },

    onCancelJob: async function (oEvent) {
      const context = oEvent.getSource().getBindingContext();
      const batchId = context.getProperty("BATCH_ID");

      MessageBox.confirm(`Cancel job ${batchId}?`, {
        onClose: async (action) => {
          if (action === MessageBox.Action.OK) {
            try {
              await BulkJobService.cancelJob(batchId);
              MessageToast.show("Job cancelled");
              this.getView().getModel().refresh(true);
            } catch (err) {
              MessageBox.error(`Cancel failed: ${err.message}`);
            }
          }
        }
      });
    },

    onReprocess: async function (oEvent) {
      const context = oEvent.getSource().getBindingContext();
      const batchId = context.getProperty("BATCH_ID");
      const failedCount = context.getProperty("FAILED_COUNT");

      MessageBox.confirm(
        `Reprocess ${failedCount} failed records from job ${batchId}?`,
        {
          actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
          onClose: async (action) => {
            if (action === MessageBox.Action.OK) {
              try {
                const result = await BulkJobService.reprocessJob(batchId, { onlyFailed: true });
                MessageToast.show(`Reprocessing started as job: ${result.newBatchId}`);
                this.getView().getModel().refresh(true);
              } catch (err) {
                MessageBox.error(`Reprocess failed: ${err.message}`);
              }
            }
          }
        }
      );
    }
  });
});
