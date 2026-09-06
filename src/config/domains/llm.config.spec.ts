import { describe, expect, it } from 'vitest';
import { llmConfigFromEnv, MAX_OUTPUT_TOKENS } from './llm.config.js';

const anthropic = {
  LLM_PROVIDER: 'anthropic',
  LLM_MODEL: 'claude-opus-5',
  ANTHROPIC_API_KEY: 'placeholder-anthropic-key',
};

const openai = {
  LLM_PROVIDER: 'openai',
  LLM_MODEL: 'gpt-5',
  OPENAI_API_KEY: 'placeholder-openai-key',
};

describe('llm config', () => {
  it('builds anthropic config with the anthropic key and default timeout', () => {
    expect(llmConfigFromEnv(anthropic)).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5',
      apiKey: 'placeholder-anthropic-key',
      timeoutMs: 30_000,
      baseUrl: undefined,
      maxOutputTokens: 1024,
    });
  });

  it('builds openai config with the openai key', () => {
    expect(llmConfigFromEnv(openai)).toMatchObject({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'placeholder-openai-key',
    });
  });

  it('requires the key of the selected provider only', () => {
    expect(() =>
      llmConfigFromEnv({ LLM_PROVIDER: 'anthropic', LLM_MODEL: 'm', OPENAI_API_KEY: 'x' }),
    ).toThrow(/ANTHROPIC_API_KEY/);
    expect(() =>
      llmConfigFromEnv({ LLM_PROVIDER: 'openai', LLM_MODEL: 'm', ANTHROPIC_API_KEY: 'x' }),
    ).toThrow(/OPENAI_API_KEY/);
  });

  it('requires LLM_PROVIDER and rejects unknown providers', () => {
    expect(() => llmConfigFromEnv({ LLM_MODEL: 'm', ANTHROPIC_API_KEY: 'x' })).toThrow(
      /LLM_PROVIDER/,
    );
    expect(() =>
      llmConfigFromEnv({ LLM_PROVIDER: 'cohere', LLM_MODEL: 'm', ANTHROPIC_API_KEY: 'x' }),
    ).toThrow(/LLM_PROVIDER/);
  });

  it('requires LLM_MODEL', () => {
    expect(() => llmConfigFromEnv({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'x' })).toThrow(
      /LLM_MODEL/,
    );
  });

  it('coerces LLM_TIMEOUT_MS and rejects non-positive values', () => {
    expect(llmConfigFromEnv({ ...anthropic, LLM_TIMEOUT_MS: '5000' }).timeoutMs).toBe(5000);
    expect(() => llmConfigFromEnv({ ...anthropic, LLM_TIMEOUT_MS: '0' })).toThrow(/LLM_TIMEOUT_MS/);
  });

  it('treats an empty LLM_BASE_URL as unset and validates a present one', () => {
    expect(llmConfigFromEnv({ ...anthropic, LLM_BASE_URL: '' }).baseUrl).toBeUndefined();
    expect(
      llmConfigFromEnv({ ...anthropic, LLM_BASE_URL: 'https://proxy.internal/v1' }).baseUrl,
    ).toBe('https://proxy.internal/v1');
    expect(() => llmConfigFromEnv({ ...anthropic, LLM_BASE_URL: 'not a url' })).toThrow(
      /LLM_BASE_URL/,
    );
  });

  it('treats an empty provider key as unset', () => {
    expect(() => llmConfigFromEnv({ ...anthropic, ANTHROPIC_API_KEY: '' })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it('defaults LLM_MAX_OUTPUT_TOKENS to 1024 and coerces overrides', () => {
    expect(llmConfigFromEnv(anthropic).maxOutputTokens).toBe(1024);
    expect(llmConfigFromEnv({ ...anthropic, LLM_MAX_OUTPUT_TOKENS: '4096' }).maxOutputTokens).toBe(
      4096,
    );
  });

  it('rejects a non-positive LLM_MAX_OUTPUT_TOKENS', () => {
    expect(() => llmConfigFromEnv({ ...anthropic, LLM_MAX_OUTPUT_TOKENS: '0' })).toThrow(
      /LLM_MAX_OUTPUT_TOKENS/,
    );
  });

  it('rejects LLM_MAX_OUTPUT_TOKENS above the contract cap or non-integer', () => {
    expect(() =>
      llmConfigFromEnv({ ...anthropic, LLM_MAX_OUTPUT_TOKENS: String(MAX_OUTPUT_TOKENS + 1) }),
    ).toThrow(/LLM_MAX_OUTPUT_TOKENS/);
    expect(() => llmConfigFromEnv({ ...anthropic, LLM_MAX_OUTPUT_TOKENS: '1024.5' })).toThrow(
      /LLM_MAX_OUTPUT_TOKENS/,
    );
    expect(
      llmConfigFromEnv({ ...anthropic, LLM_MAX_OUTPUT_TOKENS: String(MAX_OUTPUT_TOKENS) })
        .maxOutputTokens,
    ).toBe(MAX_OUTPUT_TOKENS);
  });
});
