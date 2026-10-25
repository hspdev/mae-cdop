/**
 * RetryFramework — Exponential backoff retry logic for bulk job engine
 *
 * Config (from env):
 *   MAX_RETRY_COUNT     = 3
 *   RETRY_BASE_DELAY_MS = 1000  (doubles each retry: 1s, 2s, 4s)
 */

'use strict';

const MAX_RETRY = parseInt(process.env.MAX_RETRY_COUNT || '3');
const BASE_DELAY = parseInt(process.env.RETRY_BASE_DELAY_MS || '1000');

class RetryFramework {

  /**
   * Execute a function with exponential backoff retries.
   *
   * @param {Function} fn           - Async function to execute
   * @param {string}   operationId  - For logging
   * @param {object}   logger       - Winston logger
   * @param {number}   maxRetries   - Override default max retries
   * @returns {Promise<any>}
   * @throws {Error}  if all retries exhausted
   */
  static async withRetry(fn, operationId = 'operation', logger = console, maxRetries = MAX_RETRY) {
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await fn(attempt);
        if (attempt > 0) {
          logger.info(`[RetryFramework] ${operationId} succeeded on attempt ${attempt + 1}`);
        }
        return result;
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          const delay = BASE_DELAY * Math.pow(2, attempt);
          logger.warn(`[RetryFramework] ${operationId} failed (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delay}ms. Error: ${err.message}`);
          await RetryFramework._sleep(delay);
        }
      }
    }

    logger.error(`[RetryFramework] ${operationId} exhausted all ${maxRetries + 1} attempts. Last error: ${lastError.message}`);
    throw lastError;
  }

  /**
   * Calculate delay for a given retry attempt (for external use)
   * @param {number} attempt - Zero-based attempt number
   * @returns {number} delay in milliseconds
   */
  static getDelay(attempt) {
    return BASE_DELAY * Math.pow(2, attempt);
  }

  /**
   * Check if a job should be retried based on retry count
   * @param {number} currentRetryCount
   * @returns {boolean}
   */
  static shouldRetry(currentRetryCount) {
    return currentRetryCount < MAX_RETRY;
  }

  /**
   * Get max retry count
   */
  static get maxRetries() {
    return MAX_RETRY;
  }

  static _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { RetryFramework };
