sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageBox",
  "com/duci/mae/cdop/service/CopilotService",
  "com/duci/mae/cdop/service/BulkJobService"
], function (Controller, JSONModel, MessageBox, CopilotService, BulkJobService) {
  "use strict";

  return Controller.extend("com.duci.mae.cdop.controller.Copilot", {

    onInit: function () {
      const copilotModel = new JSONModel({
        sessionId: null,
        messages: [],
        isTyping: false,
        pendingActions: null
      });
      this.getView().setModel(copilotModel, "copilotModel");
      this._initSession();
    },

    _initSession: async function () {
      try {
        const result = await CopilotService.createSession();
        this.getView().getModel("copilotModel").setProperty("/sessionId", result.sessionId);
      } catch (err) {
        console.error("Failed to create copilot session:", err);
      }
    },

    onSendMessage: async function () {
      const input    = this.byId("messageInput");
      const message  = input.getValue().trim();
      if (!message) return;

      input.setValue("");
      this._addMessage("user", message);
      await this._sendToCopilot(message);
    },

    onSuggestedAction: async function (oEvent) {
      const action = oEvent.getSource().data("action");
      if (action) {
        this._addMessage("user", action);
        await this._sendToCopilot(action);
      }
    },

    _sendToCopilot: async function (message) {
      const model     = this.getView().getModel("copilotModel");
      const sessionId = model.getProperty("/sessionId");

      if (!sessionId) {
        await this._initSession();
      }

      model.setProperty("/isTyping", true);
      this._scrollToBottom();

      try {
        const result = await CopilotService.sendMessage(sessionId || model.getProperty("/sessionId"), message);
        this._addMessage("assistant", result.response, result.actions);
        if (result.actions) {
          model.setProperty("/pendingActions", result.actions);
        }
      } catch (err) {
        this._addMessage("assistant", `I encountered an error: ${err.message}. Please try again.`);
      } finally {
        model.setProperty("/isTyping", false);
        this._scrollToBottom();
      }
    },

    _addMessage: function (role, content, actions) {
      const model    = this.getView().getModel("copilotModel");
      const messages = model.getProperty("/messages");
      messages.push({
        role,
        content,
        actions: actions || null,
        timestamp: new Date().toISOString()
      });
      model.setProperty("/messages", messages);
    },

    onApproveAction: async function (oEvent) {
      const model   = this.getView().getModel("copilotModel");
      const actions = model.getProperty("/pendingActions");
      if (!actions) return;

      let parsed;
      try {
        parsed = typeof actions === 'string' ? JSON.parse(actions) : actions;
      } catch {
        MessageBox.error("Could not parse action. Please try again.");
        return;
      }

      MessageBox.confirm(
        "You are about to execute the following action. This will make real changes to customer data. Are you sure?",
        {
          actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
          onClose: async (action) => {
            if (action === MessageBox.Action.OK) {
              try {
                if (parsed.type === "CREATE_JOB") {
                  const result = await BulkJobService.createJob(parsed.jobConfig);
                  this._addMessage("assistant", `Job created successfully! Batch ID: ${result.batchId}. You can monitor it in the Job Monitor.`);
                }
                model.setProperty("/pendingActions", null);
              } catch (err) {
                MessageBox.error(`Action failed: ${err.message}`);
              }
            }
          }
        }
      );
    },

    onRejectAction: function () {
      this.getView().getModel("copilotModel").setProperty("/pendingActions", null);
      this._addMessage("assistant", "Action rejected. No changes were made. How else can I help you?");
    },

    onClearSession: function () {
      MessageBox.confirm("Clear this conversation?", {
        onClose: (action) => {
          if (action === MessageBox.Action.OK) {
            this.getView().getModel("copilotModel").setProperty("/messages", []);
            this.getView().getModel("copilotModel").setProperty("/pendingActions", null);
            this._initSession();
          }
        }
      });
    },

    _scrollToBottom: function () {
      setTimeout(() => {
        const scroll = this.byId("chatScroll");
        if (scroll) scroll.scrollTo(0, 99999);
      }, 100);
    }
  });
});
