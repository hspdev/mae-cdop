/**
 * Unit tests — RetryFramework
 */

'use strict';

const { RetryFramework } = require('../../srv/lib/RetryFramework');

describe('RetryFramework', () => {
  test('withRetry succeeds on first attempt', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await RetryFramework.withRetry(fn, 'test', console, 2);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('withRetry retries and succeeds on second attempt', async () => {
    let callCount = 0;
    const fn = jest.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 2) throw new Error('transient error');
      return 'success';
    });
    const result = await RetryFramework.withRetry(fn, 'test', console, 2);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('withRetry throws after max retries exhausted', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('persistent error'));
    await expect(RetryFramework.withRetry(fn, 'test', console, 2)).rejects.toThrow('persistent error');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  test('getDelay returns exponential values', () => {
    expect(RetryFramework.getDelay(0)).toBe(1000);
    expect(RetryFramework.getDelay(1)).toBe(2000);
    expect(RetryFramework.getDelay(2)).toBe(4000);
  });

  test('shouldRetry returns false at maxRetries', () => {
    expect(RetryFramework.shouldRetry(0)).toBe(true);
    expect(RetryFramework.shouldRetry(2)).toBe(true);
    expect(RetryFramework.shouldRetry(3)).toBe(false);
  });
});
