import { describe, expect, it } from 'vitest';
import type { LlmConfig } from '../config/domains/llm.config.js';
import { AnthropicProvider } from './anthropic/anthropic.provider.js';
import { createLlmProvider } from './llm-provider.factory.js';

const config: LlmConfig = {
  provider: 'anthropic',
  model: 'claude-opus-5',
  apiKey: 'placeholder',
  timeoutMs: 1000,
  baseUrl: undefined,
  maxOutputTokens: 1024,
};

describe('createLlmProvider', () => {
  it('builds the Anthropic adapter for LLM_PROVIDER=anthropic', () => {
    const provider = createLlmProvider(config);

    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.name).toBe('anthropic');
  });

  it('refuses to boot with the not-yet-implemented OpenAI adapter', () => {
    expect(() => createLlmProvider({ ...config, provider: 'openai' })).toThrow(
      /OpenAI adapter not implemented/,
    );
  });
});
