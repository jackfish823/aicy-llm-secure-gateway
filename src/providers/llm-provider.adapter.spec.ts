import { describe, expect, it } from 'vitest';
import { LlmProviderAdapter } from './llm-provider.adapter.js';
import {
  LlmProviderError,
  type LlmProviderName,
  type LlmRequest,
  type LlmResponse,
} from './llm-provider.js';

const SENTINEL = 'SENTINEL-ADAPTER-OUTPUT';

interface Behaviour {
  sendResult?: unknown;
  failSend?: boolean;
  /** send rejects with an already-classified LlmProviderError. */
  typedSendError?: boolean;
  /** toProviderError itself throws. */
  failTranslate?: boolean;
  failParse?: 'plain' | 'typed';
  failConvertRequest?: boolean;
  failToLlmResponse?: boolean;
  /** toLlmResponse returns a contract-violating value (negative usage) carrying SENTINEL content. */
  badOutput?: boolean;
}

class TestAdapter extends LlmProviderAdapter<string, { text: string }> {
  readonly name: LlmProviderName = 'fake';
  readonly steps: string[] = [];

  constructor(private readonly behaviour: Behaviour = {}) {
    super();
  }

  protected toProviderRequest(request: LlmRequest): string {
    this.steps.push('toProviderRequest');
    if (this.behaviour.failConvertRequest === true) {
      throw new Error('cannot map request');
    }
    return request.messages.map((message) => message.content).join('\n');
  }

  protected send(request: string, signal: AbortSignal): Promise<unknown> {
    this.steps.push(`send:${request}:${String(signal.aborted)}`);
    if (this.behaviour.typedSendError === true) {
      return Promise.reject(new LlmProviderError('auth', 'typed send failure', { status: 401 }));
    }
    if (this.behaviour.failSend === true) {
      return Promise.reject(new Error('socket hang up'));
    }
    return Promise.resolve(this.behaviour.sendResult);
  }

  protected parseProviderResponse(raw: unknown): { text: string } {
    this.steps.push('parse');
    if (this.behaviour.failParse === 'plain') {
      throw new Error('not the shape I expected');
    }
    if (this.behaviour.failParse === 'typed') {
      throw new LlmProviderError('bad_response', 'typed parse failure');
    }
    return { text: typeof raw === 'string' ? raw : '' };
  }

  protected toLlmResponse(response: { text: string }): LlmResponse {
    this.steps.push('toLlmResponse');
    if (this.behaviour.failToLlmResponse === true) {
      throw new Error('cannot map response');
    }
    if (this.behaviour.badOutput === true) {
      return {
        content: SENTINEL,
        model: 'm',
        stopReason: 'end_turn',
        usage: { inputTokens: -1, outputTokens: 0 },
      };
    }
    return {
      content: response.text,
      model: 'm',
      stopReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  protected toProviderError(error: unknown): LlmProviderError {
    this.steps.push('toProviderError');
    if (this.behaviour.failTranslate === true) {
      throw new Error('translator bug');
    }
    return new LlmProviderError('upstream', 'translated', { cause: error });
  }
}

const request: LlmRequest = {
  model: 'm',
  messages: [{ role: 'user', content: 'hello' }],
  maxTokens: 16,
};
const options = { signal: new AbortController().signal };

async function failureOf(adapter: TestAdapter): Promise<LlmProviderError> {
  try {
    await adapter.complete(request, options);
  } catch (error: unknown) {
    if (error instanceof LlmProviderError) {
      return error;
    }
    throw new Error('expected an LlmProviderError', { cause: error });
  }
  throw new Error('expected complete() to reject');
}

describe('LlmProviderAdapter', () => {
  it('runs convert → send → parse → convert → validate in order and returns the validated response', async () => {
    const adapter = new TestAdapter({ sendResult: 'reply' });

    const response = await adapter.complete(request, options);

    expect(response).toEqual({
      content: 'reply',
      model: 'm',
      stopReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    expect(adapter.steps).toEqual([
      'toProviderRequest',
      'send:hello:false',
      'parse',
      'toLlmResponse',
    ]);
  });

  it('routes untyped send failures through toProviderError', async () => {
    const adapter = new TestAdapter({ failSend: true });

    const error = await failureOf(adapter);

    expect(error).toMatchObject({ kind: 'upstream', message: 'translated' });
    expect(error.cause).toBeInstanceOf(Error);
    expect(adapter.steps).toContain('toProviderError');
    expect(adapter.steps).not.toContain('parse');
  });

  it('lets an already-classified send error pass through untouched', async () => {
    const adapter = new TestAdapter({ typedSendError: true });

    const error = await failureOf(adapter);

    expect(error).toMatchObject({ kind: 'auth', status: 401, retryable: false });
    expect(adapter.steps).not.toContain('toProviderError');
  });

  it('keeps the original failure when toProviderError itself throws', async () => {
    const adapter = new TestAdapter({ failSend: true, failTranslate: true });

    const error = await failureOf(adapter);

    expect(error.kind).toBe('upstream');
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause).toMatchObject({ message: 'socket hang up' });
  });

  it('wraps untyped parse failures as non-retryable bad_response with the cause attached', async () => {
    const adapter = new TestAdapter({ sendResult: 'x', failParse: 'plain' });

    const error = await failureOf(adapter);

    expect(error).toMatchObject({ kind: 'bad_response', retryable: false });
    expect(error.cause).toMatchObject({ message: 'not the shape I expected' });
    expect(adapter.steps).not.toContain('toProviderError');
  });

  it('passes typed parse failures through unchanged', async () => {
    const adapter = new TestAdapter({ sendResult: 'x', failParse: 'typed' });

    await expect(adapter.complete(request, options)).rejects.toMatchObject({
      kind: 'bad_response',
      message: 'typed parse failure',
    });
  });

  it('classifies a request-mapping failure as non-retryable bad_request and never sends', async () => {
    const adapter = new TestAdapter({ failConvertRequest: true });

    const error = await failureOf(adapter);

    expect(error).toMatchObject({ kind: 'bad_request', retryable: false });
    expect(adapter.steps).toEqual(['toProviderRequest']);
  });

  it('classifies a response-mapping failure as non-retryable bad_response', async () => {
    const adapter = new TestAdapter({ sendResult: 'x', failToLlmResponse: true });

    const error = await failureOf(adapter);

    expect(error).toMatchObject({ kind: 'bad_response', retryable: false });
    expect(adapter.steps).toContain('toLlmResponse');
  });

  it('rejects contract-violating adapter output without echoing it in the cause', async () => {
    const adapter = new TestAdapter({ sendResult: 'x', badOutput: true });

    const error = await failureOf(adapter);

    expect(error).toMatchObject({ kind: 'bad_response', retryable: false });
    expect(adapter.steps).toContain('toLlmResponse');
    expect(JSON.stringify(error.cause)).not.toContain(SENTINEL);
    expect(error.message).not.toContain(SENTINEL);
  });
});
