/**
 * CopilotService — DUCI Operations Copilot powered by SAP Generative AI Hub
 *
 * Capabilities:
 * - Create Jobs (with human approval gate)
 * - Explain Failures
 * - Recommend Remediation
 * - Prepare Reprocessing Jobs
 * - Generate Executive Summaries
 *
 * Critical: Copilot NEVER executes business actions without explicit user approval.
 */

'use strict';

const cds       = require('@sap/cds');
const { v4: uuidv4 } = require('uuid');
const { AICoreClient } = require('./lib/AICoreClient');

// ── System Prompt for Operations Copilot ─────────────────────────────────────
const SYSTEM_PROMPT = `You are the DUCI Operations Copilot for Demo Utilities Company Inc.
You assist operations teams with bulk customer data management.

Your capabilities:
1. ANALYZE bulk job status and explain what happened in plain English
2. EXPLAIN failure patterns with root cause analysis
3. RECOMMEND remediation steps for failed records
4. PREPARE job configuration JSON for review and approval
5. GENERATE executive summaries of bulk job campaigns

CRITICAL RULES:
- You NEVER execute any business action directly
- When a user requests a job creation, you prepare the job parameters and ASK for approval
- Always present proposed actions as JSON that the user must explicitly confirm
- Include risk assessment and estimated impact for any proposed actions
- If you cannot determine a safe action, recommend manual review

Context about DUCI:
- Utility company with 100,000 customers and 125,000 contract accounts
- Operates in PA, NJ, DE service territory
- Primary demo city: Allentown, PA
- Supported job types: MAILING_ADDRESS_UPDATE, CONTRACT_ACCOUNT_UPDATE, CUSTOMER_PREFERENCE_UPDATE, NOTIFICATION_REQUEST`;

module.exports = class CopilotServiceHandler extends cds.ApplicationService {

  async init() {
    const db = await cds.connect.to('db');

    this.on('createSession', async (req) => {
      const sessionId = uuidv4();
      await db.run(
        INSERT.into('mae.db.CopilotSessions').entries({
          SESSION_ID:  sessionId,
          USER_ID:     req.user?.id || 'anonymous',
          CREATED_ON:  new Date().toISOString(),
          LAST_ACTIVE: new Date().toISOString(),
          STATUS:      'ACTIVE',
          CONTEXT:     JSON.stringify({ messages: [] }),
          BATCH_IDS:   '[]'
        })
      );
      return { sessionId };
    });

    this.on('sendMessage', async (req) => {
      const { sessionId, message } = req.data;
      const messageId = uuidv4();

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return req.error(400, 'Message is required');
      }
      if (message.length > 5000) {
        return req.error(400, 'Message exceeds maximum length of 5000 characters');
      }

      // Load session
      const session = await db.run(
        SELECT.one.from('mae.db.CopilotSessions').where({ SESSION_ID: sessionId })
      );
      if (!session) return req.error(404, 'Session not found');

      // Session ownership check
      const requestingUser = req.user?.id || 'anonymous';
      if (session.USER_ID !== requestingUser && session.USER_ID !== 'anonymous') {
        return req.error(403, 'Access denied');
      }

      // Store user message
      await db.run(
        INSERT.into('mae.db.CopilotMessages').entries({
          MESSAGE_ID: messageId,
          SESSION_ID: sessionId,
          ROLE:       'user',
          CONTENT:    message,
          CREATED_ON: new Date().toISOString()
        })
      );

      // Build conversation history
      const history = await db.run(
        SELECT.from('mae.db.CopilotMessages')
          .where({ SESSION_ID: sessionId })
          .orderBy('CREATED_ON asc')
          .limit(20)
      );

      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.map(m => ({ role: m.ROLE, content: m.CONTENT }))
      ];

      // Call SAP Generative AI Hub
      let response, actions = null;
      try {
        const aiResponse = await this._callGenAIHub(messages);
        response = aiResponse.content;
        actions  = aiResponse.actions || null;
      } catch (err) {
        cds.log('CopilotService').error(`AI Hub call failed: ${err.message}`);
        // Fallback: structured response without AI
        response = this._getFallbackResponse(message);
      }

      // Store assistant response
      const assistantMsgId = uuidv4();
      await db.run(
        INSERT.into('mae.db.CopilotMessages').entries({
          MESSAGE_ID: assistantMsgId,
          SESSION_ID: sessionId,
          ROLE:       'assistant',
          CONTENT:    response,
          CREATED_ON: new Date().toISOString(),
          METADATA:   JSON.stringify({ actions })
        })
      );

      // Update session last active
      await db.run(
        UPDATE('mae.db.CopilotSessions')
          .set({ LAST_ACTIVE: new Date().toISOString() })
          .where({ SESSION_ID: sessionId })
      );

      return {
        sessionId,
        messageId:  assistantMsgId,
        response,
        actions:    JSON.stringify(actions),
        citations:  null
      };
    });

    this.on('clearSession', async (req) => {
      const { sessionId } = req.data;
      const session = await db.run(
        SELECT.one.from('mae.db.CopilotSessions').where({ SESSION_ID: sessionId })
      );
      if (!session) return req.error(404, 'Session not found');
      const requestingUser = req.user?.id || 'anonymous';
      if (session.USER_ID !== requestingUser && session.USER_ID !== 'anonymous') {
        return req.error(403, 'Access denied');
      }
      await db.run(UPDATE('mae.db.CopilotSessions').set({ STATUS: 'CLOSED' }).where({ SESSION_ID: sessionId }));
      return { success: true };
    });

    await super.init();
  }

  _getAICoreCredentials() {
    const client = new AICoreClient();
    return client.credentials;
  }

  async _callGenAIHub(messages) {
    const client = new AICoreClient();
    if (!client.isAvailable()) {
      throw new Error('AI Core credentials not configured. Set VCAP_SERVICES (CF) or AICORE_SERVICE_KEY (local).');
    }
    const result = await client.complete(messages, { maxTokens: 2000, temperature: 0.2, topP: 0.95 });
    const content = result.content;

    // Extract structured actions if JSON block present
    let actions = null;
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try { actions = JSON.parse(jsonMatch[1]); } catch {}
    }

    return { content, actions };
  }

  _getFallbackResponse(userMessage) {
    const lower = userMessage.toLowerCase();
    if (lower.includes('create') && lower.includes('job')) {
      return `To create a bulk job, I need the following information:
1. **Job Type**: MAILING_ADDRESS_UPDATE, CONTRACT_ACCOUNT_UPDATE, CUSTOMER_PREFERENCE_UPDATE, or NOTIFICATION_REQUEST
2. **Contract Accounts**: List of account numbers, or a filter (city, region, zip code)
3. **Job Parameters**: Specific updates to apply
4. **Simulation Mode**: Run as test without actual changes? (recommended for first run)

Please provide these details and I will prepare the job configuration for your review and approval.`;
    }
    if (lower.includes('fail') || lower.includes('error')) {
      return `To analyze failures, please provide a batch ID. I can then:
- Identify the most common error patterns
- Determine root causes
- Recommend specific remediation steps
- Prepare a reprocessing job for the failed records`;
    }
    return `I am the DUCI Operations Copilot. I can help you:
- Create and monitor bulk data jobs
- Analyze job failures and recommend fixes
- Generate executive reports
- Prepare reprocessing for failed records

Please describe what you need help with.`;
  }
};
