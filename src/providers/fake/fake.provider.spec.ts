import { describe, expect, it } from 'vitest';
import { LlmProviderError, type LlmRequest } from '../llm-provider.js';
import { FakeLlmProvider, fakeResponse } from './fake.provider.js';

const request: LlmRequest = {
  model: 'claude-opus-5',
  messages: [{ role: 'user', content: 'hello' }],
  maxTokens: 16,
};
const signal = new AbortController().signal;

describe('FakeLlmProvider', () => {
  it('replies with a default response echoing the model and records the call', async () => {
    const fake = new FakeLlmProvider();

    const response = await fake.complete(request, { signal });

    expect(response).toEqual(fakeResponse(request));
    expect(response.model).toBe('claude-opus-5');
    expect(fake.calls).toEqual([request]);
  });

  it('serves queued responses and errors in order', async () => {
    const fake = new FakeLlmProvider()
      .enqueue(fakeResponse(request, 'first'))
      .enqueue(new LlmProviderError('rate_limited', 'slow down', { status: 429 }));

    await expect(fake.complete(request, { signal })).resolves.toMatchObject({ content: 'first' });
    await expect(fake.complete(request, { signal })).rejects.toMatchObject({
      kind: 'rate_limited',
    });
    await expect(fake.complete(request, { signal })).resolves.toMatchObject({
      content: 'fake response',
    });
  });

  it('reset() clears the queue and the call log', async () => {
    const fake = new FakeLlmProvider().enqueue(fakeResponse(request, 'queued'));
    await fake.complete(request, { signal });

    fake.reset();

    expect(fake.calls).toEqual([]);
    await expect(fake.complete(request, { signal })).resolves.toMatchObject({
      content: 'fake response',
    });
  });

  it('delay() waits and rejects with a timeout error when the signal aborts', async () => {
    const fake = new FakeLlmProvider().delay(50);
    const controller = new AbortController();

    const pending = fake.complete(request, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('delay() resolves normally when not aborted', async () => {
    const fake = new FakeLlmProvider().delay(1);

    await expect(fake.complete(request, { signal })).resolves.toMatchObject({
      content: 'fake response',
    });
  });

  it('rejects immediately when the signal is already aborted, even with no delay', async () => {
    const fake = new FakeLlmProvider();
    const controller = new AbortController();
    controller.abort();

    await expect(fake.complete(request, { signal: controller.signal })).rejects.toMatchObject({
      kind: 'timeout',
    });
    expect(fake.calls).toHaveLength(1);
  });

  it('applies delay() to every subsequent call until reset() clears it', async () => {
    const fake = new FakeLlmProvider().delay(30);

    for (let call = 0; call < 2; call += 1) {
      const controller = new AbortController();
      const pending = fake.complete(request, { signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    }

    fake.reset();
    const controller = new AbortController();
    const pending = fake.complete(request, { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ content: 'fake response' });
  });

  it('records a snapshot of the request, not a live reference', async () => {
    const fake = new FakeLlmProvider();
    const mutable: LlmRequest = { ...request, messages: [{ role: 'user', content: 'original' }] };

    await fake.complete(mutable, { signal });
    const first = mutable.messages[0];
    if (first !== undefined) {
      first.content = 'mutated';
    }

    expect(fake.calls[0]?.messages[0]?.content).toBe('original');
  });

  it('throws a queued plain Error as-is and validates queued responses', async () => {
    const fake = new FakeLlmProvider().enqueue(new Error('kaboom'));

    await expect(fake.complete(request, { signal })).rejects.toThrow('kaboom');
    expect(() => new FakeLlmProvider().enqueue({ ...fakeResponse(request), model: '' })).toThrow();
  });
});
