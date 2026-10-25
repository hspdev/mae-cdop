/**
 * Unit tests — MailingAddressHandler
 */

'use strict';

const { MailingAddressHandler } = require('../../srv/handlers/MailingAddressHandler');

function makeContext(parameters, simulationMode = true) {
  const dbUpdates = [];
  const dbInserts = [];

  const db = {
    run: jest.fn(async (query) => {
      if (query && query.SELECT) return null;
      return null;
    })
  };

  return {
    batchId: 'test-batch-001',
    parameters,
    simulationMode,
    db,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    retryCount: 0
  };
}

describe('MailingAddressHandler.validate()', () => {
  test('fails when no parameters', async () => {
    const ctx = makeContext(null);
    const h = new MailingAddressHandler(ctx);
    const result = await h.validate();
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('fails when no contractAccounts and no filter', async () => {
    const ctx = makeContext({ newAddress: { streetAddress: '1 Main St', city: 'Allentown', stateCode: 'PA', zipCode: '18101' } });
    const h = new MailingAddressHandler(ctx);
    const result = await h.validate();
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('contractAccounts'))).toBe(true);
  });

  test('fails when campaignData has no newAddress fields', async () => {
    const ctx = makeContext({
      contractAccounts: ['CA000001'],
      campaignData: [{ contractAccount: 'CA000001' }]  // missing address fields
    });
    const h = new MailingAddressHandler(ctx);
    const result = await h.validate();
    expect(result.valid).toBe(false);
  });

  test('passes with contractAccounts and newAddress', async () => {
    const ctx = makeContext({
      contractAccounts: ['CA000001', 'CA000002'],
      newAddress: { streetAddress: '100 Main St', city: 'Allentown', stateCode: 'PA', zipCode: '18101' }
    });
    const h = new MailingAddressHandler(ctx);
    const result = await h.validate();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('passes with filter.city and useExistingAddressHistory', async () => {
    const ctx = makeContext({
      filter: { city: 'Allentown', daysBack: 90 },
      useExistingAddressHistory: true
    });
    const h = new MailingAddressHandler(ctx);
    const result = await h.validate();
    expect(result.valid).toBe(true);
  });

  test('fails when more than 100000 accounts', async () => {
    const ctx = makeContext({
      contractAccounts: new Array(100001).fill('CA000001'),
      newAddress: { streetAddress: '1 St', city: 'A', stateCode: 'PA', zipCode: '18101' }
    });
    const h = new MailingAddressHandler(ctx);
    const result = await h.validate();
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('100,000'))).toBe(true);
  });
});

describe('MailingAddressHandler._resolveNewAddress()', () => {
  test('resolves from newAddress (mass update)', () => {
    const ctx = makeContext({
      contractAccounts: ['CA001'],
      newAddress: { streetAddress: '5 Oak Ave', city: 'Bethlehem', stateCode: 'PA', zipCode: '18015' }
    });
    const h = new MailingAddressHandler(ctx);
    const addr = h._resolveNewAddress({ contractAccount: 'CA001' });
    expect(addr.city).toBe('Bethlehem');
  });

  test('resolves from campaignData map', () => {
    const ctx = makeContext({
      contractAccounts: ['CA001'],
      campaignData: [{ contractAccount: 'CA001', streetAddress: '9 Pine Rd', city: 'Easton', stateCode: 'PA', zipCode: '18042' }]
    });
    const h = new MailingAddressHandler(ctx);
    const addr = h._resolveNewAddress({ contractAccount: 'CA001' });
    expect(addr.city).toBe('Easton');
  });

  test('returns null when no matching campaign record', () => {
    const ctx = makeContext({
      contractAccounts: ['CA001'],
      campaignData: [{ contractAccount: 'CA999', streetAddress: '1 St', city: 'X', stateCode: 'PA', zipCode: '18101' }]
    });
    const h = new MailingAddressHandler(ctx);
    const addr = h._resolveNewAddress({ contractAccount: 'CA001' });
    expect(addr).toBeNull();
  });
});
