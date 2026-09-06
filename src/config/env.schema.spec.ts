import { describe, expect, it } from 'vitest';
import { captureError, validEnv } from './env.fixture.js';
import { validateEnv } from './env.schema.js';

describe('validateEnv', () => {
  it('accepts a complete environment and returns coerced values', () => {
    const env = validateEnv(validEnv({ PORT: '4321' }));

    expect(env.PORT).toBe(4321);
    expect(env.NODE_ENV).toBe('test');
    expect(env.RATE_LIMIT_MAX).toBe(60);
    expect(env.LLM_PROVIDER).toBe('anthropic');
  });

  it('reports every missing required variable in one error', () => {
    const error = captureError(() => validateEnv({}));

    for (const name of [
      'MONGO_URI',
      'REDIS_URL',
      'LLM_PROVIDER',
      'LLM_MODEL',
      'AUTH_API_KEY_PEPPER',
      'PII_TOKEN_KEY',
    ]) {
      expect(error.message).toContain(name);
    }
  });

  it('enforces the selected-provider key rule at the root', () => {
    const error = captureError(() => validateEnv(validEnv({ LLM_PROVIDER: 'openai' })));

    expect(error.message).toMatch(/OPENAI_API_KEY/);
  });

  it('strips variables it does not declare', () => {
    const env = validateEnv({ ...validEnv(), SHELL: '/bin/zsh' });

    expect(env).not.toHaveProperty('SHELL');
  });
});
