import { describe, expect, it } from 'vitest';
import { redisConfigFromEnv } from './redis.config.js';

describe('redis config', () => {
  it('requires REDIS_URL', () => {
    expect(() => redisConfigFromEnv({})).toThrow(/REDIS_URL/);
  });

  it('accepts redis:// and rediss:// URLs with a default key prefix', () => {
    expect(redisConfigFromEnv({ REDIS_URL: 'redis://localhost:6379' })).toEqual({
      url: 'redis://localhost:6379',
      keyPrefix: 'sllm:',
    });
    expect(redisConfigFromEnv({ REDIS_URL: 'rediss://cache.internal:6380/1' }).url).toBe(
      'rediss://cache.internal:6380/1',
    );
  });

  it('rejects other schemes', () => {
    expect(() => redisConfigFromEnv({ REDIS_URL: 'http://localhost:6379' })).toThrow(/REDIS_URL/);
  });

  it('honours a custom REDIS_KEY_PREFIX', () => {
    expect(
      redisConfigFromEnv({ REDIS_URL: 'redis://localhost:6379', REDIS_KEY_PREFIX: 'gw:' })
        .keyPrefix,
    ).toBe('gw:');
  });

  it('rejects an empty REDIS_KEY_PREFIX', () => {
    expect(() =>
      redisConfigFromEnv({ REDIS_URL: 'redis://localhost:6379', REDIS_KEY_PREFIX: '' }),
    ).toThrow(/REDIS_KEY_PREFIX/);
  });
});
