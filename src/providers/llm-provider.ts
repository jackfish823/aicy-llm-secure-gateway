import { z } from 'zod';

/** Injection token for the active provider adapter. */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export const llmRoleSchema = z.enum(['user', 'assistant']);
export const llmMessageSchema = z.strictObject({
  role: llmRoleSchema,
  content: z.string(),
});
export const stopReasonSchema = z.enum(['end_turn', 'max_tokens', 'stop_sequence', 'other']);
export const tokenUsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

/** Model ids are interpolated into log lines; keep them short and printable. */
export const llmModelSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:@/-]+$/);

export const llmResponseSchema = z.strictObject({
  content: z.string(),
  model: llmModelSchema,
  stopReason: stopReasonSchema,
  usage: tokenUsageSchema,
});

export type LlmRole = z.output<typeof llmRoleSchema>;
export type LlmMessage = z.output<typeof llmMessageSchema>;
export type StopReason = z.output<typeof stopReasonSchema>;
export type TokenUsage = z.output<typeof tokenUsageSchema>;
export type LlmResponse = z.output<typeof llmResponseSchema>;

/**
 * Provider-neutral completion request. Built by LlmExecutor, consumed by adapters.
 * A plain interface rather than a schema because it is gateway-authored and never crosses a trust boundary; responses are schema-parsed because providers are untrusted.
 */
export interface LlmRequest {
  readonly model: string;
  readonly system?: string;
  readonly messages: readonly LlmMessage[];
  readonly maxTokens: number;
}

/** Self-identification for logs and outcomes. `'fake'` exists for tests only and is never selectable through configuration. */
export type LlmProviderName = 'anthropic' | 'openai' | 'fake';

export interface LlmCompletionOptions {
  /** Aborted by LlmExecutor when the configured timeout elapses. */
  signal: AbortSignal;
}

export interface LlmProvider {
  readonly name: LlmProviderName;
  complete(request: LlmRequest, options: LlmCompletionOptions): Promise<LlmResponse>;
}

/**
 * Advisory only: no retry layer exists yet. Unknown failures are classified `upstream` and
 * therefore count as retryable, so any future retry policy must cap attempts.
 */
export const LLM_PROVIDER_ERROR_KINDS = [
  'timeout',
  'rate_limited',
  'auth',
  'bad_request',
  'bad_response',
  'network',
  'upstream',
] as const;
export type LlmProviderErrorKind = (typeof LLM_PROVIDER_ERROR_KINDS)[number];

const RETRYABLE_KINDS: ReadonlySet<LlmProviderErrorKind> = new Set<LlmProviderErrorKind>([
  'timeout',
  'rate_limited',
  'network',
  'upstream',
]);

/**
 * Every provider failure the gateway reacts to. Messages must be gateway-authored and generic (this is a convention adapters follow, not something the class can enforce);
 * the provider's own error travels in `cause` and is never sent to clients.
 */
export class LlmProviderError extends Error {
  readonly kind: LlmProviderErrorKind;
  /** Whether a retry could plausibly succeed. See RETRYABLE_KINDS. */
  readonly retryable: boolean;
  readonly status: number | undefined;

  constructor(
    kind: LlmProviderErrorKind,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'LlmProviderError';
    this.kind = kind;
    this.retryable = RETRYABLE_KINDS.has(kind);
    this.status = options.status;
  }
}
