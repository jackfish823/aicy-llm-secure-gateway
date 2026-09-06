import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { LlmProviderError, type LlmRequest } from '../llm-provider.js';
import {
  anthropicResponseSchema,
  fromAnthropicResponse,
  toAnthropicError,
  toAnthropicRequest,
} from './anthropic.codec.js';

const request: LlmRequest = {
  model: 'claude-opus-5',
  messages: [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
    { role: 'user', content: 'more' },
  ],
  maxTokens: 16,
};

const rawMessage = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5',
  content: [
    { type: 'text', text: 'Hello' },
    { type: 'tool_use', id: 't1', name: 'x', input: {} },
    { type: 'text', text: ' world' },
  ],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 12, output_tokens: 3, cache_creation_input_tokens: 0 },
};

describe('toAnthropicRequest', () => {
  it('maps the minimal request without emitting undefined keys', () => {
    expect(toAnthropicRequest(request)).toStrictEqual({
      model: 'claude-opus-5',
      max_tokens: 16,
      messages: request.messages,
    });
  });

  it('maps system when present', () => {
    expect(toAnthropicRequest({ ...request, system: 'terse' })).toStrictEqual({
      model: 'claude-opus-5',
      max_tokens: 16,
      messages: request.messages,
      system: 'terse',
    });
  });
});

describe('anthropicResponseSchema + fromAnthropicResponse', () => {
  it('joins text blocks in order, ignores other blocks, maps usage and stop reason', () => {
    const parsed = anthropicResponseSchema.parse(rawMessage);

    expect(fromAnthropicResponse(parsed)).toEqual({
      content: 'Hello world',
      model: 'claude-opus-5',
      stopReason: 'end_turn',
      usage: { inputTokens: 12, outputTokens: 3 },
    });
  });

  it('maps every stop reason', () => {
    const withStop = (stop_reason: string | null) =>
      fromAnthropicResponse(anthropicResponseSchema.parse({ ...rawMessage, stop_reason }))
        .stopReason;

    expect(withStop('max_tokens')).toBe('max_tokens');
    expect(withStop('stop_sequence')).toBe('stop_sequence');
    expect(withStop('tool_use')).toBe('other');
    expect(withStop('refusal')).toBe('other');
    expect(withStop(null)).toBe('other');
  });

  it('rejects responses missing usage or content', () => {
    expect(anthropicResponseSchema.safeParse({ ...rawMessage, usage: undefined }).success).toBe(
      false,
    );
    expect(anthropicResponseSchema.safeParse({ ...rawMessage, content: 'text' }).success).toBe(
      false,
    );
  });

  it('yields empty content when the reply has no text blocks (e.g. max_tokens inside thinking)', () => {
    const parsed = anthropicResponseSchema.parse({
      ...rawMessage,
      content: [{ type: 'thinking', thinking: 'hmm', signature: 'sig' }],
      stop_reason: 'max_tokens',
    });

    expect(fromAnthropicResponse(parsed)).toMatchObject({ content: '', stopReason: 'max_tokens' });
  });
});

describe('toAnthropicError', () => {
  const apiError = (status: number) =>
    new APIError(status, undefined, 'provider said no', new Headers());

  it('maps HTTP statuses to kinds and keeps the status', () => {
    expect(toAnthropicError(apiError(401))).toMatchObject({ kind: 'auth', status: 401 });
    expect(toAnthropicError(apiError(403))).toMatchObject({ kind: 'auth', status: 403 });
    expect(toAnthropicError(apiError(429))).toMatchObject({ kind: 'rate_limited', status: 429 });
    expect(toAnthropicError(apiError(400))).toMatchObject({ kind: 'bad_request' });
    expect(toAnthropicError(apiError(404))).toMatchObject({ kind: 'bad_request' });
    expect(toAnthropicError(apiError(413))).toMatchObject({ kind: 'bad_request' });
    expect(toAnthropicError(apiError(422))).toMatchObject({ kind: 'bad_request' });
    expect(toAnthropicError(apiError(500))).toMatchObject({ kind: 'upstream', status: 500 });
    expect(toAnthropicError(apiError(529))).toMatchObject({ kind: 'upstream', status: 529 });
  });

  it('maps aborts and connection failures', () => {
    expect(toAnthropicError(new APIUserAbortError())).toMatchObject({ kind: 'timeout' });
    expect(toAnthropicError(new APIConnectionTimeoutError())).toMatchObject({ kind: 'timeout' });
    expect(toAnthropicError(new APIConnectionError({ message: 'ECONNRESET' }))).toMatchObject({
      kind: 'network',
    });
  });

  it('classifies unknown throws as upstream and passes LlmProviderError through', () => {
    const own = new LlmProviderError('bad_response', 'x');

    expect(toAnthropicError(new Error('???'))).toMatchObject({ kind: 'upstream' });
    expect(toAnthropicError(own)).toBe(own);
  });

  it('handles an APIError without a status as upstream', () => {
    const error = toAnthropicError(new APIError(undefined, undefined, 'no status', undefined));

    expect(error).toMatchObject({ kind: 'upstream', status: undefined });
    expect(error.message).toContain('status unknown');
  });

  it('never copies the provider message into the gateway error', () => {
    for (const status of [400, 401, 403, 404, 413, 422, 429, 500, 529]) {
      const error = toAnthropicError(apiError(status));

      expect(error.message).not.toContain('provider said no');
      expect(error.cause).toBeInstanceOf(APIError);
    }
  });
});
