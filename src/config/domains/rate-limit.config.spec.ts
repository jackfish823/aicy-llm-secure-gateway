import { describe, expect, it } from 'vitest';
import { rateLimitConfigFromEnv } from './rate-limit.config.js';

describe('rate-limit config', () => {
  it('defaults to 60 requests per 60 seconds', () => {
    expect(rateLimitConfigFromEnv({})).toEqual({ windowMs: 60_000, max: 60 });
  });

  it('coerces numeric strings', () => {
    expect(rateLimitConfigFromEnv({ RATE_LIMIT_WINDOW_MS: '1000', RATE_LIMIT_MAX: '5' })).toEqual({
      windowMs: 1000,
      max: 5,
    });
  });

  it('rejects zero, negative and fractional values', () => {
    expect(() => rateLimitConfigFromEnv({ RATE_LIMIT_MAX: '0' })).toThrow(/RATE_LIMIT_MAX/);
    expect(() => rateLimitConfigFromEnv({ RATE_LIMIT_WINDOW_MS: '-1' })).toThrow(
      /RATE_LIMIT_WINDOW_MS/,
    );
    expect(() => rateLimitConfigFromEnv({ RATE_LIMIT_MAX: '2.5' })).toThrow(/RATE_LIMIT_MAX/);
  });
});
