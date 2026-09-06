import { describe, expect, it } from 'vitest';
import { readNodeEnv, resolveEnvFiles } from './env-files.js';

describe('resolveEnvFiles', () => {
  it('development loads .env.local before .env', () => {
    expect(resolveEnvFiles('development')).toEqual({
      ignoreEnvFile: false,
      envFilePath: ['.env.local', '.env'],
    });
  });

  it('test loads only .env.test', () => {
    expect(resolveEnvFiles('test')).toEqual({ ignoreEnvFile: false, envFilePath: ['.env.test'] });
  });

  it('production reads the process environment only', () => {
    expect(resolveEnvFiles('production')).toEqual({ ignoreEnvFile: true, envFilePath: [] });
  });
});

describe('readNodeEnv', () => {
  it('defaults to development', () => {
    expect(readNodeEnv({})).toBe('development');
  });

  it('returns a declared value', () => {
    expect(readNodeEnv({ NODE_ENV: 'production' })).toBe('production');
  });

  it('rejects unknown values', () => {
    expect(() => readNodeEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
