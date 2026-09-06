import Anthropic from '@anthropic-ai/sdk';
import type { LlmConfig } from '../../config/domains/llm.config.js';
import type { AnthropicRequest } from './anthropic.codec.js';

/** The slice of the SDK the adapter uses. Tests stub this; production passes the real client. */
export interface AnthropicMessagesClient {
  messages: {
    create(params: AnthropicRequest, options: { signal: AbortSignal }): Promise<unknown>;
  };
}

/**
 * Every knob the SDK would otherwise read from the environment is pinned here so the
 * Zod-validated config is the only source of truth:
 * - `logLevel: 'off'`: at `debug` the SDK logs request bodies (message content) to console
 *   and would honour ANTHROPIC_LOG; off keeps CLAUDE.md rule 2 intact.
 * - `baseURL` always explicit: `undefined` would fall through to ANTHROPIC_BASE_URL.
 * - `maxRetries: 0`: the executor's deadline is the single timing authority.
 */
export const createAnthropicClient = (config: LlmConfig): AnthropicMessagesClient => {
  return new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl ?? 'https://api.anthropic.com',
    timeout: config.timeoutMs,
    maxRetries: 0,
    logLevel: 'off',
  });
};
