import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { captureError } from './env.fixture.js';
import { EnvValidationError, parseEnv } from './parse-env.js';

const schema = z.object({
  SECRET: z.string().min(32),
  COUNT: z.coerce.number().int(),
});

describe('parseEnv', () => {
  it('returns the parsed, coerced value on success', () => {
    expect(parseEnv(schema, { SECRET: 'x'.repeat(32), COUNT: '7' })).toEqual({
      SECRET: 'x'.repeat(32),
      COUNT: 7,
    });
  });

  it('throws EnvValidationError naming each failing variable once', () => {
    const error = captureError(() => parseEnv(schema, { SECRET: 'tiny', COUNT: 'many' }));

    expect(error).toBeInstanceOf(EnvValidationError);
    expect(error.message).toMatch(/SECRET/);
    expect(error.message).toMatch(/COUNT/);
    expect(error.message.match(/SECRET/g)).toHaveLength(1);
  });

  it('never echoes the offending value into the error', () => {
    const error = captureError(() => parseEnv(schema, { SECRET: 'tiny-secret-value', COUNT: '1' }));

    expect(error.message).not.toContain('tiny-secret-value');
  });

  it('exposes the formatted issues for structured reporting', () => {
    const error = captureError(() => parseEnv(schema, {}));

    expect(error).toBeInstanceOf(EnvValidationError);
    if (error instanceof EnvValidationError) {
      expect(error.issues).toHaveLength(2);
      expect(error.issues[0]).toMatch(/^SECRET: /);
    }
  });
});
