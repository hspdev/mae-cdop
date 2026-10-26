sap.ui.define([
  "sap/ui/core/mvc/Controller"
], function (Controller) {
  "use strict";

  return Controller.extend("com.duci.mae.cdop.controller.App", {

    onSideNavToggle: function () {
      const toolPage = this.byId("toolPage");
      toolPage.setSideExpanded(!toolPage.getSideExpanded());
    },

    onInit: function () {
      // Highlight dashboard item in side nav on init
      const sideNav = this.byId("sideNav");
      if (sideNav) {
        const items = sideNav.getItems();
        if (items && items.length) {
          sideNav.setSelectedItem(items[0]);
        }
      }
    },

    onNavItemSelect: function (oEvent) {
      const key = oEvent.getParameter("item").getKey();
      const router = this.getOwnerComponent().getRouter();
      const routeMap = {
        dashboard:        "dashboard",
        copilot:          "copilot",
        bulkRead:         "bulkRead",
        createJob:        "createJob",
        jobMonitor:       "jobMonitor",
        failureAnalysis:  "failureAnalysis",
        executiveSummary: "executiveSummary",
        platformInsights: "platformInsights"
      };
      if (routeMap[key]) {
        router.navTo(routeMap[key]);
      }
    }
  });
});
