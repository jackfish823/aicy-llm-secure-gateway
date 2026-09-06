import {
  LlmProviderError,
  llmResponseSchema,
  type LlmCompletionOptions,
  type LlmProvider,
  type LlmProviderName,
  type LlmRequest,
  type LlmResponse,
} from '../llm-provider.js';

/** Asymmetric usage so a transposed field shows up in any test built on this helper. */
export function fakeResponse(request: LlmRequest, content = 'fake response'): LlmResponse {
  return {
    content,
    model: request.model,
    stopReason: 'end_turn',
    usage: { inputTokens: 3, outputTokens: 5 },
  };
}

/**
 * Scripted provider for tests. Replies from a queue (responses or errors), records a snapshot
 * of every request, and can delay so AbortSignal timeouts are exercised. Honours an aborted
 * signal like a real adapter (rejects with a `timeout` LlmProviderError). Never selectable
 * through configuration and excluded from the production build.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly name: LlmProviderName = 'fake';
  readonly calls: LlmRequest[] = [];
  private readonly queue: (LlmResponse | Error)[] = [];
  private delayMs = 0;

  /** Queue a reply. Responses are validated against the neutral contract; any Error is thrown as-is. */
  enqueue(item: LlmResponse | Error): this {
    this.queue.push(item instanceof Error ? item : llmResponseSchema.parse(item));
    return this;
  }

  /** Delay every subsequent call by `ms` so a caller's AbortSignal can fire first. Sticky until reset(). */
  delay(ms: number): this {
    this.delayMs = ms;
    return this;
  }

  reset(): void {
    this.queue.length = 0;
    this.calls.length = 0;
    this.delayMs = 0;
  }

  async complete(request: LlmRequest, options: LlmCompletionOptions): Promise<LlmResponse> {
    this.calls.push(structuredClone(request));
    await waitFor(this.delayMs, options.signal);
    const next = this.queue.shift() ?? fakeResponse(request);
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new LlmProviderError('timeout', 'fake provider aborted before replying'));
  }
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new LlmProviderError('timeout', 'fake provider aborted while replying'));
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
