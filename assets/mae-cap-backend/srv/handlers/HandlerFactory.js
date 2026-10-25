/**
 * HandlerFactory — Factory Pattern for IBulkJobHandler creation
 *
 * Design Pattern: Abstract Factory + Registry
 *
 * Registers and resolves concrete handler implementations by job type.
 * Framework code never changes when new handlers are added — just register.
 *
 * Usage:
 *   HandlerFactory.register('MY_NEW_TYPE', MyNewHandler);
 *   const handler = HandlerFactory.create(jobType, context);
 */

'use strict';

const { MailingAddressHandler }     = require('./MailingAddressHandler');
const { ContractAccountHandler }    = require('./ContractAccountHandler');
const { CustomerPreferenceHandler } = require('./CustomerPreferenceHandler');
const { NotificationHandler }       = require('./NotificationHandler');

class HandlerFactory {
  constructor() {
    this._registry = new Map();
  }

  /**
   * Register a handler class for a given job type.
   * @param {string} jobType - e.g. 'MAILING_ADDRESS_UPDATE'
   * @param {class} HandlerClass - Must extend IBulkJobHandler
   */
  register(jobType, HandlerClass) {
    if (typeof HandlerClass !== 'function') {
      throw new Error(`Handler for ${jobType} must be a class/constructor`);
    }
    this._registry.set(jobType, HandlerClass);
  }

  /**
   * Create a handler instance for the given job type.
   * @param {string} jobType
   * @param {object} context - Execution context (batchId, parameters, db, logger, ...)
   * @returns {IBulkJobHandler}
   * @throws {Error} if jobType is not registered
   */
  create(jobType, context) {
    const HandlerClass = this._registry.get(jobType);
    if (!HandlerClass) {
      const available = Array.from(this._registry.keys()).join(', ');
      throw new Error(
        `Unknown job type: "${jobType}". Registered types: [${available}]`
      );
    }
    return new HandlerClass(context);
  }

  /**
   * Returns all registered job types
   * @returns {string[]}
   */
  getRegisteredTypes() {
    return Array.from(this._registry.keys());
  }

  /**
   * Check if a job type is registered
   * @param {string} jobType
   * @returns {boolean}
   */
  isRegistered(jobType) {
    return this._registry.has(jobType);
  }
}

// ── Singleton instance with all handlers pre-registered ──────────────────────
const factory = new HandlerFactory();

factory.register('MAILING_ADDRESS_UPDATE',     MailingAddressHandler);
factory.register('CONTRACT_ACCOUNT_UPDATE',    ContractAccountHandler);
factory.register('CUSTOMER_PREFERENCE_UPDATE', CustomerPreferenceHandler);
factory.register('NOTIFICATION_REQUEST',       NotificationHandler);

// Export singleton — import and call factory.create(jobType, context)
module.exports = { HandlerFactory, factory };
