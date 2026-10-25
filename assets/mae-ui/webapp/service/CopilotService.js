/**
 * CopilotService — Frontend service for OData Copilot calls
 */
sap.ui.define([], function () {
  "use strict";

  const BASE = "/odata/v4/CopilotService";

  async function _action(actionName, body) {
    const res = await fetch(`${BASE}/${actionName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Copilot ${actionName} failed: ${res.statusText}`);
    const data = await res.json();
    return data.value;
  }

  return {
    createSession: () => _action("createSession", {}),
    sendMessage:   (sessionId, message) => _action("sendMessage", { sessionId, message }),
    clearSession:  (sessionId) => _action("clearSession", { sessionId })
  };
});
