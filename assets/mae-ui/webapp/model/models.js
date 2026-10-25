sap.ui.define([
  "sap/ui/model/json/JSONModel",
  "sap/ui/Device"
], function (JSONModel, Device) {
  "use strict";
  return {
    createDeviceModel: function () {
      const model = new JSONModel(Device);
      model.setDefaultBindingMode("OneWay");
      return model;
    }
  };
});
