/**
 * PromptOptimizer — Implements the iterative prompt optimization cycle
 *
 * Cycle:  Generate → Execute → Evaluate → Improve → Retest
 * Target: ≥95 on quality, alignment, business, and confidence scores
 *         (hallucinationRisk ≤ 25)
 *
 * Dependencies:
 *   - AICoreClient  for AI completions and scoring
 *   - db            CAP database handle (cds.connect.to('db'))
 */
'use strict';

const { AICoreClient } = require('./AICoreClient');

const SCORE_THRESHOLD          = 95;  // minimum acceptable score (0-100)
const HALLUCINATION_THRESHOLD  = 25;  // maximum acceptable hallucinationRisk
const DEFAULT_MAX_ITERATIONS   = 5;

class PromptOptimizer {
  /**
   * @param {AICoreClient} aiCoreClient
   * @param {object}       db  CAP database handle
   */
  constructor(aiCoreClient, db) {
    if (!(aiCoreClient instanceof AICoreClient)) {
      throw new TypeError('PromptOptimizer: first argument must be an AICoreClient instance');
    }
    this.ai = aiCoreClient;
    this.db = db;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Optimize a PromptLibrary entry until all scores meet the target
   * or maxIterations is exhausted.
   *
   * @param {string} promptId        ID of the PromptLibrary record
   * @param {number} [maxIterations] Cap on improvement cycles (default 5)
   * @returns {Promise<OptimizationReport>}
   */
  async optimize(promptId, maxIterations = DEFAULT_MAX_ITERATIONS) {
    const report = {
      promptId,
      iterations: [],
      improved:   false,
      finalScores: null,
      thresholdMet: false,
      startedAt:  new Date().toISOString(),
      finishedAt: null
    };

    // 1. Load current prompt from PromptLibrary
    const promptRecord = await this._loadPrompt(promptId);
    if (!promptRecord) {
      throw new Error(`PromptOptimizer: PromptLibrary record not found for id "${promptId}"`);
    }

    let currentPromptText = promptRecord.PROMPT_TEXT || promptRecord.promptText || '';
    let currentVersion    = promptRecord.VERSION      || promptRecord.version    || 1;

    // 2. Load recent executions (last 10) for context
    const executions = await this._loadRecentExecutions(promptId, 10);

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      const iterResult = {
        iteration,
        promptText: currentPromptText,
        scores:     null,
        improved:   false,
        newVersionId: null
      };

      // 3. Execute the prompt to get a test response
      let testResponse;
      try {
        const result = await this.ai.complete(
          [{ role: 'user', content: currentPromptText }],
          { maxTokens: 1500, temperature: 0.2 }
        );
        testResponse = result.content;
      } catch (err) {
        iterResult.error = `AI execution failed: ${err.message}`;
        report.iterations.push(iterResult);
        break;
      }

      // 4. Score the response
      const scores = await this._calculateScores(currentPromptText, testResponse, executions);
      iterResult.scores = scores;

      // 5. Check if threshold is met
      if (this._meetsThreshold(scores)) {
        iterResult.thresholdMet = true;
        report.iterations.push(iterResult);
        report.thresholdMet = true;
        report.finalScores  = scores;
        break;
      }

      // 6. If this is the last iteration, stop without generating another version
      if (iteration === maxIterations) {
        report.iterations.push(iterResult);
        report.finalScores = scores;
        break;
      }

      // 7. Generate an improved prompt version
      let improvedText;
      try {
        improvedText = await this._generateImprovedPrompt(currentPromptText, scores, executions);
      } catch (err) {
        iterResult.error = `Prompt improvement failed: ${err.message}`;
        report.iterations.push(iterResult);
        break;
      }

      // 8. Score the improved prompt to confirm it's actually better
      let improvedResponse;
      try {
        const improvedResult = await this.ai.complete(
          [{ role: 'user', content: improvedText }],
          { maxTokens: 1500, temperature: 0.2 }
        );
        improvedResponse = improvedResult.content;
      } catch (err) {
        iterResult.error = `Improved-prompt execution failed: ${err.message}`;
        report.iterations.push(iterResult);
        break;
      }

      const improvedScores = await this._calculateScores(improvedText, improvedResponse, executions);
      const isActuallyBetter = this._isBetter(improvedScores, scores);

      if (isActuallyBetter) {
        // 9. Persist a new PromptVersion and update the PromptLibrary record
        const newVersionId = await this._saveNewVersion(
          promptId, improvedText, ++currentVersion, improvedScores
        );

        currentPromptText      = improvedText;
        iterResult.improved    = true;
        iterResult.newVersionId = newVersionId;
        iterResult.improvedScores = improvedScores;
        report.improved        = true;
      }
      // If not better, keep the current prompt and try again next iteration

      report.iterations.push(iterResult);
    }

    report.finishedAt = new Date().toISOString();
    if (!report.finalScores && report.iterations.length > 0) {
      const last = report.iterations[report.iterations.length - 1];
      report.finalScores = last.improvedScores || last.scores || null;
    }

    return report;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Ask the AI to generate an improved version of the prompt given the current
   * scores and recent execution history.
   *
   * @param {string}   currentPrompt   Current prompt text
   * @param {object}   scores          { quality, alignment, business, confidence, hallucinationRisk }
   * @param {Array}    executions      Recent execution records (may be empty)
   * @returns {Promise<string>} Improved prompt text
   * @private
   */
  async _generateImprovedPrompt(currentPrompt, scores, executions) {
    const weakAreas = this._identifyWeakAreas(scores);

    const executionContext = executions.length > 0
      ? `\nRecent execution feedback:\n${executions.slice(0, 3).map(e =>
          `- Response: "${(e.RESPONSE_TEXT || e.responseText || '').substring(0, 200)}..."`
        ).join('\n')}`
      : '';

    const improvementPrompt = `You are a prompt engineering expert. Improve the following prompt to address its weaknesses.

Current prompt:
"""
${currentPrompt}
"""

Current quality scores (0-100, higher is better except hallucinationRisk):
- Quality score:          ${scores.quality}  (target ≥${SCORE_THRESHOLD})
- Alignment score:        ${scores.alignment} (target ≥${SCORE_THRESHOLD})
- Business relevance:     ${scores.business} (target ≥${SCORE_THRESHOLD})
- Confidence:             ${scores.confidence} (target ≥${SCORE_THRESHOLD})
- Hallucination risk:     ${scores.hallucinationRisk} (target ≤${HALLUCINATION_THRESHOLD})

Weak areas to improve: ${weakAreas.join(', ') || 'none identified — refine for consistency'}
${executionContext}

Rewrite the prompt to:
1. Be more specific and unambiguous
2. Guide the model to give structured, business-appropriate responses
3. Reduce room for hallucination by constraining the answer scope
4. Maintain or improve all scores that already meet the target

Return ONLY the improved prompt text — no explanation, no metadata, no fences.`;

    const result = await this.ai.complete(
      [{ role: 'user', content: improvementPrompt }],
      { maxTokens: 2000, temperature: 0.3 }
    );

    return result.content.trim();
  }

  /**
   * Score a prompt/response pair, enriching with execution history context.
   *
   * @param {string} promptText
   * @param {string} response
   * @param {Array}  executions  Recent execution history
   * @returns {Promise<object>}  Scores object
   * @private
   */
  async _calculateScores(promptText, response, executions = []) {
    const context = executions.length > 0
      ? `This prompt is used in an enterprise bulk data operations system (DUCI). Recent typical responses: ${
          executions.slice(0, 2)
            .map(e => (e.RESPONSE_TEXT || e.responseText || '').substring(0, 150))
            .join(' | ')
        }`
      : 'Enterprise bulk data operations context (DUCI utility company).';

    return this.ai.scoreResponse(promptText, response, context);
  }

  /**
   * Returns true when all scores meet the target thresholds.
   * @private
   */
  _meetsThreshold(scores) {
    return (
      scores.quality          >= SCORE_THRESHOLD &&
      scores.alignment        >= SCORE_THRESHOLD &&
      scores.business         >= SCORE_THRESHOLD &&
      scores.confidence       >= SCORE_THRESHOLD &&
      scores.hallucinationRisk <= HALLUCINATION_THRESHOLD
    );
  }

  /**
   * Returns true when candidateScores are strictly better than baselineScores
   * (composite average improves and no dimension regresses beyond 5 points).
   * @private
   */
  _isBetter(candidateScores, baselineScores) {
    const avgCandidate = (
      candidateScores.quality +
      candidateScores.alignment +
      candidateScores.business +
      candidateScores.confidence -
      candidateScores.hallucinationRisk   // lower is better
    ) / 5;

    const avgBaseline = (
      baselineScores.quality +
      baselineScores.alignment +
      baselineScores.business +
      baselineScores.confidence -
      baselineScores.hallucinationRisk
    ) / 5;

    if (avgCandidate <= avgBaseline) return false;

    // Reject if any previously-good dimension regressed by more than 5 points
    const dimensions = ['quality', 'alignment', 'business', 'confidence'];
    for (const dim of dimensions) {
      if (baselineScores[dim] >= SCORE_THRESHOLD &&
          candidateScores[dim] < baselineScores[dim] - 5) {
        return false;
      }
    }

    return true;
  }

  /**
   * Return a list of dimension names that do not meet their target thresholds.
   * @private
   */
  _identifyWeakAreas(scores) {
    const weak = [];
    if (scores.quality          < SCORE_THRESHOLD)       weak.push('quality');
    if (scores.alignment        < SCORE_THRESHOLD)       weak.push('alignment with prompt');
    if (scores.business         < SCORE_THRESHOLD)       weak.push('business relevance');
    if (scores.confidence       < SCORE_THRESHOLD)       weak.push('confidence / clarity');
    if (scores.hallucinationRisk > HALLUCINATION_THRESHOLD) weak.push('hallucination risk (reduce vagueness)');
    return weak;
  }

  // ── Database helpers ────────────────────────────────────────────────────────

  /** @private */
  async _loadPrompt(promptId) {
    try {
      const { SELECT } = require('@sap/cds').ql;
      return await this.db.run(
        SELECT.one.from('mae.db.PromptLibrary').where({ ID: promptId })
      );
    } catch {
      // Fallback for environments where cds.ql is not yet loaded
      return null;
    }
  }

  /** @private */
  async _loadRecentExecutions(promptId, limit = 10) {
    try {
      const { SELECT } = require('@sap/cds').ql;
      return await this.db.run(
        SELECT.from('mae.db.PromptExecutions')
          .where({ PROMPT_ID: promptId })
          .orderBy('CREATED_ON desc')
          .limit(limit)
      ) || [];
    } catch {
      return [];
    }
  }

  /** @private */
  async _saveNewVersion(promptId, promptText, versionNumber, scores) {
    const { v4: uuidv4 } = require('uuid');
    const { INSERT, UPDATE } = require('@sap/cds').ql;

    const versionId = uuidv4();
    const now       = new Date().toISOString();

    try {
      // Insert into PromptVersions
      await this.db.run(
        INSERT.into('mae.db.PromptVersions').entries({
          ID:                  versionId,
          PROMPT_ID:           promptId,
          VERSION:             versionNumber,
          PROMPT_TEXT:         promptText,
          QUALITY_SCORE:       scores.quality,
          ALIGNMENT_SCORE:     scores.alignment,
          BUSINESS_SCORE:      scores.business,
          CONFIDENCE_SCORE:    scores.confidence,
          HALLUCINATION_RISK:  scores.hallucinationRisk,
          CREATED_ON:          now
        })
      );

      // Update the PromptLibrary to point at the latest version
      await this.db.run(
        UPDATE('mae.db.PromptLibrary')
          .set({
            PROMPT_TEXT:         promptText,
            VERSION:             versionNumber,
            QUALITY_SCORE:       scores.quality,
            ALIGNMENT_SCORE:     scores.alignment,
            BUSINESS_SCORE:      scores.business,
            CONFIDENCE_SCORE:    scores.confidence,
            HALLUCINATION_RISK:  scores.hallucinationRisk,
            UPDATED_ON:          now
          })
          .where({ ID: promptId })
      );
    } catch (err) {
      console.warn('[PromptOptimizer] Failed to persist new version:', err.message);
    }

    return versionId;
  }
}

module.exports = { PromptOptimizer };
