import { describe, expect, it } from 'vitest';
import { MAX_OUTPUT_TOKENS } from '../config/domains/llm.config.js';
import {
  chatRequestSchema,
  chatResponseSchema,
  MAX_CONTENT_CHARS,
  MAX_MESSAGES,
} from './chat.schemas.js';

const minimal = { messages: [{ role: 'user', content: 'hi' }] };

function issuesOf(input: unknown): string {
  const result = chatRequestSchema.safeParse(input);
  return result.success ? '' : JSON.stringify(result.error.issues);
}

describe('chatRequestSchema', () => {
  it('accepts a minimal request', () => {
    expect(chatRequestSchema.parse(minimal)).toEqual(minimal);
  });

  it('accepts the optional fields', () => {
    const full = { ...minimal, system: 'be terse', maxTokens: 256 };

    expect(chatRequestSchema.parse(full)).toEqual(full);
  });

  it('rejects an empty message list', () => {
    expect(chatRequestSchema.safeParse({ messages: [] }).success).toBe(false);
  });

  it('rejects a conversation that does not start with the user', () => {
    const result = chatRequestSchema.safeParse({
      messages: [{ role: 'assistant', content: 'hello' }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['messages', 0, 'role']);
    }
  });

  it('rejects unknown roles and unknown top-level keys', () => {
    expect(issuesOf({ messages: [{ role: 'system', content: 'x' }] })).toContain('role');
    expect(issuesOf({ ...minimal, model: 'claude-opus-5' })).toContain('model');
  });

  it('rejects oversize content and too many messages', () => {
    expect(
      chatRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'x'.repeat(MAX_CONTENT_CHARS + 1) }],
      }).success,
    ).toBe(false);
    const messages = Array.from({ length: MAX_MESSAGES + 1 }, () => ({
      role: 'user',
      content: 'x',
    }));
    expect(chatRequestSchema.safeParse({ messages }).success).toBe(false);
  });

  it('rejects non-integer maxTokens and the removed temperature key', () => {
    expect(chatRequestSchema.safeParse({ ...minimal, maxTokens: 10.5 }).success).toBe(false);
    expect(issuesOf({ ...minimal, temperature: 0.5 })).toContain('unrecognized key');
  });

  it('rejects a nested unknown key, empty content, and an empty system prompt', () => {
    expect(
      chatRequestSchema.safeParse({ messages: [{ role: 'user', content: 'x', extra: 1 }] }).success,
    ).toBe(false);
    expect(chatRequestSchema.safeParse({ messages: [{ role: 'user', content: '' }] }).success).toBe(
      false,
    );
    expect(chatRequestSchema.safeParse({ ...minimal, system: '' }).success).toBe(false);
  });

  it('bounds maxTokens on both sides', () => {
    expect(chatRequestSchema.safeParse({ ...minimal, maxTokens: 0 }).success).toBe(false);
    expect(
      chatRequestSchema.safeParse({ ...minimal, maxTokens: MAX_OUTPUT_TOKENS + 1 }).success,
    ).toBe(false);
  });

  it('accepts values exactly at the limits', () => {
    const atLimit = {
      messages: Array.from({ length: MAX_MESSAGES }, (_, index) => ({
        role: index === 0 ? 'user' : 'assistant',
        content: 'x'.repeat(MAX_CONTENT_CHARS),
      })),
      system: 's',
      maxTokens: MAX_OUTPUT_TOKENS,
    };

    expect(chatRequestSchema.safeParse(atLimit).success).toBe(true);
  });

  it('never echoes caller-controlled text in issue messages', () => {
    const sentinel = 'SENTINEL-DO-NOT-ECHO';
    const issueMessages = (input: unknown): string => {
      const result = chatRequestSchema.safeParse(input);
      return result.success
        ? ''
        : JSON.stringify(result.error.issues.map((issue) => issue.message));
    };

    expect(issueMessages({ ...minimal, [sentinel]: 1 })).not.toContain(sentinel);
    expect(
      issueMessages({ messages: [{ role: 'user', content: 'x', [sentinel]: 1 }] }),
    ).not.toContain(sentinel);
    expect(issueMessages({ messages: [{ role: sentinel, content: 'x' }] })).not.toContain(sentinel);
    expect(
      issueMessages({ messages: [{ role: 'user', content: sentinel.repeat(2000) }] }),
    ).not.toContain(sentinel);
  });
});

describe('chatResponseSchema', () => {
  it('round-trips a response', () => {
    const response = {
      requestId: 'r1',
      content: 'hello',
      model: 'claude-opus-5',
      stopReason: 'end_turn',
      usage: { inputTokens: 2, outputTokens: 1 },
    };

    expect(chatResponseSchema.parse(response)).toEqual(response);
  });
});
