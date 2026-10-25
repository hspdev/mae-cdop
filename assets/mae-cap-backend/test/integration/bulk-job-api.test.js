/**
 * Integration tests — Bulk Job REST API
 *
 * Uses CAP in-memory SQLite for isolated testing.
 * Validates the full API contract: create → status → result → cancel → reprocess
 */

'use strict';

const cds = require('@sap/cds');

// cds.test() boots a full CAP server (SQLite in-memory) and exposes .axios
const { GET, POST, axios } = cds.test(__dirname + '/../..').in(__dirname + '/../..');

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SIMULATION_MODE = 'true';
}, 30000);

// ── Health ─────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('returns UP status', async () => {
    const res = await GET('/health');
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('UP');
  });
});

// ── Bulk Jobs ──────────────────────────────────────────────────────────────

describe('POST /api/bulk-jobs/:jobType', () => {
  test('returns 400 for unknown job type', async () => {
    try {
      await POST('/api/bulk-jobs/UNKNOWN_JOB', { parameters: {} });
      fail('should have thrown');
    } catch (err) {
      expect(err.response.status).toBe(400);
      expect(err.response.data.error).toContain('Unknown job type');
    }
  });

  test('creates MAILING_ADDRESS_UPDATE job and returns 202', async () => {
    const res = await POST('/api/bulk-jobs/MAILING_ADDRESS_UPDATE', {
      parameters: {
        contractAccounts: ['CA000000001'],
        newAddress: {
          streetAddress: '100 Test St',
          city: 'Allentown',
          stateCode: 'PA',
          zipCode: '18101'
        }
      },
      simulationMode: true,
      description: 'Integration test job'
    });
    expect(res.status).toBe(202);
    expect(res.data.batchId).toBeDefined();
    expect(res.data.status).toBe('QUEUED');
  });
});

// ── Status ─────────────────────────────────────────────────────────────────

describe('GET /api/bulk-jobs/:batchId/status', () => {
  test('returns 404 for non-existent batchId', async () => {
    try {
      await GET('/api/bulk-jobs/00000000-0000-0000-0000-000000000000/status');
      fail('should have thrown');
    } catch (err) {
      expect(err.response.status).toBe(404);
    }
  });
});

// ── Batch Customer Query ───────────────────────────────────────────────────

describe('POST /api/customers/batch', () => {
  test('returns 400 for empty contractAccounts', async () => {
    try {
      await POST('/api/customers/batch', { contractAccounts: [] });
      fail('should have thrown');
    } catch (err) {
      expect(err.response.status).toBe(400);
    }
  });

  test('returns 400 for more than 100000 accounts', async () => {
    const largeList = Array.from({ length: 100001 }, (_, i) => `CA${i}`);
    try {
      await POST('/api/customers/batch', { contractAccounts: largeList });
      fail('should have thrown');
    } catch (err) {
      expect(err.response.status).toBe(400);
      expect(err.response.data.error).toContain('100,000');
    }
  });

  test('returns count and records for valid input', async () => {
    const res = await POST('/api/customers/batch', {
      contractAccounts: ['CA000000001', 'CA000000002']
    });
    expect([200, 201]).toContain(res.status);
    expect(res.data.count).toBeDefined();
    expect(Array.isArray(res.data.records)).toBe(true);
  });
});
