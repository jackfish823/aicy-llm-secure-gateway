import { describe, expect, it } from 'vitest';
import { piiConfigFromEnv } from './pii.config.js';

const hexKey = '0123456789abcdef'.repeat(4);

describe('pii config', () => {
  it('requires PII_TOKEN_KEY', () => {
    expect(() => piiConfigFromEnv({})).toThrow(/PII_TOKEN_KEY/);
  });

  it('decodes a 64-character hex key into 32 bytes', () => {
    const { tokenKey } = piiConfigFromEnv({ PII_TOKEN_KEY: hexKey });

    expect(tokenKey).toBeInstanceOf(Buffer);
    expect(tokenKey.length).toBe(32);
    expect(tokenKey.equals(Buffer.from(hexKey, 'hex'))).toBe(true);
  });

  it('accepts upper-case hex', () => {
    expect(piiConfigFromEnv({ PII_TOKEN_KEY: hexKey.toUpperCase() }).tokenKey.length).toBe(32);
  });

  it('rejects keys that are not exactly 32 bytes of hex', () => {
    expect(() => piiConfigFromEnv({ PII_TOKEN_KEY: hexKey.slice(1) })).toThrow(/PII_TOKEN_KEY/);
    expect(() => piiConfigFromEnv({ PII_TOKEN_KEY: 'zz'.repeat(32) })).toThrow(/PII_TOKEN_KEY/);
  });
});
