import type Anthropic from '@anthropic-ai/sdk';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  LlmProviderError,
  type LlmProviderErrorKind,
  type LlmRequest,
  type LlmResponse,
  type StopReason,
} from '../llm-provider.js';

export type AnthropicRequest = Anthropic.MessageCreateParamsNonStreaming;

/**
 * Only the fields the gateway reads. Non-strict on purpose: the SDK adds more fields and
 * the API may add more block types; both are ignored rather than rejected.
 */
export const anthropicResponseSchema = z.object({
  model: z.string().min(1),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  stop_reason: z.string().nullable(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});
export type AnthropicResponse = z.output<typeof anthropicResponseSchema>;

export const toAnthropicRequest = (request: LlmRequest): AnthropicRequest => {
  const params: AnthropicRequest = {
    model: request.model,
    max_tokens: request.maxTokens,
    messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
  };
  if (request.system !== undefined) {
    params.system = request.system;
  }
  return params;
};

export const fromAnthropicResponse = (response: AnthropicResponse): LlmResponse => {
  const content = response.content
    .flatMap((block) => (block.type === 'text' && block.text !== undefined ? [block.text] : []))
    .join('');
  return {
    content,
    model: response.model,
    stopReason: toStopReason(response.stop_reason),
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
};

const toStopReason = (reason: string | null): StopReason => {
  switch (reason) {
    case 'end_turn':
    case 'max_tokens':
    case 'stop_sequence':
      return reason;
    default:
      return 'other';
  }
};

/** Gateway-authored messages only; the SDK error rides along as `cause` for debug logs. */
export const toAnthropicError = (error: unknown): LlmProviderError => {
  if (error instanceof LlmProviderError) {
    return error;
  }
  if (error instanceof APIUserAbortError || error instanceof APIConnectionTimeoutError) {
    return new LlmProviderError('timeout', 'anthropic request timed out', { cause: error });
  }
  if (error instanceof APIConnectionError) {
    return new LlmProviderError('network', 'anthropic request failed to connect', { cause: error });
  }
  if (error instanceof APIError) {
    // `instanceof` narrowing against APIError's generic type parameters leaves `.status`
    // typed `any`; sanitise it through a `typeof` guard rather than trusting that type.
    const status = toStatus(error.status);
    return new LlmProviderError(
      kindForStatus(status),
      `anthropic request failed with status ${status ?? 'unknown'}`,
      { status, cause: error },
    );
  }
  return new LlmProviderError('upstream', 'anthropic request failed', { cause: error });
};

const toStatus = (status: unknown): number | undefined => {
  return typeof status === 'number' ? status : undefined;
};

const kindForStatus = (status: number | undefined): LlmProviderErrorKind => {
  if (status === 401 || status === 403) {
    return 'auth';
  }
  if (status === 429) {
    return 'rate_limited';
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return 'bad_request';
  }
  return 'upstream';
};
