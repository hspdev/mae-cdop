/**
 * Unit tests — HandlerFactory
 */

'use strict';

const { HandlerFactory, factory } = require('../../srv/handlers/HandlerFactory');
const { IBulkJobHandler }         = require('../../srv/handlers/IBulkJobHandler');

describe('HandlerFactory', () => {
  test('factory singleton has all 4 default handlers registered', () => {
    expect(factory.isRegistered('MAILING_ADDRESS_UPDATE')).toBe(true);
    expect(factory.isRegistered('CONTRACT_ACCOUNT_UPDATE')).toBe(true);
    expect(factory.isRegistered('CUSTOMER_PREFERENCE_UPDATE')).toBe(true);
    expect(factory.isRegistered('NOTIFICATION_REQUEST')).toBe(true);
  });

  test('getRegisteredTypes returns 4 types', () => {
    expect(factory.getRegisteredTypes()).toHaveLength(4);
  });

  test('create returns instance extending IBulkJobHandler', () => {
    const ctx = { batchId: 'test-batch', parameters: {}, simulationMode: true, db: {}, logger: console };
    const handler = factory.create('MAILING_ADDRESS_UPDATE', ctx);
    expect(handler).toBeInstanceOf(IBulkJobHandler);
  });

  test('create throws for unknown job type', () => {
    const ctx = { batchId: 'test', parameters: {}, simulationMode: true, db: {}, logger: console };
    expect(() => factory.create('UNKNOWN_TYPE', ctx)).toThrow('Unknown job type');
  });

  test('register and create new handler', () => {
    const localFactory = new HandlerFactory();
    const MockHandler = class extends IBulkJobHandler {
      async validate()       { return { valid: true, errors: [] }; }
      async loadRecords()    { return { count: 0, records: [] }; }
      async process()        { return { successCount: 0, failedCount: 0, failedRecords: [] }; }
      async verify()         { return { verificationPassed: true, discrepancies: [] }; }
      async generateResults(){ return { summary: {} }; }
    };
    localFactory.register('MOCK_TYPE', MockHandler);
    const ctx = { batchId: 'x', parameters: {}, simulationMode: true, db: {}, logger: console };
    const h = localFactory.create('MOCK_TYPE', ctx);
    expect(h).toBeInstanceOf(MockHandler);
  });

  test('IBulkJobHandler cannot be instantiated directly', () => {
    expect(() => new IBulkJobHandler({})).toThrow('abstract');
  });
});
