/**
 * Unit tests — BatchQueryClient
 * Uses a plain mock db.run that simulates the CDS response.
 * CDS SELECT globals are not available in unit test context —
 * the mock db.run intercepts all calls regardless of query type.
 */

'use strict';

const { BatchQueryClient } = require('../../srv/lib/BatchQueryClient');

const mockRows = [
  { CONTRACT_ACCOUNT: 'CA000001', CUSTOMER_ID: 'CUST001', STATUS: 'ACTIVE', CITY: 'Allentown' },
  { CONTRACT_ACCOUNT: 'CA000002', CUSTOMER_ID: 'CUST002', STATUS: 'ACTIVE', CITY: 'Bethlehem' }
];

describe('BatchQueryClient', () => {
  let client;

  beforeEach(() => {
    // Mock db.run to return mockRows for any query
    client = new BatchQueryClient({
      run: jest.fn(async () => mockRows)
    });
  });

  test('returns empty array for empty input', async () => {
    const result = await client.loadContractAccounts([]);
    expect(result).toEqual([]);
    expect(client.db.run).not.toHaveBeenCalled();
  });

  test('returns records for valid contract accounts', async () => {
    const result = await client.loadContractAccounts(['CA000001', 'CA000002']);
    expect(result).toHaveLength(2);
    expect(client.db.run).toHaveBeenCalledTimes(1);
  });

  test('chunks large arrays correctly', () => {
    const arr = Array.from({ length: 1200 }, (_, i) => `CA${i}`);
    const chunks = client._chunk(arr, 500);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(500);
    expect(chunks[2].length).toBeLessThan(500);
  });

  test('handles null input gracefully', async () => {
    const result = await client.loadContractAccounts(null);
    expect(result).toEqual([]);
  });

  test('processes in multiple chunks when over CHUNK_SIZE', async () => {
    const mockDb = { run: jest.fn(async () => []) };
    const c = new BatchQueryClient(mockDb);

    const bigList = Array.from({ length: 1100 }, (_, i) => `CA${String(i).padStart(6, '0')}`);
    await c.loadContractAccounts(bigList);
    // 1100 accounts with CHUNK_SIZE=500 → 3 chunks (500+500+100)
    expect(mockDb.run).toHaveBeenCalledTimes(3);
  });
});
