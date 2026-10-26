/**
 * AICoreClient — Reusable SAP AI Core / Generative AI Hub client
 * Used by CopilotService and PromptLibrary execution
 *
 * Credential resolution order:
 *   1. VCAP_SERVICES (Cloud Foundry bound service)
 *   2. AICORE_SERVICE_KEY (local development JSON env var)
 */
'use strict';

const axios = require('axios');

class AICoreClient {
  constructor() {
    this.credentials    = this._loadCredentials();
    this.model          = process.env.AI_MODEL          || 'gpt-4o';
    this.deploymentId   = process.env.AI_DEPLOYMENT_ID  || this.model;
    this.resourceGroup  = process.env.AI_RESOURCE_GROUP || 'default';
    this._tokenCache    = null;
    this._tokenExpiry   = 0;
  }

  // ── Credential Loading ──────────────────────────────────────────────────────

  _loadCredentials() {
    // CF: read from VCAP_SERVICES (bound aicore service instance)
    if (process.env.VCAP_SERVICES) {
      try {
        const vcap   = JSON.parse(process.env.VCAP_SERVICES);
        const aicore = vcap['aicore'] || vcap['AICORE_SERVICE'] || [];
        if (aicore.length > 0) {
          return aicore[0].credentials;
        }
      } catch (err) {
        console.warn('[AICoreClient] Failed to parse VCAP_SERVICES:', err.message);
      }
    }
    // Local dev: read from AICORE_SERVICE_KEY env var
    if (process.env.AICORE_SERVICE_KEY) {
      try {
        return JSON.parse(process.env.AICORE_SERVICE_KEY);
      } catch (err) {
        console.warn('[AICoreClient] Failed to parse AICORE_SERVICE_KEY:', err.message);
      }
    }
    return null;
  }

  /** Returns true when credentials are available */
  isAvailable() {
    return !!this.credentials;
  }

  // ── OAuth Token (cached) ────────────────────────────────────────────────────

