import { describe, expect, it } from 'vitest';
import { appConfigFromEnv } from './app.config.js';

describe('app config', () => {
  it('applies defaults when optional variables are absent', () => {
    expect(appConfigFromEnv({})).toEqual({
      env: 'development',
      port: 3000,
      logLevel: 'log',
      logLevels: ['fatal', 'error', 'warn', 'log'],
      logPretty: false,
      isProduction: false,
    });
  });

  it('coerces PORT to a number', () => {
    expect(appConfigFromEnv({ PORT: '8080' }).port).toBe(8080);
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => appConfigFromEnv({ PORT: 'eighty' })).toThrow(/PORT/);
  });

  it('rejects an out-of-range PORT', () => {
    expect(() => appConfigFromEnv({ PORT: '70000' })).toThrow(/PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => appConfigFromEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('flags production', () => {
    const config = appConfigFromEnv({ NODE_ENV: 'production' });

    expect(config.env).toBe('production');
    expect(config.isProduction).toBe(true);
  });

  it('expands LOG_LEVEL into the enabled Nest log levels', () => {
    expect(appConfigFromEnv({ LOG_LEVEL: 'warn' }).logLevels).toEqual(['fatal', 'error', 'warn']);
    expect(appConfigFromEnv({ LOG_LEVEL: 'verbose' }).logLevels).toEqual([
      'fatal',
      'error',
      'warn',
      'log',
      'debug',
      'verbose',
    ]);
  });

  it('parses LOG_PRETTY as a boolean string', () => {
    expect(appConfigFromEnv({ LOG_PRETTY: 'true' }).logPretty).toBe(true);
    expect(appConfigFromEnv({ LOG_PRETTY: '0' }).logPretty).toBe(false);
    expect(() => appConfigFromEnv({ LOG_PRETTY: 'maybe' })).toThrow(/LOG_PRETTY/);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => appConfigFromEnv({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });
});
