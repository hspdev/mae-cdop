sap.ui.define([
  "sap/ui/core/mvc/Controller"
], function (Controller) {
  "use strict";

  return Controller.extend("com.duci.mae.cdop.controller.App", {

    onSideNavToggle: function () {
      const toolPage = this.byId("toolPage");
      toolPage.setSideExpanded(!toolPage.getSideExpanded());
    },

    onNavItemSelect: function (oEvent) {
      const key = oEvent.getParameter("item").getKey();
      const router = this.getOwnerComponent().getRouter();
      const routeMap = {
        dashboard:        "dashboard",
        copilot:          "copilot",
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
