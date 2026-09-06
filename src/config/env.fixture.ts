import { vi } from 'vitest';

export type RawEnv = Record<string, string | undefined>;

export function validEnv(overrides: RawEnv = {}): RawEnv {
  return {
    NODE_ENV: 'test',
    PORT: '3000',
    LOG_LEVEL: 'log',
    MONGO_URI: 'mongodb://localhost:27017/securellm-test',
    REDIS_URL: 'redis://localhost:6379',
    REDIS_KEY_PREFIX: 'sllm-test:',
    LLM_PROVIDER: 'anthropic',
    LLM_MODEL: 'claude-opus-5',
    LLM_TIMEOUT_MS: '30000',
    ANTHROPIC_API_KEY: 'placeholder-anthropic-key',
    AUTH_API_KEY_PEPPER: 'placeholder-pepper-placeholder-pepper-0000',
    PII_TOKEN_KEY: '00'.repeat(32),
    RATE_LIMIT_WINDOW_MS: '60000',
    RATE_LIMIT_MAX: '60',
    ...overrides,
  };
}

export function stubEnv(env: RawEnv): void {
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
}

export function captureError(fn: () => unknown): Error {
  try {
    fn();
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
    throw new Error('threw a non-Error value', { cause: error });
  }
  throw new Error('expected the call to throw');
}
