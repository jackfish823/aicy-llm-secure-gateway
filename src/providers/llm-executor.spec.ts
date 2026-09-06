import { describe, expect, it } from 'vitest';
import type { ChatRequest } from '../chat/chat.schemas.js';
import { createRequestContext } from '../common/context/request-context.js';
import { RequestContextService } from '../common/context/request-context.service.js';
import type { LlmConfig } from '../config/domains/llm.config.js';
import { FakeLlmProvider, fakeResponse } from './fake/fake.provider.js';
import { LlmExecutor } from './llm-executor.js';
import { LlmProviderError, type LlmProvider, type LlmResponse } from './llm-provider.js';

const config: LlmConfig = {
  provider: 'anthropic',
  model: 'claude-opus-5',
  apiKey: 'placeholder',
  timeoutMs: 1000,
  baseUrl: undefined,
  maxOutputTokens: 1024,
};

const request: ChatRequest = { messages: [{ role: 'user', content: 'hello' }] };

function build(provider: LlmProvider, overrides: Partial<LlmConfig> = {}) {
  const contextService = new RequestContextService();
  const executor = new LlmExecutor(provider, { ...config, ...overrides }, contextService);
  return { executor, contextService };
}

describe('LlmExecutor', () => {
  it('builds the provider request from config defaults', async () => {
    const fake = new FakeLlmProvider();
    const { executor } = build(fake);

    await executor.complete(request);

    expect(fake.calls[0]).toEqual({
      model: 'claude-opus-5',
      messages: request.messages,
      maxTokens: 1024,
      system: undefined,
    });
  });

  it('lets the request override maxTokens and pass system', async () => {
    const fake = new FakeLlmProvider();
    const { executor } = build(fake);

    await executor.complete({ ...request, maxTokens: 5, system: 'terse' });

    expect(fake.calls[0]).toMatchObject({ maxTokens: 5, system: 'terse' });
  });

  it('records a successful exec outcome in the request context', async () => {
    const fake = new FakeLlmProvider().enqueue({
      content: 'hi',
      model: 'claude-opus-5',
      stopReason: 'end_turn',
      usage: { inputTokens: 7, outputTokens: 2 },
    });
    const { executor, contextService } = build(fake);
    const context = createRequestContext();

    const response = await contextService.run(context, () => executor.complete(request));

    expect(response).toEqual({
      content: 'hi',
      model: 'claude-opus-5',
      stopReason: 'end_turn',
      usage: { inputTokens: 7, outputTokens: 2 },
    });
    expect(context.exec).toMatchObject({
      provider: 'fake',
      model: 'claude-opus-5',
      usage: { inputTokens: 7, outputTokens: 2 },
    });
    expect(context.exec?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(context.exec?.errorKind).toBeUndefined();
  });

  it('turns an exceeded timeout into a timeout error and records it', async () => {
    const fake = new FakeLlmProvider().delay(500);
    const { executor, contextService } = build(fake, { timeoutMs: 20 });
    const context = createRequestContext();

    await expect(
      contextService.run(context, () => executor.complete(request)),
    ).rejects.toMatchObject({ kind: 'timeout' });
    expect(context.exec?.errorKind).toBe('timeout');
  });

  it('rethrows provider errors unchanged and records their kind', async () => {
    const failure = new LlmProviderError('rate_limited', 'slow down', { status: 429 });
    const fake = new FakeLlmProvider().enqueue(failure);
    const { executor, contextService } = build(fake);
    const context = createRequestContext();

    await expect(contextService.run(context, () => executor.complete(request))).rejects.toBe(
      failure,
    );
    expect(context.exec?.errorKind).toBe('rate_limited');
  });

  it('classifies unknown provider throws as upstream and records them', async () => {
    const broken: LlmProvider = {
      name: 'fake',
      complete: () => Promise.reject(new Error('kaboom')),
    };
    const { executor, contextService } = build(broken);
    const context = createRequestContext();

    await expect(
      contextService.run(context, () => executor.complete(request)),
    ).rejects.toMatchObject({ kind: 'upstream' });
    expect(context.exec).toMatchObject({
      provider: 'fake',
      model: 'claude-opus-5',
      errorKind: 'upstream',
    });
  });

  it('classifies a plain rejection after the deadline as a timeout', async () => {
    const rude: LlmProvider = {
      name: 'fake',
      complete: (_llmRequest, { signal }) =>
        new Promise<LlmResponse>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new Error('socket closed'));
            },
            { once: true },
          );
        }),
    };
    const { executor, contextService } = build(rude, { timeoutMs: 20 });
    const context = createRequestContext();

    await expect(
      contextService.run(context, () => executor.complete(request)),
    ).rejects.toMatchObject({ kind: 'timeout' });
    expect(context.exec?.errorKind).toBe('timeout');
  });

  it('enforces the deadline even when the provider ignores the signal entirely', async () => {
    const hanging: LlmProvider = {
      name: 'fake',
      complete: () => new Promise<LlmResponse>(() => undefined),
    };
    const { executor, contextService } = build(hanging, { timeoutMs: 20 });
    const context = createRequestContext();

    await expect(
      contextService.run(context, () => executor.complete(request)),
    ).rejects.toMatchObject({ kind: 'timeout' });
    expect(context.exec?.errorKind).toBe('timeout');
  });

  it('works without a request context (outcome simply not recorded)', async () => {
    const fake = new FakeLlmProvider().enqueue(
      fakeResponse({ ...request, model: 'x', maxTokens: 1 }),
    );
    const { executor } = build(fake);

    const response: LlmResponse = await executor.complete(request);

    expect(response.content).toBe('fake response');
  });
});
