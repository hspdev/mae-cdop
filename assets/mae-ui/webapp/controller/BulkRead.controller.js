sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "sap/m/GenericTile",
  "sap/m/TileContent",
  "sap/m/NumericContent"
], function (Controller, JSONModel, MessageToast, GenericTile, TileContent, NumericContent) {
  "use strict";

  // Maps prompt key → { endpoint, table, filters[], descPrompt }
  const PROMPT_CONFIG = {
    "BR-001": {
      endpoint: "/api/bulk-read/customers",
      table:    "customerTable",
      filters:  ["filterStatus", "filterSegment", "filterLimit"],
      params:   { status: "filterStatus", segment: "filterSegment" },
      desc:     "Show all active customers with segment, region, and contact details. Paginate with 50 records per page."
    },
    "BR-002": {
      endpoint: "/api/bulk-read/customers",
      table:    "customerTable",
      filters:  ["filterInput1", "filterInput2", "filterLimit"],
      inputLabels: ["State Code (e.g. PA)", "City (optional)"],
      inputParams: ["stateCode", "city"],
      desc:     "Retrieve customers filtered by state code and/or city, with city-level count breakdown."
    },
    "BR-003": {
      endpoint: "/api/bulk-read/contracts",
      table:    "contractTable",
      filters:  ["filterStatus", "filterSegment", "filterLimit"],
      params:   { status: "filterStatus", accountType: "filterSegment" },
      desc:     "List all active contract accounts with account type, billing class, and address. Summary by account type."
    },
    "BR-004": {
      endpoint: "/api/bulk-read/contracts",
      table:    "contractTable",
      filters:  ["filterInput1", "filterLimit"],
      inputLabels: ["Customer ID (e.g. CUST000001)"],
      inputParams: ["customerId"],
      desc:     "Look up all contract accounts for a specific customer ID, including address history flag."
    },
    "BR-005": {
      endpoint: "/api/bulk-read/preferences",
      table:    "preferencesTable",
      filters:  ["filterInput1", "filterLimit"],
      inputLabels: ["Channel (EMAIL / SMS / MAIL, or blank for all)"],
      inputParams: ["channel"],
      desc:     "Retrieve customer communication preferences with opt-in rates per channel."
    },
    "BR-006": {
      endpoint: "/api/bulk-read/address-history",
      table:    "historyTable",
      filters:  ["filterInput1", "filterInput2", "filterLimit"],
      inputLabels: ["City (optional)", "State Code (optional)"],
      inputParams: ["city", "stateCode"],
      desc:     "Show address change history for the last 90 days grouped by change source and city."
    },
    "BR-007": {
      endpoint: "/api/bulk-read/no-optin-customers",
      table:    "customerTable",
      filters:  ["filterLimit"],
      desc:     "List all customers with NOTIFICATION_OPT_IN = false, grouped by segment and region."
    }
  };

  return Controller.extend("com.duci.mae.cdop.controller.BulkRead", {

    onInit: function () {
      const model = new JSONModel({ records: [], total: 0, summary: {} });
      this.getView().setModel(model, "bulkRead");
      this._currentPromptKey = null;
      this._currentOffset    = 0;
      this._currentLimit     = 100;
      this._currentEndpoint  = null;
      this._currentParams    = {};
    },

    onPromptSelected: function (oEvent) {
      const key = oEvent.getParameter("selectedItem").getKey();
      this._currentPromptKey = key || null;
      this._currentOffset    = 0;

      this.byId("executeBtn").setEnabled(!!key);
      this.byId("responsePanel").setVisible(false);
      this.byId("resultsPanel").setVisible(false);

      if (!key) {
        this._hideAllFilters();
        this.byId("promptDesc").setVisible(false);
        return;
      }

      const cfg = PROMPT_CONFIG[key];
      this._showFilters(cfg);

      this.byId("promptDesc").setText(cfg.desc);
      this.byId("promptDesc").setVisible(true);
    },

    _hideAllFilters: function () {
      ["filterBox","filterInput1","filterInput2","filterStatus","filterSegment","filterLimit"].forEach(id => {
        const ctrl = this.byId(id);
        if (ctrl) ctrl.setVisible(false);
      });
    },

    _showFilters: function (cfg) {
      this._hideAllFilters();
      if (!cfg.filters || cfg.filters.length === 0) return;

      this.byId("filterBox").setVisible(true);

      // Text inputs for dynamic params
      const inputLabels = cfg.inputLabels || [];
      const inputIds    = ["filterInput1", "filterInput2"];
      inputIds.forEach((id, idx) => {
        const ctrl = this.byId(id);
        if (ctrl && cfg.filters.includes(id)) {
          ctrl.setPlaceholder(inputLabels[idx] || "");
          ctrl.setValue("");
          ctrl.setVisible(true);
        }
      });

      // Named selects
      if (cfg.filters.includes("filterStatus")) this.byId("filterStatus").setVisible(true);
      if (cfg.filters.includes("filterSegment")) {
        // Reuse segment select for accountType on contract prompts
        const seg = this.byId("filterSegment");
        seg.setVisible(true);
      }

      // Limit stepper — always show when in filters
      if (cfg.filters.includes("filterLimit")) {
        const lim = this.byId("filterLimit");
        lim.setValue(100);
        lim.setVisible(true);
      }
    },

    onExecute: function () {
      const key = this._currentPromptKey;
      if (!key) return;

      const cfg = PROMPT_CONFIG[key];
      const limit = this.byId("filterLimit") && this.byId("filterLimit").getVisible()
        ? this.byId("filterLimit").getValue()
        : 100;

      this._currentLimit  = Number(limit);
      this._currentOffset = 0;

      // Build query params from filter controls
      const params = { limit: this._currentLimit, offset: 0 };

      if (cfg.params) {
        const statusCtrl  = this.byId("filterStatus");
        const segmentCtrl = this.byId("filterSegment");
        if (cfg.params.status  && statusCtrl  && statusCtrl.getVisible()  && statusCtrl.getSelectedKey())  params.status      = statusCtrl.getSelectedKey();
        if (cfg.params.segment && segmentCtrl && segmentCtrl.getVisible() && segmentCtrl.getSelectedKey()) params.segment     = segmentCtrl.getSelectedKey();
        if (cfg.params.accountType && segmentCtrl && segmentCtrl.getVisible() && segmentCtrl.getSelectedKey()) params.accountType = segmentCtrl.getSelectedKey();
      }

      if (cfg.inputParams) {
        const inputIds = ["filterInput1", "filterInput2"];
        cfg.inputParams.forEach((paramName, idx) => {
          const val = this.byId(inputIds[idx]) && this.byId(inputIds[idx]).getValue();
          if (val && val.trim()) params[paramName] = val.trim();
        });
      }

      this._currentParams   = params;
      this._currentEndpoint = cfg.endpoint;

      this._fetchData(cfg.endpoint, params, cfg.table);
      this._fetchAIResponse(key);
    },

    _fetchData: function (endpoint, params, tableId) {
      const query = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");

      const url = `${endpoint}?${query}`;

      this.byId("resultsPanel").setVisible(true);
      this._hideAllTables();
      this.byId(tableId).setVisible(true);

      fetch(url)
        .then(r => r.json())
        .then(data => {
          if (data.error) {
            MessageToast.show("Error: " + data.error);
            return;
          }
          this.getView().getModel("bulkRead").setData({
            records: data.records || [],
            total:   data.total  || 0,
            summary: data.summary || {}
          });

          const total = data.total || 0;
          const count = (data.records || []).length;
          this.byId("recordCount").setText(`${count} of ${total} records`);
          this.byId("resultsTitle").setText(`Results  (${total} total)`);

          // Pagination
          const hasMore = this._currentOffset + count < total;
          const hasPrev = this._currentOffset > 0;
          this.byId("paginationBar").setVisible(total > this._currentLimit);
          this.byId("prevBtn").setEnabled(hasPrev);
          this.byId("nextBtn").setEnabled(hasMore);
          const page = Math.floor(this._currentOffset / this._currentLimit) + 1;
          const pages = Math.ceil(total / this._currentLimit);
          this.byId("pageInfo").setText(`Page ${page} of ${pages}`);

          // Summary tiles
          this._renderSummaryTiles(data.summary);
        })
        .catch(err => MessageToast.show("Fetch error: " + err.message));
    },

    _hideAllTables: function () {
      ["customerTable","contractTable","preferencesTable","historyTable"].forEach(id => {
        this.byId(id).setVisible(false);
      });
    },

    _renderSummaryTiles: function (summary) {
      const box = this.byId("summaryTiles");
      box.destroyItems();
      if (!summary) { box.setVisible(false); return; }

      const addTile = (label, value) => {
        box.addItem(new GenericTile({
          header: label,
          tileContent: [new TileContent({
            content: new NumericContent({ value: String(value), scale: "" })
          })]
        }));
      };

      // Show first array summary with up to 5 entries
      for (const [key, val] of Object.entries(summary)) {
        if (Array.isArray(val)) {
          val.slice(0, 5).forEach(item => addTile(`${key}: ${item.value}`, item.count));
          break;
        } else if (typeof val === "string") {
          addTile(key, val);
        }
      }

      box.setVisible(box.getItems().length > 0);
    },

    _fetchAIResponse: function (key) {
      const promptMap = {
        "BR-001": "Show me all active customers. Display their customer ID, full name, email, phone, segment, city, state, and region. Filter to STATUS = ACTIVE only. Paginate the results with 50 records per page and provide a summary count by segment and by region.",
        "BR-002": "Retrieve all customers filtered by a specific state or region. Show customer ID, full name, email, segment, city, state, and ZIP code. Allow filtering by STATE_CODE or REGION and show a count breakdown by city within the selected state or region.",
        "BR-003": "List all active contract accounts with their contract account number, linked customer ID, account type, billing class, premise ID, street address, city, state, and ZIP code. Filter to STATUS = ACTIVE. Show a summary count by account type and by billing class.",
        "BR-004": "Look up all contract accounts associated with a specific customer ID. Display each contract account number, account type, billing class, current address, move-in date, move-out date, and status. Show whether any accounts have had address changes in the last 90 days.",
        "BR-005": "Retrieve all customer communication preferences. Show customer ID, channel (EMAIL, SMS, MAIL), preference type, opted-in status, preferred language, and preferred contact time. Provide a summary of opt-in rates per channel and highlight customers who have opted out of all channels.",
        "BR-006": "Show address change history for the last 90 days. Include contract account number, customer ID, old address, new address, change date, change source, and whether the change was verified. Group results by change source and show which cities have seen the highest volume of address changes.",
        "BR-007": "List all customers where NOTIFICATION_OPT_IN = false or who have opted out of all communication channels in the preferences table. Show customer ID, full name, email, segment, region, and date of last preference update. Group by segment and region to identify concentrations of unreachable customers."
      };

      const promptText = promptMap[key];
      if (!promptText) return;

      this.byId("responsePanel").setVisible(true);
      this.byId("responseBusy").setVisible(true);
      this.byId("responseText").setVisible(false);

      fetch("/api/prompts/execute", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ promptText, category: "Bulk Read", testType: "HAPPY" })
      })
        .then(r => r.json())
        .then(data => {
          this.byId("responseBusy").setVisible(false);
          const raw = data.response || data.responseText || "";
          // Convert markdown-style text to simple HTML for FormattedText
          const html = raw
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/\n\n/g, "<br/><br/>")
            .replace(/\n/g, "<br/>")
            .replace(/•/g, "&#8226;");
          this.byId("responseText").setHtmlText(`<span style="font-size:0.875rem;">${html}</span>`);
          this.byId("responseText").setVisible(true);
        })
        .catch(() => {
          this.byId("responseBusy").setVisible(false);
        });
    },

    onPrevPage: function () {
      if (this._currentOffset <= 0) return;
      this._currentOffset = Math.max(0, this._currentOffset - this._currentLimit);
      this._paginate();
    },

    onNextPage: function () {
      this._currentOffset += this._currentLimit;
      this._paginate();
    },

    _paginate: function () {
      const cfg = PROMPT_CONFIG[this._currentPromptKey];
      if (!cfg) return;
      const params = Object.assign({}, this._currentParams, {
        limit:  this._currentLimit,
        offset: this._currentOffset
      });
      this._fetchData(this._currentEndpoint, params, cfg.table);
    },

    onClear: function () {
      this.byId("promptSelect").setSelectedKey("");
      this._hideAllFilters();
      this.byId("filterBox").setVisible(false);
      this.byId("promptDesc").setVisible(false);
      this.byId("executeBtn").setEnabled(false);
      this.byId("responsePanel").setVisible(false);
      this.byId("resultsPanel").setVisible(false);
      this._hideAllTables();
      this._currentPromptKey = null;
      this.getView().getModel("bulkRead").setData({ records: [], total: 0, summary: {} });
    },

    onExportCSV: function () {
      const records = this.getView().getModel("bulkRead").getProperty("/records");
      if (!records || records.length === 0) {
        MessageToast.show("No records to export.");
        return;
      }
      const headers = Object.keys(records[0]);
      const rows    = records.map(r => headers.map(h => `"${String(r[h] || "").replace(/"/g, '""')}"`).join(","));
      const csv     = [headers.join(","), ...rows].join("\n");
      const blob    = new Blob([csv], { type: "text/csv" });
      const url     = URL.createObjectURL(blob);
      const a       = document.createElement("a");
      a.href        = url;
      a.download    = `bulk-read-${this._currentPromptKey || "export"}-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  });
});
