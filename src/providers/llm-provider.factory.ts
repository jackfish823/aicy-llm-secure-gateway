import type { LlmConfig } from '../config/domains/llm.config.js';
import { createAnthropicClient } from './anthropic/anthropic.client.js';
import { AnthropicProvider } from './anthropic/anthropic.provider.js';
import type { LlmProvider } from './llm-provider.js';

export function createLlmProvider(config: LlmConfig): LlmProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(createAnthropicClient(config));
    case 'openai':
      throw new Error('OpenAI adapter not implemented yet: set LLM_PROVIDER=anthropic');
  }
}
