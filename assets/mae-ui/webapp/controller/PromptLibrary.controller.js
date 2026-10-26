sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "sap/ui/core/Item"
], function (Controller, JSONModel, MessageToast, Item) {
  "use strict";

  return Controller.extend("com.duci.mae.cdop.controller.PromptLibrary", {

    onInit: function () {
      this.getView().setModel(
        new JSONModel({ prompts: [], categories: [], total: 0 }),
        "promptModel"
      );
      this.getView().setModel(new JSONModel({}), "promptDetail");
      this._loadPrompts();
    },

    _loadPrompts: function (extraParams) {
      const qs = "limit=200" + (extraParams ? "&" + extraParams : "");
      fetch("/api/prompts?" + qs)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          const prompts    = data.prompts    || [];
          const categories = data.categories || [];
          const total      = data.total      || prompts.length;

          this.getView().getModel("promptModel").setData({
            prompts:    prompts,
            categories: categories,
            total:      total
          });

          this.byId("promptCountText").setText(total + " prompt" + (total !== 1 ? "s" : "") + " in library");

          const catSelect = this.byId("catSelect");
          catSelect.destroyItems();
          catSelect.addItem(new Item({ key: "", text: "All Categories" }));
          categories.forEach(function (cat) {
            catSelect.addItem(new Item({ key: cat, text: cat }));
          });
        }.bind(this))
        .catch(function (err) { MessageToast.show("Load error: " + err.message); });
    },

    onSearch: function () {
      const cat         = this.byId("catSelect").getSelectedKey();
      const search      = this.byId("promptSearch").getValue().trim();
      const recommended = this.byId("recommendedChk").getSelected();
      const parts       = [];
      if (cat)         parts.push("category=" + encodeURIComponent(cat));
      if (search)      parts.push("search="   + encodeURIComponent(search));
      if (recommended) parts.push("recommended=true");
      this._loadPrompts(parts.join("&"));
    },

    onPromptPress: function (oEvent) {
      const ctx  = oEvent.getSource().getBindingContext("promptModel");
      const data = ctx ? ctx.getObject() : {};
      this.getView().getModel("promptDetail").setData(data);
      this.byId("promptDetailDialog").open();
    },

    onExecutePrompt: function () {
      const detail = this.getView().getModel("promptDetail").getData();
      if (!detail.PROMPT_TEXT) return;

      this.byId("promptDetailDialog").close();
      this.byId("execPanel").setVisible(true);
      this.byId("execBusy").setVisible(true);
      this.byId("execResult").setHtmlText("");

      fetch("/api/prompts/execute", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          promptText: detail.PROMPT_TEXT,
          category:   detail.CATEGORY,
          testType:   "HAPPY"
        })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          this.byId("execBusy").setVisible(false);
          const raw  = data.response || data.responseText || "";
          const html = raw
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/\n\n/g, "<br/><br/>")
            .replace(/\n/g,   "<br/>")
            .replace(/•/g,    "&#8226;");
          this.byId("execResult").setHtmlText(
            "<span style=\"font-size:0.875rem;\">" + html + "</span>"
          );
        }.bind(this))
        .catch(function (err) {
          this.byId("execBusy").setVisible(false);
          MessageToast.show("Execute error: " + err.message);
        }.bind(this));
    },

    onCloseDialog: function () {
      this.byId("promptDetailDialog").close();
    }
  });
});
