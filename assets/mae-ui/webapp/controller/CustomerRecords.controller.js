sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast"
], function (Controller, JSONModel, MessageToast) {
  "use strict";

  return Controller.extend("com.duci.mae.cdop.controller.CustomerRecords", {

    onInit: function () {
      this.getView().setModel(new JSONModel({ records: [], total: 0 }), "customerModel");
      this._offset = 0;
      this._limit  = 50;
      this._lastParams = {};
    },

    onSearch: function () {
      this._offset = 0;
      const params = this._readFilters();
      this._lastParams = params;
      this._fetchCustomers(params);
    },

    onReset: function () {
      this.byId("custIdInput").setValue("");
      this.byId("stateSelect").setSelectedKey("");
      this.byId("segmentSelect").setSelectedKey("");
      this.byId("statusSelect").setSelectedKey("");
      this._offset = 0;
      this._lastParams = {};
      this.getView().getModel("customerModel").setData({ records: [], total: 0 });
      this.byId("custRecordCount").setText("");
      this.byId("custPaginationBar").setVisible(false);
    },

    onPrevPage: function () {
      if (this._offset <= 0) return;
      this._offset = Math.max(0, this._offset - this._limit);
      this._fetchCustomers(this._lastParams);
    },

    onNextPage: function () {
      this._offset += this._limit;
      this._fetchCustomers(this._lastParams);
    },

    _readFilters: function () {
      const params = {};
      const id      = this.byId("custIdInput").getValue().trim();
      const state   = this.byId("stateSelect").getSelectedKey();
      const segment = this.byId("segmentSelect").getSelectedKey();
      const status  = this.byId("statusSelect").getSelectedKey();
      if (id)      params.search    = id;
      if (state)   params.stateCode = state;
      if (segment) params.segment   = segment;
      if (status)  params.status    = status;
      return params;
    },

    _fetchCustomers: function (params) {
      const query = Object.assign({}, params, { limit: this._limit, offset: this._offset });
      const qs = Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v))
        .join("&");

      fetch("/api/bulk-read/customers?" + qs)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.error) { MessageToast.show("Error: " + data.error); return; }

          this.getView().getModel("customerModel").setData({
            records: data.records || [],
            total:   data.total   || 0
          });

          const total = data.total || 0;
          const count = (data.records || []).length;
          this.byId("custRecordCount").setText(count + " of " + total + " records");

          const hasMore = this._offset + count < total;
          const hasPrev = this._offset > 0;
          this.byId("custPaginationBar").setVisible(total > this._limit);
          this.byId("custPrevBtn").setEnabled(hasPrev);
          this.byId("custNextBtn").setEnabled(hasMore);
          const page  = Math.floor(this._offset / this._limit) + 1;
          const pages = Math.ceil(total / this._limit);
          this.byId("custPageInfo").setText("Page " + page + " of " + pages);
        }.bind(this))
        .catch(function (err) { MessageToast.show("Fetch error: " + err.message); });
    },

    onExportCSV: function () {
      const records = this.getView().getModel("customerModel").getProperty("/records");
      if (!records || records.length === 0) { MessageToast.show("No records to export."); return; }
      const headers = Object.keys(records[0]);
      const rows    = records.map(function (r) {
        return headers.map(function (h) {
          return '"' + String(r[h] || "").replace(/"/g, '""') + '"';
        }).join(",");
      });
      const csv  = [headers.join(",")].concat(rows).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = "customer-records-" + Date.now() + ".csv";
      a.click();
      URL.revokeObjectURL(url);
    }
  });
});
