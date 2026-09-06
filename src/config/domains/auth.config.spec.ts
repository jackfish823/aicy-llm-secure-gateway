import { describe, expect, it } from 'vitest';
import { captureError } from '../env.fixture.js';
import { authConfigFromEnv } from './auth.config.js';

describe('auth config', () => {
  it('requires AUTH_API_KEY_PEPPER', () => {
    expect(() => authConfigFromEnv({})).toThrow(/AUTH_API_KEY_PEPPER/);
  });

  it('accepts a pepper of at least 32 characters', () => {
    const pepper = 'p'.repeat(32);

    expect(authConfigFromEnv({ AUTH_API_KEY_PEPPER: pepper })).toEqual({ apiKeyPepper: pepper });
  });

  it('rejects a short pepper without echoing it', () => {
    const error = captureError(() => authConfigFromEnv({ AUTH_API_KEY_PEPPER: 'short-secret' }));

    expect(error.message).toMatch(/AUTH_API_KEY_PEPPER/);
    expect(error.message).not.toContain('short-secret');
  });
});
