import { describe, expect, it } from 'vitest';
import {
  LLM_PROVIDER_ERROR_KINDS,
  LlmProviderError,
  llmResponseSchema,
  type LlmProviderErrorKind,
} from './llm-provider.js';

describe('LlmProviderError', () => {
  const transient: LlmProviderErrorKind[] = ['timeout', 'rate_limited', 'network', 'upstream'];
  const permanent = LLM_PROVIDER_ERROR_KINDS.filter((kind) => !transient.includes(kind));

  it('partitions every kind into transient or permanent', () => {
    expect(transient.length + permanent.length).toBe(LLM_PROVIDER_ERROR_KINDS.length);
    expect(permanent).toEqual(['auth', 'bad_request', 'bad_response']);
  });

  it('marks transient kinds retryable', () => {
    for (const kind of transient) {
      expect(new LlmProviderError(kind, 'x').retryable).toBe(true);
    }
  });

  it('marks permanent kinds non-retryable', () => {
    for (const kind of permanent) {
      expect(new LlmProviderError(kind, 'x').retryable).toBe(false);
    }
  });

  it('keeps kind, status, cause and a stable name', () => {
    const cause = new Error('boom');
    const error = new LlmProviderError('upstream', 'failed', { status: 503, cause });

    expect(error.kind).toBe('upstream');
    expect(error.status).toBe(503);
    expect(error.cause).toBe(cause);
    expect(error.name).toBe('LlmProviderError');
    expect(error).toBeInstanceOf(Error);
    expect(new LlmProviderError('auth', 'x').status).toBeUndefined();
  });
});

describe('llmResponseSchema', () => {
  const valid = {
    content: 'hi',
    model: 'claude-opus-5',
    stopReason: 'end_turn',
    usage: { inputTokens: 3, outputTokens: 1 },
  };

  it('accepts a well-formed response', () => {
    expect(llmResponseSchema.parse(valid)).toEqual(valid);
  });

  it('rejects negative usage and unknown stop reasons', () => {
    expect(llmResponseSchema.safeParse({ ...valid, stopReason: 'banana' }).success).toBe(false);
    expect(
      llmResponseSchema.safeParse({ ...valid, usage: { inputTokens: -1, outputTokens: 0 } })
        .success,
    ).toBe(false);
  });

  it('rejects fractional usage, unknown keys and an empty model', () => {
    expect(
      llmResponseSchema.safeParse({ ...valid, usage: { inputTokens: 1.5, outputTokens: 0 } })
        .success,
    ).toBe(false);
    expect(llmResponseSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(llmResponseSchema.safeParse({ ...valid, model: '' }).success).toBe(false);
  });

  it('rejects model ids with control characters or excessive length', () => {
    expect(llmResponseSchema.safeParse({ ...valid, model: 'claude\r\nforged' }).success).toBe(
      false,
    );
    expect(llmResponseSchema.safeParse({ ...valid, model: 'x'.repeat(129) }).success).toBe(false);
    expect(llmResponseSchema.safeParse({ ...valid, model: 'ft:gpt-4o:org::id/v2' }).success).toBe(
      true,
    );
  });
});
