sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/Device",
  "com/duci/mae/cdop/model/models"
], function (UIComponent, Device, models) {
  "use strict";

  return UIComponent.extend("com.duci.mae.cdop.Component", {

    metadata: {
      manifest: "json"
    },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
      this.setModel(models.createDeviceModel(), "device");
      this.getRouter().initialize();
    },

    getContentDensityClass: function () {
      return Device.support.touch ? "sapUiSizeCozy" : "sapUiSizeCompact";
    }
  });
});
