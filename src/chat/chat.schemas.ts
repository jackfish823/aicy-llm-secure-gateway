import { z } from 'zod';
import { MAX_OUTPUT_TOKENS } from '../config/domains/llm.config.js';
import {
  llmModelSchema,
  llmRoleSchema,
  stopReasonSchema,
  tokenUsageSchema,
} from '../providers/llm-provider.js';

export const MAX_MESSAGES = 64;
export const MAX_CONTENT_CHARS = 32_000;

/** Zod's default unrecognized-key message echoes the caller-chosen key; keep it static. */
const objectParams = {
  error: (issue: z.core.$ZodRawIssue): string | undefined =>
    issue.code === 'unrecognized_keys' ? 'unrecognized key' : undefined,
};

export const chatMessageSchema = z.strictObject(
  {
    role: llmRoleSchema,
    content: z.string().min(1).max(MAX_CONTENT_CHARS),
  },
  objectParams,
);

/**
 * Gateway-owned contract for POST /v1/chat. Strict: unknown keys are rejected so callers
 * cannot smuggle provider-specific parameters. The model is never caller-chosen.
 */
export const chatRequestSchema = z.strictObject(
  {
    messages: z
      .array(chatMessageSchema)
      .min(1)
      .max(MAX_MESSAGES)
      .refine((messages) => messages[0]?.role === 'user', {
        error: 'first message must have role "user"',
        path: [0, 'role'],
      }),
    system: z.string().min(1).max(MAX_CONTENT_CHARS).optional(),
    maxTokens: z.number().int().min(1).max(MAX_OUTPUT_TOKENS).optional(),
  },
  objectParams,
);

export const chatResponseSchema = z.strictObject({
  requestId: z.string(),
  content: z.string(),
  model: llmModelSchema,
  stopReason: stopReasonSchema,
  usage: tokenUsageSchema,
});

export type ChatMessage = z.output<typeof chatMessageSchema>;
export type ChatRequest = z.output<typeof chatRequestSchema>;
export type ChatResponse = z.output<typeof chatResponseSchema>;