  /**
   * Fetches a new OAuth2 client_credentials token or returns the cached one
   * if it is still valid (with a 60-second safety margin).
   * @returns {Promise<string>} Bearer access token
   */
  async getToken() {
    const now = Date.now();
    if (this._tokenCache && now < this._tokenExpiry - 60_000) {
      return this._tokenCache;
    }

    const { clientid, clientsecret, tokenurl } = this.credentials;

    const response = await axios.post(
      `${tokenurl}/oauth/token`,
      new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     clientid,
        client_secret: clientsecret
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    this._tokenCache  = response.data.access_token;
    // expires_in is in seconds; convert to ms and anchor to now
    const expiresIn   = (response.data.expires_in || 3600) * 1000;
    this._tokenExpiry = now + expiresIn;

    return this._tokenCache;
  }

  // ── Chat Completions ────────────────────────────────────────────────────────

  /**
   * Call the AI Core completions endpoint.
   *
   * @param {Array<{role:string, content:string}>} messages  Chat messages
   * @param {object}  opts
   * @param {number}  [opts.maxTokens=2000]
   * @param {number}  [opts.temperature=0.2]
   * @param {number}  [opts.topP=0.95]
   * @param {string}  [opts.deploymentId]  Override default deployment
   * @returns {Promise<{content:string, model:string, tokensUsed:number, latencyMs:number}>}
   */
  async complete(messages, opts = {}) {
    if (!this.isAvailable()) {
      throw new Error('AICoreClient: credentials not configured.');
    }

    const {
      maxTokens    = 2000,
      temperature  = 0.2,
      topP         = 0.95,
      deploymentId = this.deploymentId
    } = opts;

    const token     = await this.getToken();
    const startTime = Date.now();

    const response = await axios.post(
      `${this.credentials.url}/v2/inference/deployments/${deploymentId}/chat/completions`,
      {
        messages,
        max_tokens:  maxTokens,
        temperature,
        top_p:       topP
      },
      {
        headers: {
          Authorization:      `Bearer ${token}`,
          'Content-Type':     'application/json',
          'AI-Resource-Group': this.resourceGroup
        }
      }
    );

    const latencyMs   = Date.now() - startTime;
    const choice      = response.data.choices?.[0];
    const content     = choice?.message?.content || '';
    const usage       = response.data.usage || {};
    const model       = response.data.model || deploymentId;
    const tokensUsed  = usage.total_tokens || 0;

    return { content, model, tokensUsed, latencyMs };
  }

  // ── Response Scoring ────────────────────────────────────────────────────────

  /**
   * Score an AI response across four dimensions using AI Core itself.
   * Falls back to rule-based heuristics when AI Core is unavailable.
   *
   * @param {string} prompt    The original user/system prompt text
   * @param {string} response  The AI-generated response to score
   * @param {string} [context] Optional surrounding business context
   * @returns {Promise<{quality:number, alignment:number, business:number, confidence:number, hallucinationRisk:number}>}
   *   All scores are 0-100 (higher = better, except hallucinationRisk where lower = better)
   */
  async scoreResponse(prompt, response, context = '') {
    // ── AI-based scoring ──────────────────────────────────────────────────────
    if (this.isAvailable()) {
      try {
        const scoringPrompt = `You are an AI quality evaluator. Score the following AI response on four dimensions.
Return ONLY a JSON object — no prose, no markdown fences.

Original prompt:
"""
${prompt}
"""

${context ? `Business context:\n"""\n${context}\n"""\n` : ''}
AI response to evaluate:
"""
${response}
"""

Return JSON with these integer fields (0-100):
{
  "quality": <overall response quality — clarity, completeness, helpfulness>,
  "alignment": <how well the response addresses the prompt>,
  "business": <relevance and appropriateness for a business / enterprise context>,
  "confidence": <how confident and well-supported the response appears>,
  "hallucinationRisk": <likelihood of fabricated or unsupported claims — lower is better>
}`;

        const result = await this.complete(
          [{ role: 'user', content: scoringPrompt }],
          { maxTokens: 300, temperature: 0 }
        );

        const parsed = JSON.parse(result.content.trim());
        return {
          quality:           Math.min(100, Math.max(0, Number(parsed.quality)           || 0)),
          alignment:         Math.min(100, Math.max(0, Number(parsed.alignment)         || 0)),
          business:          Math.min(100, Math.max(0, Number(parsed.business)          || 0)),
          confidence:        Math.min(100, Math.max(0, Number(parsed.confidence)        || 0)),
          hallucinationRisk: Math.min(100, Math.max(0, Number(parsed.hallucinationRisk) || 0))
        };
      } catch (err) {
        console.warn('[AICoreClient] AI scoring failed, falling back to rule-based:', err.message);
      }
    }

    // ── Rule-based fallback scoring ───────────────────────────────────────────
    return this._ruleBasedScore(prompt, response);
  }

  /**
   * Simple heuristic scoring when AI Core is unavailable.
   * @private
   */
  _ruleBasedScore(prompt, response) {
    const responseLen  = response.trim().length;
    const promptWords  = new Set(prompt.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    const responseText = response.toLowerCase();

    // Quality: penalise very short or very long responses
    const quality = responseLen < 20  ? 40
                  : responseLen > 8000 ? 70
                  : Math.min(90, 60 + Math.floor(responseLen / 100));

    // Alignment: count prompt keyword hits in response
    let hits = 0;
    for (const word of promptWords) {
      if (responseText.includes(word)) hits++;
    }
    const alignment = promptWords.size > 0
      ? Math.min(95, Math.round((hits / promptWords.size) * 100))
      : 70;

    // Business: presence of structured / professional language
    const businessSignals = [
      'please', 'recommend', 'suggest', 'analysis', 'summary', 'action',
      'step', 'result', 'status', 'error', 'success', 'warning', 'note'
    ];
    const businessHits = businessSignals.filter(s => responseText.includes(s)).length;
    const business = Math.min(95, 55 + businessHits * 5);

    // Confidence: penalise hedging language
    const hedges = ['i think', 'maybe', 'perhaps', 'not sure', 'i believe', 'possibly'];
    const hedgeHits = hedges.filter(h => responseText.includes(h)).length;
    const confidence = Math.max(40, 80 - hedgeHits * 10);

    // Hallucination risk: low by default for structured/short responses
    const hallucinationRisk = responseLen > 4000 ? 35 : 20;

    return { quality, alignment, business, confidence, hallucinationRisk };
  }
}

module.exports = { AICoreClient };
