import { APIError } from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { LlmRequest } from '../llm-provider.js';
import type { AnthropicMessagesClient } from './anthropic.client.js';
import { AnthropicProvider } from './anthropic.provider.js';

const request: LlmRequest = {
  model: 'claude-opus-5',
  messages: [{ role: 'user', content: 'hello' }],
  maxTokens: 16,
};
const rawMessage = {
  model: 'claude-opus-5',
  content: [{ type: 'text', text: 'Hi there' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 4, output_tokens: 2 },
};

function stubClient() {
  const create = vi.fn<AnthropicMessagesClient['messages']['create']>();
  const client: AnthropicMessagesClient = { messages: { create } };
  return { create, client };
}

describe('AnthropicProvider', () => {
  it('sends the converted request with the abort signal and converts the reply', async () => {
    const { create, client } = stubClient();
    create.mockResolvedValue(rawMessage);
    const signal = new AbortController().signal;

    const response = await new AnthropicProvider(client).complete(request, { signal });

    expect(create).toHaveBeenCalledWith(
      { model: 'claude-opus-5', max_tokens: 16, messages: [{ role: 'user', content: 'hello' }] },
      { signal },
    );
    expect(response).toEqual({
      content: 'Hi there',
      model: 'claude-opus-5',
      stopReason: 'end_turn',
      usage: { inputTokens: 4, outputTokens: 2 },
    });
  });

  it('translates SDK errors', async () => {
    const { create, client } = stubClient();
    create.mockRejectedValue(new APIError(429, undefined, 'slow down', new Headers()));

    await expect(
      new AnthropicProvider(client).complete(request, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ kind: 'rate_limited', status: 429 });
  });

  it('rejects malformed replies as bad_response', async () => {
    const { create, client } = stubClient();
    create.mockResolvedValue({ unexpected: true });

    await expect(
      new AnthropicProvider(client).complete(request, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ kind: 'bad_response' });
  });

  it('rejects a reply whose model id could forge log lines', async () => {
    const { create, client } = stubClient();
    create.mockResolvedValue({ ...rawMessage, model: 'claude\r\n[forged] line' });

    await expect(
      new AnthropicProvider(client).complete(request, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ kind: 'bad_response' });
  });
});
