import { LlmProviderAdapter } from '../llm-provider.adapter.js';
import type {
  LlmProviderError,
  LlmProviderName,
  LlmRequest,
  LlmResponse,
} from '../llm-provider.js';
import type { AnthropicMessagesClient } from './anthropic.client.js';
import {
  anthropicResponseSchema,
  fromAnthropicResponse,
  toAnthropicError,
  toAnthropicRequest,
  type AnthropicRequest,
  type AnthropicResponse,
} from './anthropic.codec.js';

/** Wiring only; every conversion lives in anthropic.codec.ts. */
export class AnthropicProvider extends LlmProviderAdapter<AnthropicRequest, AnthropicResponse> {
  readonly name: LlmProviderName = 'anthropic';

  constructor(private readonly client: AnthropicMessagesClient) {
    super();
  }

  protected toProviderRequest(request: LlmRequest): AnthropicRequest {
    return toAnthropicRequest(request);
  }

  protected send(request: AnthropicRequest, signal: AbortSignal): Promise<unknown> {
    return this.client.messages.create(request, { signal });
  }

  protected parseProviderResponse(raw: unknown): AnthropicResponse {
    return anthropicResponseSchema.parse(raw);
  }

  protected toLlmResponse(response: AnthropicResponse): LlmResponse {
    return fromAnthropicResponse(response);
  }

  protected toProviderError(error: unknown): LlmProviderError {
    return toAnthropicError(error);
  }
}
