sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "com/duci/mae/cdop/service/BulkJobService"
], function (Controller, JSONModel, MessageToast, MessageBox, BulkJobService) {
  "use strict";

  const JOB_TYPE_DESCRIPTIONS = {
    MAILING_ADDRESS_UPDATE:     "Updates mailing addresses for selected contract accounts. Uses address history or campaign data as the source of new addresses.",
    CONTRACT_ACCOUNT_UPDATE:    "Updates contract account attributes such as billing class, account type, or status for selected accounts.",
    CUSTOMER_PREFERENCE_UPDATE: "Updates customer communication preferences (channel opt-in/out, language, notification timing) for selected accounts.",
    NOTIFICATION_REQUEST:       "Dispatches bulk notifications to customers via email, SMS, or physical mail."
  };

  return Controller.extend("com.duci.mae.cdop.controller.CreateJob", {

    onInit: function () {
      const model = new JSONModel({
        jobType:          "MAILING_ADDRESS_UPDATE",
        jobTypeDescription: JOB_TYPE_DESCRIPTIONS.MAILING_ADDRESS_UPDATE,
        description:      "",
        simulationMode:   true,
        selectionMethod:  "FILTER",
        filter: { city: "Allentown", daysBack: 90 },
        manualAccountsText: "",
        addressSource:    "HISTORY",
        newAddress:       { streetAddress: "", city: "", stateCode: "", zipCode: "" },
        updates:          { billingClass: "", status: "" },
        notificationType: "ADDRESS_CONFIRMATION",
        channel:          "EMAIL",
        subject:          "",
        content:          "",
        selectionSummary: "Filter: Allentown, 90 days"
      });
      this.getView().setModel(model, "createJob");
    },

    onNavBack: function () {
      window.history.go(-1);
    },

    onJobTypeChange: function (oEvent) {
      const jobType = oEvent.getSource().getSelectedKey();
      const m = this.getView().getModel("createJob");
      m.setProperty("/jobTypeDescription", JOB_TYPE_DESCRIPTIONS[jobType] || "");
      // FILTER selection is only supported for MAILING_ADDRESS_UPDATE
      if (jobType !== "MAILING_ADDRESS_UPDATE" && m.getProperty("/selectionMethod") === "FILTER") {
        m.setProperty("/selectionMethod", "MANUAL");
        this._updateSelectionSummary();
      }
    },

    onSelectionMethodChange: function () {
      this._updateSelectionSummary();
    },

    onAddrSourceChange: function () {},

    onFileUpload: function (oEvent) {
      MessageToast.show("File uploaded — contract accounts will be parsed from CSV");
    },

    onReset: function () {
      this.onInit();
      MessageToast.show("Form reset");
    },

    onValidate: async function () {
      const payload = this._buildJobPayload();
      try {
        const result = await BulkJobService.validateJob(payload);
        if (result?.valid) {
          MessageToast.show("Validation passed — job is ready to submit");
        } else {
          MessageBox.warning(`Validation issues:\n${(result.errors || []).join('\n')}`);
        }
      } catch (err) {
        MessageBox.error(`Validation call failed: ${err.message}`);
      }
    },

    onCreateJob: async function () {
      const payload = this._buildJobPayload();

      MessageBox.confirm(
        `Create ${payload.jobType} job?\nSimulation: ${payload.simulationMode ? 'YES' : 'NO'}\n\nAre you sure?`,
        {
          onClose: async (action) => {
            if (action === MessageBox.Action.OK) {
              try {
                const result = await BulkJobService.createJob(payload);
                MessageToast.show(`Job created: ${result.batchId}`);
                this.getOwnerComponent().getRouter().navTo("jobMonitor");
              } catch (err) {
                MessageBox.error(`Failed to create job: ${err.message}`);
              }
            }
          }
        }
      );
    },

    _buildJobPayload: function () {
      const m = this.getView().getModel("createJob");
      const d = m.getData();
      const parameters = {};

      // Selection
      if (d.selectionMethod === "FILTER" && d.jobType === "MAILING_ADDRESS_UPDATE") {
        parameters.filter = { city: d.filter.city, daysBack: d.filter.daysBack };
        parameters.useExistingAddressHistory = d.addressSource === "HISTORY";
      } else if (d.selectionMethod === "MANUAL") {
        parameters.contractAccounts = d.manualAccountsText
          .split(/[\n,]+/)
          .map(s => s.trim())
          .filter(Boolean);
      } else if (d.selectionMethod === "FILTER" && d.jobType !== "MAILING_ADDRESS_UPDATE") {
        // FILTER unsupported for other job types — treat as empty manual
        parameters.contractAccounts = [];
      }

      // Job-type specific params
      if (d.jobType === "MAILING_ADDRESS_UPDATE" && d.addressSource === "MANUAL") {
        parameters.newAddress = d.newAddress;
      }
      if (d.jobType === "CONTRACT_ACCOUNT_UPDATE") {
        parameters.updates = {};
        if (d.updates.billingClass) parameters.updates.billingClass = d.updates.billingClass;
        if (d.updates.status)       parameters.updates.status       = d.updates.status;
      }
      if (d.jobType === "NOTIFICATION_REQUEST") {
        parameters.notificationType = d.notificationType;
        parameters.channel          = d.channel;
        parameters.subject          = d.subject;
        parameters.content          = d.content;
      }
      if (d.jobType === "CUSTOMER_PREFERENCE_UPDATE") {
        parameters.channel       = d.channel;
        parameters.preferenceType = "NOTIFICATIONS";
        parameters.optedIn       = true;
      }

      return {
        jobType:        d.jobType,
        parameters,
        simulationMode: d.simulationMode,
        description:    d.description
      };
    },

    _updateSelectionSummary: function () {
      const m = this.getView().getModel("createJob");
      const d = m.getData();
      let summary = "";
      if (d.selectionMethod === "FILTER") {
        summary = `Filter: ${d.filter.city}, ${d.filter.daysBack} days`;
      } else if (d.selectionMethod === "MANUAL") {
        const count = (d.manualAccountsText || "").split(/[\n,]+/).filter(Boolean).length;
        summary = `Manual: ${count} accounts`;
      } else {
        summary = "CSV Upload";
      }
      m.setProperty("/selectionSummary", summary);
    }
  });
});
