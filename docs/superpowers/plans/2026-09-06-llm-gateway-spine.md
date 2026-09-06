# LLM Gateway Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `POST /v1/chat` end-to-end through a request context, an ordered security-stage pipeline (empty for now), a provider port with an enforced conversion base class, an Anthropic adapter, and a fake adapter for tests.

**Architecture:** `RequestContextMiddleware` (AsyncLocalStorage) → Nest 12 `StandardSchemaValidationPipe` with a Zod body schema → `ChatService` → `GatewayPipeline` (inbound stages → `LlmExecutor` → outbound stages, every verdict recorded into the context) → provider adapter (`LlmProviderAdapter` template: convert → send → parse → convert, errors normalised to `LlmProviderError`). One `@Catch` filter maps provider/pipeline failures to 502/504/500; inbound blocks are 400, outbound blocks 502.

**Tech Stack:** NestJS 12 (ESM, `nodenext`), TypeScript ~6.0, Zod 4, Vitest 4, `@anthropic-ai/sdk` ^0.124, `@nestjs/config` 12 (already wired).

**Spec:** `docs/superpowers/specs/2026-09-06-llm-gateway-spine-design.md`

**Repository rules that override the generic process:**

- **No git write operations by the agent.** The repository owner commits. Where a generic plan would say "commit", this plan says **Checkpoint**: run the listed verification and stop; do not run `git add`/`git commit`.
- Never read, grep, or reference `test/fixtures/corpus/` (CLAUDE.md hard rule 1). Nothing in this plan needs it.
- `.env.example` cannot be written by the agent (permission deny rule). Task 1 hands the owner a one-line append.
- Lint is strict: no `any`, no `as` (except none needed here), no `!`, arrow functions returning `void` calls must use block bodies (`() => { fn(); }`), async functions must contain an `await`.
- All imports of local files use the `.js` extension (ESM + `nodenext`).

**Amendments made during execution (supersede the code blocks below where they differ)**

- `temperature` was removed from the chat contract, `LlmRequest`, the executor mapping and the
  Anthropic codec after Task 10: the SDK documents that models after Claude Opus 4.6 reject any
  value but 1.0 with a 400. Ignore `temperature` wherever a code block still shows it.
- `createAnthropicClient` pins `logLevel: 'off'` and an explicit `baseURL` (see spec §5.4).
- `src/pipeline/pipeline.module.spec.ts` boots `PipelineModule` on the validated config.

**Conventions used below**

- Run a single spec: `pnpm vitest run <path>`; the whole suite: `pnpm test`.
- Every checkpoint: `pnpm lint && pnpm typecheck && pnpm test`.
- Test fixtures come from `src/config/env.fixture.ts` (`validEnv`, `stubEnv`, `captureError`).

---

## File map

| Path | Responsibility |
| --- | --- |
| `src/config/domains/llm.config.ts` (modify) | adds `LLM_MAX_OUTPUT_TOKENS` → `LlmConfig.maxOutputTokens` |
| `src/providers/llm-provider.ts` | provider port: message/response schemas, `LlmRequest`, `LlmProvider`, `LLM_PROVIDER` token, `LlmProviderError` |
| `src/providers/llm-provider.adapter.ts` | `LlmProviderAdapter` template base class enforcing conversions |
| `src/providers/fake/fake.provider.ts` | `FakeLlmProvider` for tests |
| `src/providers/llm-executor.ts` | `LlmExecutor`: `ChatRequest` → `LlmRequest`, timeout, `ExecOutcome` |
| `src/providers/anthropic/anthropic.codec.ts` | pure conversions + response schema + error table |
| `src/providers/anthropic/anthropic.client.ts` | minimal client interface + SDK client factory |
| `src/providers/anthropic/anthropic.provider.ts` | `AnthropicProvider` adapter (wiring only) |
| `src/providers/llm-provider.factory.ts` | `createLlmProvider(config)` selects the adapter |
| `src/providers/providers.module.ts` | provides `LLM_PROVIDER` + `LlmExecutor` |
| `src/common/context/request-context.ts` | context types, `createRequestContext`, `elapsedMs` |
| `src/common/context/request-context.service.ts` | AsyncLocalStorage wrapper |
| `src/common/context/request-context.middleware.ts` | per-request context + `x-request-id` header |
| `src/common/context/request-context.module.ts` | global module |
| `src/pipeline/stage.ts` | stage interfaces, verdict type, tokens |
| `src/pipeline/pipeline.errors.ts` | `PipelineStageError` |
| `src/pipeline/gateway-pipeline.ts` | runner |
| `src/pipeline/pipeline.module.ts` | stage order lists, `GatewayPipeline` provider |
| `src/chat/chat.schemas.ts` | `ChatRequest` / `ChatResponse` Zod contract |
| `src/chat/chat.exceptions.ts` | `RequestBlockedException` |
| `src/chat/gateway-exception.filter.ts` | maps `LlmProviderError` / `PipelineStageError` to HTTP |
| `src/chat/chat.service.ts`, `chat.controller.ts`, `chat.module.ts` | HTTP surface |
| `src/app.module.ts` (modify) | middleware, global pipe, module imports |
| `test/chat.e2e.spec.ts` | end-to-end against `FakeLlmProvider` |
| `README.md` (modify) | API section, env row, limitations |

---

### Task 1: `LLM_MAX_OUTPUT_TOKENS` config

**Files:**
- Modify: `src/config/domains/llm.config.ts`
- Modify: `src/config/domains/llm.config.spec.ts`
- Modify: `README.md` (env table)

- [ ] **Step 1: Extend the existing expectation and add failing tests**

In `src/config/domains/llm.config.spec.ts`, change the first test's expected object to include the new field and append two tests inside the `describe('llm config', ...)` block:

```ts
  it('builds anthropic config with the anthropic key and default timeout', () => {
    expect(llmConfigFromEnv(anthropic)).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5',
      apiKey: 'placeholder-anthropic-key',
      timeoutMs: 30_000,
      baseUrl: undefined,
      maxOutputTokens: 1024,
    });
  });
```

```ts
  it('defaults LLM_MAX_OUTPUT_TOKENS to 1024 and coerces overrides', () => {
    expect(llmConfigFromEnv(anthropic).maxOutputTokens).toBe(1024);
    expect(llmConfigFromEnv({ ...anthropic, LLM_MAX_OUTPUT_TOKENS: '4096' }).maxOutputTokens).toBe(
      4096,
    );
  });

  it('rejects a non-positive LLM_MAX_OUTPUT_TOKENS', () => {
    expect(() => llmConfigFromEnv({ ...anthropic, LLM_MAX_OUTPUT_TOKENS: '0' })).toThrow(
      /LLM_MAX_OUTPUT_TOKENS/,
    );
  });
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm vitest run src/config/domains/llm.config.spec.ts`
Expected: FAIL — `maxOutputTokens` is `undefined` (2 failing tests, the `'0'` case passes for the wrong reason until the field exists; that is fine).

- [ ] **Step 3: Implement**

In `src/config/domains/llm.config.ts`:

Add to `llmEnvShape` after `LLM_TIMEOUT_MS`:

```ts
  /** Default `max_tokens` when the caller does not set one. Anthropic requires the field. */
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1024),
```

Add to `LlmConfig`:

```ts
  /** Default output token cap per completion; callers may lower or raise it up to the contract cap. */
  maxOutputTokens: number;
```

Add to the object returned by `toLlmConfig`:

```ts
    maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `pnpm vitest run src/config/domains/llm.config.spec.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Document**

README env table: add the row after `LLM_TIMEOUT_MS`:

```
| `LLM_MAX_OUTPUT_TOKENS` | no                            | `1024`        | Default `max_tokens` per completion; request `maxTokens` overrides   |
```

Hand the owner this append for `.env.example` (agent cannot write that file):

```bash
printf '\n# Default max_tokens per completion (request maxTokens overrides)\nLLM_MAX_OUTPUT_TOKENS=1024\n' >> .env.example
```

- [ ] **Step 6: Checkpoint**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all green. Stop here for the owner to commit.

---

### Task 2: Provider port

**Files:**
- Create: `src/providers/llm-provider.ts`
- Test: `src/providers/llm-provider.spec.ts`

- [ ] **Step 1: Write the failing test**

`src/providers/llm-provider.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LlmProviderError, llmResponseSchema, type LlmProviderErrorKind } from './llm-provider.js';

describe('LlmProviderError', () => {
  it('marks transient kinds retryable', () => {
    const transient: LlmProviderErrorKind[] = ['timeout', 'rate_limited', 'network', 'upstream'];
    for (const kind of transient) {
      expect(new LlmProviderError(kind, 'x').retryable).toBe(true);
    }
  });

  it('marks permanent kinds non-retryable', () => {
    const permanent: LlmProviderErrorKind[] = ['auth', 'bad_request', 'bad_response'];
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
      llmResponseSchema.safeParse({ ...valid, usage: { inputTokens: -1, outputTokens: 0 } }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm vitest run src/providers/llm-provider.spec.ts`
Expected: FAIL — `Cannot find module './llm-provider.js'`.

- [ ] **Step 3: Implement**

`src/providers/llm-provider.ts`:

```ts
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
export const llmResponseSchema = z.strictObject({
  content: z.string(),
  model: z.string().min(1),
  stopReason: stopReasonSchema,
  usage: tokenUsageSchema,
});

export type LlmRole = z.output<typeof llmRoleSchema>;
export type LlmMessage = z.output<typeof llmMessageSchema>;
export type StopReason = z.output<typeof stopReasonSchema>;
export type TokenUsage = z.output<typeof tokenUsageSchema>;
export type LlmResponse = z.output<typeof llmResponseSchema>;

/** Provider-neutral completion request. Built by LlmExecutor, consumed by adapters. */
export interface LlmRequest {
  readonly model: string;
  readonly system?: string;
  readonly messages: readonly LlmMessage[];
  readonly maxTokens: number;
  readonly temperature?: number;
}

export type LlmProviderName = 'anthropic' | 'openai' | 'fake';

export interface LlmCompletionOptions {
  /** Aborted by LlmExecutor when the configured timeout elapses. */
  signal: AbortSignal;
}

export interface LlmProvider {
  readonly name: LlmProviderName;
  complete(request: LlmRequest, options: LlmCompletionOptions): Promise<LlmResponse>;
}

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
 * Every provider failure the gateway reacts to. Messages are gateway-authored and generic;
 * the provider's own error travels in `cause` and is never sent to clients.
 */
export class LlmProviderError extends Error {
  readonly kind: LlmProviderErrorKind;
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
```

Note: `as const` is permitted by the lint config (`consistent-type-assertions: never` exempts it; `src/config/domains/app.config.ts` already uses it).

- [ ] **Step 4: Run the spec to verify it passes**

Run: `pnpm vitest run src/providers/llm-provider.spec.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: green.

---

### Task 3: Request context types and service

**Files:**
- Create: `src/common/context/request-context.ts`
- Create: `src/common/context/request-context.service.ts`
- Test: `src/common/context/request-context.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`src/common/context/request-context.service.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRequestContext, elapsedMs } from './request-context.js';
import { RequestContextMissingError, RequestContextService } from './request-context.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('createRequestContext', () => {
  it('generates a unique id and starts with no outcomes', () => {
    const first = createRequestContext();
    const second = createRequestContext();

    expect(first.requestId).toMatch(UUID);
    expect(first.requestId).not.toBe(second.requestId);
    expect(first.stages).toEqual([]);
    expect(first.exec).toBeUndefined();
    expect(elapsedMs(first.startedAt)).toBeGreaterThanOrEqual(0);
  });
});

describe('RequestContextService', () => {
  it('exposes the context inside run()', () => {
    const service = new RequestContextService();
    const context = createRequestContext();

    const seen = service.run(context, () => service.get());

    expect(seen).toBe(context);
    expect(service.run(context, () => service.tryGet())).toBe(context);
  });

  it('throws outside run()', () => {
    const service = new RequestContextService();

    expect(() => service.get()).toThrow(RequestContextMissingError);
    expect(service.tryGet()).toBeUndefined();
  });

  it('isolates concurrent flows', async () => {
    const service = new RequestContextService();
    const first = createRequestContext();
    const second = createRequestContext();

    const [seenFirst, seenSecond] = await Promise.all([
      service.run(first, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return service.get().requestId;
      }),
      service.run(second, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return service.get().requestId;
      }),
    ]);

    expect(seenFirst).toBe(first.requestId);
    expect(seenSecond).toBe(second.requestId);
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm vitest run src/common/context/request-context.service.spec.ts`
Expected: FAIL — `Cannot find module './request-context.js'`.

- [ ] **Step 3: Implement the types**

`src/common/context/request-context.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { LlmProviderErrorKind, TokenUsage } from '../../providers/llm-provider.js';

/** Identity of a rule that fired. Detectors return these, never booleans (CLAUDE.md). */
export interface Finding {
  readonly ruleId: string;
  readonly category: string;
  /** Raw matched span from the caller's message. Audit store only: never logged, never returned to a client. */
  readonly matchedSegment: string;
  readonly confidence: number;
}

export type StagePhase = 'inbound' | 'outbound';
export type StageVerdictKind = 'pass' | 'transform' | 'block' | 'error';

/**
 * What one pipeline stage decided for this request. CONTAINS CALLER CONTENT through
 * `findings[].matchedSegment`; audit-only. Never log or serialise a StageOutcome wholesale.
 * Written only by GatewayPipeline, which sets `reason` whenever verdict is 'block' or 'error'.
 */
export interface StageOutcome {
  readonly stage: string;
  readonly phase: StagePhase;
  readonly verdict: StageVerdictKind;
  /** Short code, never content. Present for 'block' and 'error' verdicts. */
  readonly reason?: string;
  readonly findings: readonly Finding[];
  readonly durationMs: number;
}

/**
 * What the provider call did for this request. Written only by LlmExecutor: exactly one of
 * `usage` (success) or `errorKind` (failure) is set.
 */
export interface ExecOutcome {
  readonly provider: string;
  readonly model: string;
  readonly latencyMs: number;
  readonly usage?: TokenUsage;
  readonly errorKind?: LlmProviderErrorKind;
}

/** Written by ApiKeyGuard in a later spec. */
export interface Principal {
  apiKeyId: string;
  roles: readonly string[];
}

export interface RequestContext {
  readonly requestId: string;
  /** `performance.now()` at creation, for durations. */
  readonly startedAt: number;
  principal?: Principal;
  readonly stages: StageOutcome[];
  exec?: ExecOutcome;
}

export function createRequestContext(): RequestContext {
  return { requestId: randomUUID(), startedAt: performance.now(), stages: [] };
}

/** Milliseconds since a `performance.now()` mark, rounded to 2 decimals. */
export function elapsedMs(since: number): number {
  return Math.round((performance.now() - since) * 100) / 100;
}
```

- [ ] **Step 4: Implement the service**

`src/common/context/request-context.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestContext } from './request-context.js';

export class RequestContextMissingError extends Error {
  constructor() {
    super('No request context: code ran outside RequestContextService.run()');
    this.name = 'RequestContextMissingError';
  }
}

/** One store per process, so a duplicate DI registration cannot fragment the context. */
const storage = new AsyncLocalStorage<RequestContext>();

/** AsyncLocalStorage wrapper. One context per HTTP request, established by the middleware. */
@Injectable()
export class RequestContextService {
  run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  }

  get(): RequestContext {
    const context = storage.getStore();
    if (context === undefined) {
      throw new RequestContextMissingError();
    }
    return context;
  }

  tryGet(): RequestContext | undefined {
    return storage.getStore();
  }
}
```

- [ ] **Step 5: Run the spec to verify it passes**

Run: `pnpm vitest run src/common/context/request-context.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Checkpoint**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: green.

---

### Task 4: Context middleware, module, and app wiring

**Files:**
- Create: `src/common/context/request-context.middleware.ts`
- Create: `src/common/context/request-context.module.ts`
- Modify: `src/app.module.ts`
- Test: `src/common/context/request-context.middleware.spec.ts`
- Modify: `test/app.e2e.spec.ts`

- [ ] **Step 1: Write the failing unit test**

`src/common/context/request-context.middleware.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from './request-context.js';
import { REQUEST_ID_HEADER, RequestContextMiddleware } from './request-context.middleware.js';
import { RequestContextService } from './request-context.service.js';

describe('RequestContextMiddleware', () => {
  it('creates a context for the handler chain and sets the x-request-id header', () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    const setHeader = vi.fn();
    let seen: RequestContext | undefined;

    middleware.use({}, { setHeader }, () => {
      seen = service.get();
    });

    expect(seen).toBeDefined();
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, seen?.requestId);
    expect(service.tryGet()).toBeUndefined();
  });

  it('gives every request its own context', () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    const ids: string[] = [];
    const next = (): void => {
      ids.push(service.get().requestId);
    };

    middleware.use({}, { setHeader: vi.fn() }, next);
    middleware.use({}, { setHeader: vi.fn() }, next);

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm vitest run src/common/context/request-context.middleware.spec.ts`
Expected: FAIL — `Cannot find module './request-context.middleware.js'`.

- [ ] **Step 3: Implement middleware and module**

`src/common/context/request-context.middleware.ts`:

```ts
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { createRequestContext } from './request-context.js';
import { RequestContextService } from './request-context.service.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/** The only part of the response the middleware touches; keeps tests free of Express fakes. */
export interface HeaderWriter {
  setHeader(name: string, value: string): unknown;
}

/**
 * Opens one RequestContext per request. Runs before guards so they can record the principal.
 * Any client-supplied x-request-id is ignored: ids are always generated here.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly contextService: RequestContextService) {}

  use(_req: unknown, res: HeaderWriter, next: () => void): void {
    const context = createRequestContext();
    res.setHeader(REQUEST_ID_HEADER, context.requestId);
    this.contextService.run(context, () => {
      next();
    });
  }
}
```

`src/common/context/request-context.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { RequestContextService } from './request-context.service.js';

@Global()
@Module({
  providers: [RequestContextService],
  exports: [RequestContextService],
})
export class RequestContextModule {}
```

- [ ] **Step 4: Run the unit spec to verify it passes**

Run: `pnpm vitest run src/common/context/request-context.middleware.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add the failing e2e assertion**

In `test/app.e2e.spec.ts`, replace the single test with:

```ts
  it('GET /healthz reports ok', async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: 'ok' });
  });

  it('every response carries a generated x-request-id', async () => {
    const response = await fetch(`${baseUrl}/healthz`, { headers: { 'x-request-id': 'spoofed' } });

    expect(response.headers.get('x-request-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
```

Run: `pnpm vitest run test/app.e2e.spec.ts`
Expected: FAIL — header is `null`.

- [ ] **Step 6: Wire the middleware in AppModule**

Replace `src/app.module.ts` with:

```ts
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { RequestContextMiddleware } from './common/context/request-context.middleware.js';
import { RequestContextModule } from './common/context/request-context.module.js';
import { AppConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [AppConfigModule.forRoot(), RequestContextModule, HealthModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('{*path}');
  }
}
```

`'{*path}'` is the path-to-regexp v8 catch-all used by Nest 11+ (a bare `'*'` is only accepted through a legacy converter that logs an error).

- [ ] **Step 7: Run the e2e spec to verify it passes**

Run: `pnpm vitest run test/app.e2e.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Checkpoint**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: green.

---

### Task 5: Chat contract schemas

**Files:**
- Create: `src/chat/chat.schemas.ts`
- Test: `src/chat/chat.schemas.spec.ts`

- [ ] **Step 1: Write the failing test**

`src/chat/chat.schemas.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
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
    const full = { ...minimal, system: 'be terse', maxTokens: 256, temperature: 0.2 };

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

  it('rejects temperature outside 0..1 and non-integer maxTokens', () => {
    expect(chatRequestSchema.safeParse({ ...minimal, temperature: 1.5 }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...minimal, maxTokens: 10.5 }).success).toBe(false);
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
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm vitest run src/chat/chat.schemas.spec.ts`
Expected: FAIL — `Cannot find module './chat.schemas.js'`.

- [ ] **Step 3: Implement**

`src/chat/chat.schemas.ts`:

```ts
import { z } from 'zod';
import { MAX_OUTPUT_TOKENS } from '../config/domains/llm.config.js';
import { llmRoleSchema, stopReasonSchema, tokenUsageSchema } from '../providers/llm-provider.js';

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
    temperature: z.number().min(0).max(1).optional(),
  },
  objectParams,
);

export const chatResponseSchema = z.strictObject({
  requestId: z.string(),
  content: z.string(),
  model: z.string(),
  stopReason: stopReasonSchema,
  usage: tokenUsageSchema,
});

export type ChatMessage = z.output<typeof chatMessageSchema>;
export type ChatRequest = z.output<typeof chatRequestSchema>;
export type ChatResponse = z.output<typeof chatResponseSchema>;
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `pnpm vitest run src/chat/chat.schemas.spec.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Checkpoint**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: green.

---

### Task 6: Provider adapter base class

**Files:**
- Create: `src/providers/llm-provider.adapter.ts`
- Test: `src/providers/llm-provider.adapter.spec.ts`

- [ ] **Step 1: Write the failing test**

`src/providers/llm-provider.adapter.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LlmProviderAdapter } from './llm-provider.adapter.js';
import {
  LlmProviderError,
  type LlmProviderName,
  type LlmRequest,
  type LlmResponse,
} from './llm-provider.js';

interface Behaviour {
  sendResult?: unknown;
  failSend?: boolean;
  failParse?: 'plain' | 'typed';
  /** Make toLlmResponse return a contract-violating value (negative usage). */
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
    return request.messages.map((message) => message.content).join('\n');
  }

  protected send(request: string, signal: AbortSignal): Promise<unknown> {
    this.steps.push(`send:${request}:${String(signal.aborted)}`);
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
    return {
      content: response.text,
      model: 'm',
      stopReason: 'end_turn',
      usage: { inputTokens: this.behaviour.badOutput === true ? -1 : 0, outputTokens: 0 },
    };
  }

  protected toProviderError(error: unknown): LlmProviderError {
    this.steps.push('toProviderError');
    return new LlmProviderError('upstream', 'translated', { cause: error });
  }
}

const request: LlmRequest = {
  model: 'm',
  messages: [{ role: 'user', content: 'hello' }],
  maxTokens: 16,
};
const options = { signal: new AbortController().signal };

describe('LlmProviderAdapter', () => {
  it('runs convert → send → parse → convert in order and passes the signal through', async () => {
    const adapter = new TestAdapter({ sendResult: 'reply' });

    const response = await adapter.complete(request, options);

    expect(response.content).toBe('reply');
    expect(adapter.steps).toEqual(['toProviderRequest', 'send:hello:false', 'parse', 'toLlmResponse']);
  });

  it('routes send failures through toProviderError', async () => {
    const adapter = new TestAdapter({ failSend: true });

    await expect(adapter.complete(request, options)).rejects.toMatchObject({
      kind: 'upstream',
      message: 'translated',
    });
    expect(adapter.steps).toContain('toProviderError');
    expect(adapter.steps).not.toContain('parse');
  });

  it('wraps untyped parse failures as bad_response', async () => {
    const adapter = new TestAdapter({ sendResult: 'x', failParse: 'plain' });

    await expect(adapter.complete(request, options)).rejects.toMatchObject({
      kind: 'bad_response',
    });
    expect(adapter.steps).not.toContain('toProviderError');
  });

  it('passes typed parse failures through unchanged', async () => {
    const adapter = new TestAdapter({ sendResult: 'x', failParse: 'typed' });

    await expect(adapter.complete(request, options)).rejects.toMatchObject({
      kind: 'bad_response',
      message: 'typed parse failure',
    });
  });

  it('rejects an adapter-produced response that violates the neutral contract', async () => {
    const adapter = new TestAdapter({ sendResult: 'x', badOutput: true });

    await expect(adapter.complete(request, options)).rejects.toMatchObject({
      kind: 'bad_response',
    });
    expect(adapter.steps).toContain('toLlmResponse');
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm vitest run src/providers/llm-provider.adapter.spec.ts`
Expected: FAIL — `Cannot find module './llm-provider.adapter.js'`.

- [ ] **Step 3: Implement**

`src/providers/llm-provider.adapter.ts`:

```ts
import {
  LlmProviderError,
  llmResponseSchema,
  type LlmCompletionOptions,
  type LlmProvider,
  type LlmProviderName,
  type LlmRequest,
  type LlmResponse,
} from './llm-provider.js';

/**
 * Template for every real provider. `complete()` fixes the sequence
 * convert → send → parse → convert → validate, so an adapter cannot skip request mapping,
 * response validation, or error translation, and cannot hand the gateway a response that
 * violates the neutral contract. Keep the pure conversions in a codec module and make
 * these methods delegate to them. Every failure leaves `complete()` as an LlmProviderError:
 * an already-classified error always wins, and a bug in a pure conversion is non-retryable.
 */
export abstract class LlmProviderAdapter<TRequest, TResponse> implements LlmProvider {
  abstract readonly name: LlmProviderName;

  /** Neutral request → provider-native request. Pure; a throw is classified `bad_request`. */
  protected abstract toProviderRequest(request: LlmRequest): TRequest;

  /**
   * Perform the network call and return the raw result untyped; it is parsed next. Must hand
   * `signal` to the transport: the executor's timeout has no other enforcement mechanism.
   */
  protected abstract send(request: TRequest, signal: AbortSignal): Promise<unknown>;

  /** Validate the raw result (Zod). Throw on mismatch; a plain throw is classified `bad_response`. */
  protected abstract parseProviderResponse(raw: unknown): TResponse;

  /** Provider-native response → neutral response. Pure; a throw is classified `bad_response`. */
  protected abstract toLlmResponse(response: TResponse): LlmResponse;

  /**
   * Anything `send` throws → LlmProviderError with the right kind. The message must be
   * gateway-authored and generic: put the provider's own error in `cause`, never in the
   * message, because the message is logged and drives HTTP mapping.
   */
  protected abstract toProviderError(error: unknown): LlmProviderError;

  /** Do not override: the fixed sequence is the point of this class. */
  async complete(request: LlmRequest, options: LlmCompletionOptions): Promise<LlmResponse> {
    const providerRequest = this.guard('bad_request', 'could not map the request', () =>
      this.toProviderRequest(request),
    );

    let raw: unknown;
    try {
      raw = await this.send(providerRequest, options.signal);
    } catch (error: unknown) {
      throw this.classifySendError(error);
    }

    const parsed = this.guard('bad_response', 'returned an unexpected response shape', () =>
      this.parseProviderResponse(raw),
    );
    const neutral = this.guard('bad_response', 'could not map the response', () =>
      this.toLlmResponse(parsed),
    );

    const validated = llmResponseSchema.safeParse(neutral);
    if (!validated.success) {
      throw new LlmProviderError(
        'bad_response',
        `${this.name} adapter produced an invalid LlmResponse`,
        { cause: validated.error },
      );
    }
    return validated.data;
  }

  /** Runs a pure conversion: an already-classified error passes through, anything else gets `kind`. */
  private guard<T>(kind: 'bad_request' | 'bad_response', what: string, fn: () => T): T {
    try {
      return fn();
    } catch (error: unknown) {
      if (error instanceof LlmProviderError) {
        throw error;
      }
      throw new LlmProviderError(kind, `${this.name} ${what}`, { cause: error });
    }
  }

  /** Already-classified errors win; a broken translator must not lose the original failure. */
  private classifySendError(error: unknown): LlmProviderError {
    if (error instanceof LlmProviderError) {
      return error;
    }
    try {
      return this.toProviderError(error);
    } catch {
      return new LlmProviderError(
        'upstream',
        `${this.name} request failed and its error could not be classified`,
        { cause: error },
      );
    }
  }
}
```

(The repository's spec for this class has 9 tests after the hardening follow-up: typed send errors pass through, a throwing translator keeps the original cause, request/response mapping failures are non-retryable `bad_request`/`bad_response`, and contract-violating output never echoes into `cause`.)

- [ ] **Step 4: Run the spec to verify it passes**

Run: `pnpm vitest run src/providers/llm-provider.adapter.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Checkpoint**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: green.

---

### Task 7: Fake provider

**Files:**
- Create: `src/providers/fake/fake.provider.ts`
- Test: `src/providers/fake/fake.provider.spec.ts`

- [ ] **Step 1: Write the failing test**

`src/providers/fake/fake.provider.spec.ts`:

```ts
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
    await expect(fake.complete(request, { signal })).rejects.toMatchObject({ kind: 'rate_limited' });
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
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm vitest run src/providers/fake/fake.provider.spec.ts`
Expected: FAIL — `Cannot find module './fake.provider.js'`.

- [ ] **Step 3: Implement**

`src/providers/fake/fake.provider.ts`:

```ts
import {
  LlmProviderError,
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
 * through configuration and excluded from the production build (`tsconfig.build.json`).
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
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `pnpm vitest run src/providers/fake/fake.provider.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Checkpoint**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: green.

---

### Task 8: LlmExecutor

**Files:**
- Create: `src/providers/llm-executor.ts`
- Test: `src/providers/llm-executor.spec.ts`

- [ ] **Step 1: Write the failing test**

`src/providers/llm-executor.spec.ts`:

```ts
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
      temperature: undefined,
    });
  });

  it('lets the request override maxTokens and pass system and temperature', async () => {
    const fake = new FakeLlmProvider();
    const { executor } = build(fake);

    await executor.complete({ ...request, maxTokens: 5, system: 'terse', temperature: 0.3 });

    expect(fake.calls[0]).toMatchObject({ maxTokens: 5, system: 'terse', temperature: 0.3 });
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

    expect(response.content).toBe('hi');
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

  it('classifies unknown provider throws as upstream', async () => {
    const broken: LlmProvider = {
      name: 'fake',
      complete: () => Promise.reject(new Error('kaboom')),
    };
    const { executor } = build(broken);

    await expect(executor.complete(request)).rejects.toMatchObject({ kind: 'upstream' });
  });

  it('works without a request context (outcome simply not recorded)', async () => {
    const fake = new FakeLlmProvider().enqueue(fakeResponse({ ...request, model: 'x', maxTokens: 1 }));
    const { executor } = build(fake);

    const response: LlmResponse = await executor.complete(request);

    expect(response.content).toBe('fake response');
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm vitest run src/providers/llm-executor.spec.ts`
Expected: FAIL — `Cannot find module './llm-executor.js'`.

- [ ] **Step 3: Implement**

`src/providers/llm-executor.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { ChatRequest } from '../chat/chat.schemas.js';
import { elapsedMs, type ExecOutcome } from '../common/context/request-context.js';
import { RequestContextService } from '../common/context/request-context.service.js';
import { llmConfig, type LlmConfig } from '../config/domains/llm.config.js';
import {
  LLM_PROVIDER,
  LlmProviderError,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from './llm-provider.js';

/**
 * The exec layer: gateway-level conversion (ChatRequest → LlmRequest), the timeout, error
 * normalisation, and the ExecOutcome record. Provider-specific conversion lives in adapters.
 */
@Injectable()
export class LlmExecutor {
  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    @Inject(llmConfig.KEY) private readonly config: LlmConfig,
    private readonly contextService: RequestContextService,
  ) {}

  async complete(request: ChatRequest): Promise<LlmResponse> {
    const llmRequest = this.toLlmRequest(request);
    const signal = AbortSignal.timeout(this.config.timeoutMs);
    const startedAt = performance.now();

    try {
      const response = await this.withDeadline(
        this.provider.complete(llmRequest, { signal }),
        signal,
      );
      this.record({
        provider: this.provider.name,
        model: response.model,
        latencyMs: elapsedMs(startedAt),
        usage: response.usage,
      });
      return response;
    } catch (error: unknown) {
      const latencyMs = elapsedMs(startedAt);
      const providerError = this.normalise(error, signal);
      this.record({
        provider: this.provider.name,
        model: llmRequest.model,
        latencyMs,
        errorKind: providerError.kind,
      });
      throw providerError;
    }
  }

  /** The single place a ChatRequest becomes a provider-neutral LlmRequest. */
  private toLlmRequest(request: ChatRequest): LlmRequest {
    return {
      model: this.config.model,
      messages: request.messages,
      maxTokens: request.maxTokens ?? this.config.maxOutputTokens,
      system: request.system,
      temperature: request.temperature,
    };
  }

  /**
   * Adapters must honour `signal`, but the executor is the backstop: once the deadline passes
   * the call is abandoned and reported as a timeout even if the adapter never settles.
   */
  private async withDeadline(call: Promise<LlmResponse>, signal: AbortSignal): Promise<LlmResponse> {
    const cleanup = new AbortController();
    const deadline = new Promise<never>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          reject(this.timeoutError());
        },
        { once: true, signal: cleanup.signal },
      );
    });
    try {
      return await Promise.race([call, deadline]);
    } finally {
      cleanup.abort();
    }
  }

  private normalise(error: unknown, signal: AbortSignal): LlmProviderError {
    if (error instanceof LlmProviderError) {
      return error;
    }
    if (signal.aborted) {
      return this.timeoutError(error);
    }
    return new LlmProviderError('upstream', 'provider call failed', { cause: error });
  }

  private timeoutError(cause?: unknown): LlmProviderError {
    return new LlmProviderError('timeout', `provider call exceeded ${this.config.timeoutMs}ms`, {
      cause,
    });
  }

  private record(outcome: ExecOutcome): void {
    const context = this.contextService.tryGet();
    if (context !== undefined) {
      context.exec = outcome;
    }
  }
}
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `pnpm vitest run src/providers/llm-executor.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Checkpoint**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: green.

---

### Task 9: Pipeline stages, runner, module

**Files:**
- Create: `src/pipeline/stage.ts`
- Create: `src/pipeline/pipeline.errors.ts`
- Create: `src/pipeline/gateway-pipeline.ts`
- Create: `src/pipeline/pipeline.module.ts`
- Test: `src/pipeline/gateway-pipeline.spec.ts`

- [ ] **Step 1: Write the failing test**

`src/pipeline/gateway-pipeline.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ChatRequest } from '../chat/chat.schemas.js';
import {
  createRequestContext,
  type Finding,
  type RequestContext,
} from '../common/context/request-context.js';
import {
  RequestContextMissingError,
  RequestContextService,
} from '../common/context/request-context.service.js';
import type { LlmConfig } from '../config/domains/llm.config.js';
import { FakeLlmProvider } from '../providers/fake/fake.provider.js';
import { LlmExecutor } from '../providers/llm-executor.js';
import { LlmProviderError } from '../providers/llm-provider.js';
import { GatewayPipeline } from './gateway-pipeline.js';
import { PipelineStageError } from './pipeline.errors.js';
import type {
  InboundInput,
  InboundStage,
  OutboundInput,
  OutboundStage,
  StageVerdict,
} from './stage.js';

const config: LlmConfig = {
  provider: 'anthropic',
  model: 'claude-opus-5',
  apiKey: 'placeholder',
  timeoutMs: 1000,
  baseUrl: undefined,
  maxOutputTokens: 1024,
};

const request: ChatRequest = { messages: [{ role: 'user', content: 'hello' }] };
const finding: Finding = { ruleId: 'TEST-1', category: 'test', matchedSegment: 'hello', confidence: 1 };

function inbound(
  name: string,
  verdict: (input: InboundInput) => StageVerdict<InboundInput>,
  log: string[],
): InboundStage {
  return {
    name,
    run: (input) => {
      log.push(name);
      return Promise.resolve(verdict(input));
    },
  };
}

function outbound(
  name: string,
  verdict: (input: OutboundInput) => StageVerdict<OutboundInput>,
  log: string[],
): OutboundStage {
  return {
    name,
    run: (input) => {
      log.push(name);
      return Promise.resolve(verdict(input));
    },
  };
}

function build(inboundStages: InboundStage[], outboundStages: OutboundStage[] = []) {
  const fake = new FakeLlmProvider();
  const contextService = new RequestContextService();
  const executor = new LlmExecutor(fake, config, contextService);
  const pipeline = new GatewayPipeline(inboundStages, outboundStages, executor, contextService);
  const context: RequestContext = createRequestContext();
  const run = () => contextService.run(context, () => pipeline.run(request));
  return { fake, pipeline, context, run };
}

describe('GatewayPipeline', () => {
  it('runs inbound stages in order, chaining transforms into the provider call', async () => {
    const log: string[] = [];
    const { fake, context, run } = build([
      inbound(
        'a',
        (input) => ({
          kind: 'transform',
          value: { request: { messages: [{ role: 'user', content: `${input.request.messages[0]?.content ?? ''} A` }] } },
        }),
        log,
      ),
      inbound('b', () => ({ kind: 'pass', findings: [finding] }), log),
    ]);

    const result = await run();

    expect(log).toEqual(['a', 'b']);
    expect(fake.calls[0]?.messages[0]?.content).toBe('hello A');
    expect(result.kind).toBe('completed');
    expect(context.stages.map((s) => [s.stage, s.phase, s.verdict])).toEqual([
      ['a', 'inbound', 'transform'],
      ['b', 'inbound', 'pass'],
    ]);
    expect(context.stages[1]?.findings).toEqual([finding]);
    expect(context.stages.every((s) => s.durationMs >= 0)).toBe(true);
  });

  it('short-circuits on an inbound block: later stages and the provider never run', async () => {
    const log: string[] = [];
    const { fake, context, run } = build([
      inbound('a', () => ({ kind: 'pass' }), log),
      inbound('b', () => ({ kind: 'block', reason: 'INJ-A', findings: [finding] }), log),
      inbound('c', () => ({ kind: 'pass' }), log),
    ]);

    const result = await run();

    expect(result).toEqual({ kind: 'blocked', phase: 'inbound', stage: 'b', reason: 'INJ-A' });
    expect(log).toEqual(['a', 'b']);
    expect(fake.calls).toHaveLength(0);
    expect(context.stages[1]).toMatchObject({ stage: 'b', verdict: 'block', reason: 'INJ-A', findings: [finding] });
    expect(context.exec).toBeUndefined();
  });

  it('runs outbound stages over the response, applying transforms and blocks', async () => {
    const log: string[] = [];
    const redact = outbound(
      'redact',
      (input) => ({ kind: 'transform', value: { ...input, response: { ...input.response, content: 'redacted' } } }),
      log,
    );
    const { run } = build([], [redact]);

    const result = await run();

    expect(result.kind).toBe('completed');
    if (result.kind === 'completed') {
      expect(result.response.content).toBe('redacted');
    }

    const blockLog: string[] = [];
    const blocker = outbound('leak', () => ({ kind: 'block', reason: 'SECRET', findings: [] }), blockLog);
    const blocked = await build([], [blocker]).run();

    expect(blocked).toEqual({ kind: 'blocked', phase: 'outbound', stage: 'leak', reason: 'SECRET' });
  });

  it('fails closed when a stage throws: error outcome, PipelineStageError, provider not called', async () => {
    const log: string[] = [];
    const broken: InboundStage = {
      name: 'broken',
      run: () => Promise.reject(new Error('detector crashed')),
    };
    const { fake, context, run } = build([broken, inbound('after', () => ({ kind: 'pass' }), log)]);

    await expect(run()).rejects.toBeInstanceOf(PipelineStageError);
    await expect(run()).rejects.toMatchObject({ stage: 'broken', phase: 'inbound' });
    expect(log).toEqual([]);
    expect(fake.calls).toHaveLength(0);
    expect(context.stages[0]).toMatchObject({ stage: 'broken', verdict: 'error' });
  });

  it('propagates provider errors and skips outbound stages', async () => {
    const log: string[] = [];
    const { fake, context, run } = build([], [outbound('never', () => ({ kind: 'pass' }), log)]);
    fake.enqueue(new LlmProviderError('rate_limited', 'slow down', { status: 429 }));

    await expect(run()).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(log).toEqual([]);
    expect(context.exec?.errorKind).toBe('rate_limited');
  });

  it('requires a request context', async () => {
    const { pipeline } = build([]);

    await expect(pipeline.run(request)).rejects.toBeInstanceOf(RequestContextMissingError);
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm vitest run src/pipeline/gateway-pipeline.spec.ts`
Expected: FAIL — `Cannot find module './gateway-pipeline.js'`.

- [ ] **Step 3: Implement stage contracts and error**

`src/pipeline/stage.ts`:

```ts
import type { ChatRequest } from '../chat/chat.schemas.js';
import type { Finding, RequestContext } from '../common/context/request-context.js';
import type { LlmResponse } from '../providers/llm-provider.js';

export const INBOUND_STAGES = Symbol('INBOUND_STAGES');
export const OUTBOUND_STAGES = Symbol('OUTBOUND_STAGES');

/** What inbound stages see. Later specs add optional derived fields (e.g. canonical text). */
export interface InboundInput {
  readonly request: ChatRequest;
}

/** What outbound stages see: the final inbound request and the provider's response. */
export interface OutboundInput {
  readonly request: ChatRequest;
  readonly response: LlmResponse;
}

/**
 * A stage's decision. `transform` replaces the input for the following stages;
 * `block` stops the pipeline. Findings are recorded in the request context either way.
 */
export type StageVerdict<T> =
  | { kind: 'pass'; findings?: Finding[] }
  | { kind: 'transform'; value: T; findings?: Finding[] }
  | { kind: 'block'; reason: string; findings: Finding[] };

export interface InboundStage {
  readonly name: string;
  run(input: InboundInput, context: RequestContext): Promise<StageVerdict<InboundInput>>;
}

export interface OutboundStage {
  readonly name: string;
  run(input: OutboundInput, context: RequestContext): Promise<StageVerdict<OutboundInput>>;
}
```

`src/pipeline/pipeline.errors.ts`:

```ts
import type { StagePhase } from '../common/context/request-context.js';

/** A stage threw instead of returning a verdict. The pipeline fails closed. */
export class PipelineStageError extends Error {
  constructor(
    readonly stage: string,
    readonly phase: StagePhase,
    cause: unknown,
  ) {
    super(`pipeline stage "${stage}" (${phase}) failed`, { cause });
    this.name = 'PipelineStageError';
  }
}
```

- [ ] **Step 4: Implement the runner**

`src/pipeline/gateway-pipeline.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ChatRequest } from '../chat/chat.schemas.js';
import {
  elapsedMs,
  type RequestContext,
  type StagePhase,
} from '../common/context/request-context.js';
import { RequestContextService } from '../common/context/request-context.service.js';
import { LlmExecutor } from '../providers/llm-executor.js';
import type { LlmResponse } from '../providers/llm-provider.js';
import { PipelineStageError } from './pipeline.errors.js';
import {
  INBOUND_STAGES,
  OUTBOUND_STAGES,
  type InboundInput,
  type InboundStage,
  type OutboundInput,
  type OutboundStage,
  type StageVerdict,
} from './stage.js';

export type PipelineResult =
  | { kind: 'completed'; request: ChatRequest; response: LlmResponse }
  | { kind: 'blocked'; phase: StagePhase; stage: string; reason: string };

interface Stage<T> {
  readonly name: string;
  run(input: T, context: RequestContext): Promise<StageVerdict<T>>;
}

/**
 * Runs inbound stages → provider → outbound stages. Every verdict is timed and appended to
 * the request context. A throwing stage fails the request (fail closed).
 */
@Injectable()
export class GatewayPipeline {
  private readonly logger = new Logger(GatewayPipeline.name);

  constructor(
    @Inject(INBOUND_STAGES) private readonly inboundStages: readonly InboundStage[],
    @Inject(OUTBOUND_STAGES) private readonly outboundStages: readonly OutboundStage[],
    private readonly executor: LlmExecutor,
    private readonly contextService: RequestContextService,
  ) {}

  async run(request: ChatRequest): Promise<PipelineResult> {
    const context = this.contextService.get();

    let input: InboundInput = { request };
    for (const stage of this.inboundStages) {
      const verdict = await this.runStage(stage, 'inbound', input, context);
      if (verdict.kind === 'block') {
        return { kind: 'blocked', phase: 'inbound', stage: stage.name, reason: verdict.reason };
      }
      if (verdict.kind === 'transform') {
        input = verdict.value;
      }
    }

    const response = await this.executor.complete(input.request);

    let output: OutboundInput = { request: input.request, response };
    for (const stage of this.outboundStages) {
      const verdict = await this.runStage(stage, 'outbound', output, context);
      if (verdict.kind === 'block') {
        return { kind: 'blocked', phase: 'outbound', stage: stage.name, reason: verdict.reason };
      }
      if (verdict.kind === 'transform') {
        output = verdict.value;
      }
    }

    return { kind: 'completed', request: output.request, response: output.response };
  }

  private async runStage<T>(
    stage: Stage<T>,
    phase: StagePhase,
    input: T,
    context: RequestContext,
  ): Promise<StageVerdict<T>> {
    const startedAt = performance.now();
    try {
      const verdict = await stage.run(input, context);
      if (verdict.kind === 'block') {
        // Block reasons reach logs and HTTP bodies: constrained to short codes by safeReason()
        // (`/^[A-Za-z0-9_.:-]{1,64}$/`, anything else becomes 'invalid_reason').
        const reason = safeReason(verdict.reason);
        context.stages.push({
          stage: stage.name,
          phase,
          verdict: 'block',
          reason,
          findings: verdict.findings,
          durationMs: elapsedMs(startedAt),
        });
        this.logger.warn(`blocked by ${stage.name} (${phase}): ${reason} [${context.requestId}]`);
        return { ...verdict, reason };
      }
      context.stages.push({
        stage: stage.name,
        phase,
        verdict: verdict.kind,
        findings: verdict.findings ?? [],
        durationMs: elapsedMs(startedAt),
      });
      return verdict;
    } catch (error: unknown) {
      context.stages.push({
        stage: stage.name,
        phase,
        verdict: 'error',
        reason: 'stage_error',
        findings: [],
        durationMs: elapsedMs(startedAt),
      });
      // Only the error's class name at error level: a detector's message can embed caller
      // content. The stack goes to debug, which the default LOG_LEVEL does not emit.
      this.logger.error(
        `stage ${stage.name} (${phase}) threw ${error instanceof Error ? error.name : 'non-Error'} [${context.requestId}]`,
      );
      this.logger.debug(error instanceof Error ? (error.stack ?? error.message) : 'non-Error value thrown');
      throw new PipelineStageError(stage.name, phase, error);
    }
  }
}
```

(The repository's spec for the runner has 10 tests after the hardening follow-up, including a Logger-spy test proving caller content never reaches warn/error logs.)

- [ ] **Step 5: Run the spec to verify it passes**

Run: `pnpm vitest run src/pipeline/gateway-pipeline.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: The module — created in Task 10 (Step 8) together with ProvidersModule, so every checkpoint stays green**

`src/pipeline/pipeline.module.ts` (for reference; create it in Task 10):

```ts
import { Module, type Type } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module.js';
import { GatewayPipeline } from './gateway-pipeline.js';
import { INBOUND_STAGES, OUTBOUND_STAGES, type InboundStage, type OutboundStage } from './stage.js';

/**
 * The only place stage order is defined. To add a security layer: implement InboundStage or
 * OutboundStage as an @Injectable class and append it here.
 */
export const INBOUND_STAGE_ORDER: Type<InboundStage>[] = [];
export const OUTBOUND_STAGE_ORDER: Type<OutboundStage>[] = [];

@Module({
  imports: [ProvidersModule],
  providers: [
    ...INBOUND_STAGE_ORDER,
    ...OUTBOUND_STAGE_ORDER,
    {
      provide: INBOUND_STAGES,
      useFactory: (...stages: InboundStage[]): readonly InboundStage[] => Object.freeze(stages),
      inject: INBOUND_STAGE_ORDER,
    },
    {
      provide: OUTBOUND_STAGES,
      useFactory: (...stages: OutboundStage[]): readonly OutboundStage[] => Object.freeze(stages),
      inject: OUTBOUND_STAGE_ORDER,
    },
    GatewayPipeline,
  ],
  exports: [GatewayPipeline],
})
export class PipelineModule {}
```

- [ ] **Step 7: Checkpoint**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`
Expected: green.

---

### Task 10: Anthropic adapter, provider factory, ProvidersModule

**Files:**
- Create: `src/providers/anthropic/anthropic.codec.ts`
- Create: `src/providers/anthropic/anthropic.client.ts`
- Create: `src/providers/anthropic/anthropic.provider.ts`
- Create: `src/providers/llm-provider.factory.ts`
- Create: `src/providers/providers.module.ts`
- Test: `src/providers/anthropic/anthropic.codec.spec.ts`
- Test: `src/providers/anthropic/anthropic.provider.spec.ts`
- Test: `src/providers/llm-provider.factory.spec.ts`

- [ ] **Step 1: Install the SDK**

Run: `pnpm add @anthropic-ai/sdk@^0.124.0`
Expected: `+ @anthropic-ai/sdk 0.124.x` under dependencies. (Peer `zod ^4` is already satisfied.)

- [ ] **Step 2: Write the failing codec test**

`src/providers/anthropic/anthropic.codec.spec.ts`:

```ts
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

  it('maps system and temperature when present', () => {
    expect(toAnthropicRequest({ ...request, system: 'terse', temperature: 0.1 })).toStrictEqual({
      model: 'claude-opus-5',
      max_tokens: 16,
      messages: request.messages,
      system: 'terse',
      temperature: 0.1,
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
      fromAnthropicResponse(anthropicResponseSchema.parse({ ...rawMessage, stop_reason })).stopReason;

    expect(withStop('max_tokens')).toBe('max_tokens');
    expect(withStop('stop_sequence')).toBe('stop_sequence');
    expect(withStop('tool_use')).toBe('other');
    expect(withStop('refusal')).toBe('other');
    expect(withStop(null)).toBe('other');
  });

  it('rejects responses missing usage or content', () => {
    expect(anthropicResponseSchema.safeParse({ ...rawMessage, usage: undefined }).success).toBe(false);
    expect(anthropicResponseSchema.safeParse({ ...rawMessage, content: 'text' }).success).toBe(false);
  });
});

describe('toAnthropicError', () => {
  const apiError = (status: number) => new APIError(status, undefined, 'provider said no', new Headers());

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

  it('never copies the provider message into the gateway error', () => {
    const error = toAnthropicError(apiError(401));

    expect(error.message).not.toContain('provider said no');
    expect(error.cause).toBeInstanceOf(APIError);
  });
});
```

- [ ] **Step 3: Run the codec spec to verify it fails**

Run: `pnpm vitest run src/providers/anthropic/anthropic.codec.spec.ts`
Expected: FAIL — `Cannot find module './anthropic.codec.js'`.

- [ ] **Step 4: Implement the codec**

`src/providers/anthropic/anthropic.codec.ts`:

```ts
import type Anthropic from '@anthropic-ai/sdk';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  LlmProviderError,
  type LlmProviderErrorKind,
  type LlmRequest,
  type LlmResponse,
  type StopReason,
} from '../llm-provider.js';

export type AnthropicRequest = Anthropic.MessageCreateParamsNonStreaming;

/**
 * Only the fields the gateway reads. Non-strict on purpose: the SDK adds more fields and
 * the API may add more block types; both are ignored rather than rejected.
 */
export const anthropicResponseSchema = z.object({
  model: z.string().min(1),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  stop_reason: z.string().nullable(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});
export type AnthropicResponse = z.output<typeof anthropicResponseSchema>;

export function toAnthropicRequest(request: LlmRequest): AnthropicRequest {
  const params: AnthropicRequest = {
    model: request.model,
    max_tokens: request.maxTokens,
    messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
  };
  if (request.system !== undefined) {
    params.system = request.system;
  }
  if (request.temperature !== undefined) {
    params.temperature = request.temperature;
  }
  return params;
}

export function fromAnthropicResponse(response: AnthropicResponse): LlmResponse {
  const content = response.content
    .flatMap((block) => (block.type === 'text' && block.text !== undefined ? [block.text] : []))
    .join('');
  return {
    content,
    model: response.model,
    stopReason: toStopReason(response.stop_reason),
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}

function toStopReason(reason: string | null): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'max_tokens':
    case 'stop_sequence':
      return reason;
    default:
      return 'other';
  }
}

/** Gateway-authored messages only; the SDK error rides along as `cause` for debug logs. */
export function toAnthropicError(error: unknown): LlmProviderError {
  if (error instanceof LlmProviderError) {
    return error;
  }
  if (error instanceof APIUserAbortError || error instanceof APIConnectionTimeoutError) {
    return new LlmProviderError('timeout', 'anthropic request timed out', { cause: error });
  }
  if (error instanceof APIConnectionError) {
    return new LlmProviderError('network', 'anthropic request failed to connect', { cause: error });
  }
  if (error instanceof APIError) {
    return new LlmProviderError(
      kindForStatus(error.status),
      `anthropic request failed with status ${error.status ?? 'unknown'}`,
      { status: error.status, cause: error },
    );
  }
  return new LlmProviderError('upstream', 'anthropic request failed', { cause: error });
}

function kindForStatus(status: number | undefined): LlmProviderErrorKind {
  if (status === 401 || status === 403) {
    return 'auth';
  }
  if (status === 429) {
    return 'rate_limited';
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return 'bad_request';
  }
  return 'upstream';
}
```

Order matters: `APIConnectionTimeoutError extends APIConnectionError extends APIError`, so the timeout check comes first.

- [ ] **Step 5: Run the codec spec to verify it passes**

Run: `pnpm vitest run src/providers/anthropic/anthropic.codec.spec.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Write the failing provider and factory tests**

`src/providers/anthropic/anthropic.provider.spec.ts`:

```ts
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
});
```

`src/providers/llm-provider.factory.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { LlmConfig } from '../config/domains/llm.config.js';
import { AnthropicProvider } from './anthropic/anthropic.provider.js';
import { createLlmProvider } from './llm-provider.factory.js';

const config: LlmConfig = {
  provider: 'anthropic',
  model: 'claude-opus-5',
  apiKey: 'placeholder',
  timeoutMs: 1000,
  baseUrl: undefined,
  maxOutputTokens: 1024,
};

describe('createLlmProvider', () => {
  it('builds the Anthropic adapter for LLM_PROVIDER=anthropic', () => {
    const provider = createLlmProvider(config);

    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.name).toBe('anthropic');
  });

  it('refuses to boot with the not-yet-implemented OpenAI adapter', () => {
    expect(() => createLlmProvider({ ...config, provider: 'openai' })).toThrow(
      /OpenAI adapter not implemented/,
    );
  });
});
```

- [ ] **Step 7: Run them to verify they fail**

Run: `pnpm vitest run src/providers/anthropic/anthropic.provider.spec.ts src/providers/llm-provider.factory.spec.ts`
Expected: FAIL — missing modules.

- [ ] **Step 8: Implement client, provider, factory, module**

`src/providers/anthropic/anthropic.client.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import type { LlmConfig } from '../../config/domains/llm.config.js';
import type { AnthropicRequest } from './anthropic.codec.js';

/** The slice of the SDK the adapter uses. Tests stub this; production passes the real client. */
export interface AnthropicMessagesClient {
  messages: {
    create(params: AnthropicRequest, options: { signal: AbortSignal }): Promise<unknown>;
  };
}

/**
 * `maxRetries: 0`: the executor's AbortSignal is the single source of truth for timing;
 * SDK-level retries would silently exceed it. `baseURL` undefined → SDK default.
 */
export function createAnthropicClient(config: LlmConfig): AnthropicMessagesClient {
  return new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: config.timeoutMs,
    maxRetries: 0,
  });
}
```

`src/providers/anthropic/anthropic.provider.ts`:

```ts
import { LlmProviderAdapter } from '../llm-provider.adapter.js';
import type { LlmProviderError, LlmProviderName, LlmRequest, LlmResponse } from '../llm-provider.js';
import type { AnthropicMessagesClient } from './anthropic.client.js';
import {
  anthropicResponseSchema,
  fromAnthropicResponse,
  toAnthropicError,
  toAnthropicRequest,
  type AnthropicRequest,
  type AnthropicResponse,
} from './anthropic.codec.js';

/** Wiring only; every conversion lives in anthropic.codec.ts. */
export class AnthropicProvider extends LlmProviderAdapter<AnthropicRequest, AnthropicResponse> {
  readonly name: LlmProviderName = 'anthropic';

  constructor(private readonly client: AnthropicMessagesClient) {
    super();
  }

  protected toProviderRequest(request: LlmRequest): AnthropicRequest {
    return toAnthropicRequest(request);
  }

  protected send(request: AnthropicRequest, signal: AbortSignal): Promise<unknown> {
    return this.client.messages.create(request, { signal });
  }

  protected parseProviderResponse(raw: unknown): AnthropicResponse {
    return anthropicResponseSchema.parse(raw);
  }

  protected toLlmResponse(response: AnthropicResponse): LlmResponse {
    return fromAnthropicResponse(response);
  }

  protected toProviderError(error: unknown): LlmProviderError {
    return toAnthropicError(error);
  }
}
```

`src/providers/llm-provider.factory.ts`:

```ts
import type { LlmConfig } from '../config/domains/llm.config.js';
import { createAnthropicClient } from './anthropic/anthropic.client.js';
import { AnthropicProvider } from './anthropic/anthropic.provider.js';
import type { LlmProvider } from './llm-provider.js';

/** Selects the adapter for LLM_PROVIDER. Boot fails loudly for providers without an adapter. */
export function createLlmProvider(config: LlmConfig): LlmProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(createAnthropicClient(config));
    case 'openai':
      throw new Error('OpenAI adapter not implemented yet: set LLM_PROVIDER=anthropic');
  }
}
```

`src/providers/providers.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { llmConfig } from '../config/domains/llm.config.js';
import { LlmExecutor } from './llm-executor.js';
import { createLlmProvider } from './llm-provider.factory.js';
import { LLM_PROVIDER } from './llm-provider.js';

@Module({
  providers: [
    { provide: LLM_PROVIDER, useFactory: createLlmProvider, inject: [llmConfig.KEY] },
    LlmExecutor,
  ],
  exports: [LLM_PROVIDER, LlmExecutor],
})
export class ProvidersModule {}
```

- [ ] **Step 9: Run the specs to verify they pass**

Run: `pnpm vitest run src/providers`
Expected: PASS (all provider specs).

If `pnpm typecheck` reports that `Anthropic` is not assignable to `AnthropicMessagesClient` (overload variance), replace the return in `createAnthropicClient` with an explicit delegate:

```ts
  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl, timeout: config.timeoutMs, maxRetries: 0 });
  return { messages: { create: (params, options) => client.messages.create(params, options) } };
```

- [ ] **Step 10: Checkpoint**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: green (the `PipelineModule` from Task 9 now typechecks too).

---

### Task 11: Chat HTTP surface and end-to-end tests

**Files:**
- Create: `src/chat/chat.exceptions.ts`
- Create: `src/chat/gateway-exception.filter.ts`
- Create: `src/chat/chat.service.ts`
- Create: `src/chat/chat.controller.ts`
- Create: `src/chat/chat.module.ts`
- Modify: `src/app.module.ts`
- Test: `src/chat/chat.exceptions.spec.ts`
- Test: `test/chat.e2e.spec.ts`

- [ ] **Step 1: Write the failing exception unit test**

`src/chat/chat.exceptions.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RequestBlockedException } from './chat.exceptions.js';

describe('RequestBlockedException', () => {
  it('is 400 for inbound blocks and 502 for outbound blocks, with a client-safe body', () => {
    const inbound = new RequestBlockedException('inbound', 'injection', 'INJ-A1', 'req-1');
    const outbound = new RequestBlockedException('outbound', 'output', 'SECRET', 'req-2');

    expect(inbound.getStatus()).toBe(400);
    expect(inbound.getResponse()).toEqual({
      statusCode: 400,
      error: 'request_blocked',
      phase: 'inbound',
      stage: 'injection',
      reason: 'INJ-A1',
      requestId: 'req-1',
    });
    expect(outbound.getStatus()).toBe(502);
    expect(outbound.getResponse()).toMatchObject({ statusCode: 502, phase: 'outbound' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/chat/chat.exceptions.spec.ts`
Expected: FAIL — `Cannot find module './chat.exceptions.js'`.

- [ ] **Step 3: Implement exception and filter**

`src/chat/chat.exceptions.ts`:

```ts
import { HttpException, HttpStatus } from '@nestjs/common';
import type { StagePhase } from '../common/context/request-context.js';

/** A security stage blocked the request. Body never includes content or findings. */
export class RequestBlockedException extends HttpException {
  constructor(phase: StagePhase, stage: string, reason: string, requestId: string) {
    const statusCode = phase === 'inbound' ? HttpStatus.BAD_REQUEST : HttpStatus.BAD_GATEWAY;
    super({ statusCode, error: 'request_blocked', phase, stage, reason, requestId }, statusCode);
  }
}
```

`src/chat/gateway-exception.filter.ts`:

```ts
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { RequestContextService } from '../common/context/request-context.service.js';
import { PipelineStageError } from '../pipeline/pipeline.errors.js';
import { LlmProviderError } from '../providers/llm-provider.js';

/** Maps provider and pipeline failures to HTTP without leaking provider text. */
@Catch(LlmProviderError, PipelineStageError)
export class GatewayExceptionFilter implements ExceptionFilter<LlmProviderError | PipelineStageError> {
  private readonly logger = new Logger(GatewayExceptionFilter.name);

  constructor(private readonly contextService: RequestContextService) {}

  catch(exception: LlmProviderError | PipelineStageError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = this.contextService.tryGet()?.requestId ?? 'unknown';

    if (exception instanceof LlmProviderError) {
      const statusCode =
        exception.kind === 'timeout' ? HttpStatus.GATEWAY_TIMEOUT : HttpStatus.BAD_GATEWAY;
      const status = exception.status === undefined ? '' : ` (${exception.status})`;
      this.logger.error(`upstream ${exception.kind}${status} [${requestId}]`);
      response.status(statusCode).json({ statusCode, error: 'upstream_error', kind: exception.kind, requestId });
      return;
    }

    const statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    response.status(statusCode).json({ statusCode, error: 'pipeline_failure', stage: exception.stage, requestId });
  }
}
```

- [ ] **Step 4: Run the exception spec to verify it passes**

Run: `pnpm vitest run src/chat/chat.exceptions.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing e2e test**

`test/chat.e2e.spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { chatResponseSchema } from '../src/chat/chat.schemas.js';
import { stubEnv, validEnv } from '../src/config/env.fixture.js';
import { INBOUND_STAGES, type InboundStage } from '../src/pipeline/stage.js';
import { FakeLlmProvider } from '../src/providers/fake/fake.provider.js';
import { LLM_PROVIDER, LlmProviderError } from '../src/providers/llm-provider.js';

interface RunningApp {
  app: INestApplication;
  baseUrl: string;
}

async function bootApp(fake: FakeLlmProvider, inboundStages: InboundStage[] = []): Promise<RunningApp> {
  const { AppModule } = await import('../src/app.module.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LLM_PROVIDER)
    .useValue(fake)
    .overrideProvider(INBOUND_STAGES)
    .useValue(inboundStages)
    .compile();
  const app = moduleRef.createNestApplication({ bodyParser: false });
  await app.listen(0);
  return { app, baseUrl: await app.getUrl() };
}

function postChat(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/v1/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = { messages: [{ role: 'user', content: 'hello there' }] };
const errorBody = z.object({ statusCode: z.number(), error: z.string(), requestId: z.string() });

describe('POST /v1/chat (e2e)', () => {
  const fake = new FakeLlmProvider();
  let running: RunningApp;

  beforeAll(async () => {
    stubEnv(validEnv());
    running = await bootApp(fake);
  });

  afterEach(() => {
    fake.reset();
  });

  afterAll(async () => {
    await running.app.close();
    vi.unstubAllEnvs();
  });

  it('returns the provider reply with the request id in body and header', async () => {
    const response = await postChat(running.baseUrl, validBody);
    const body = chatResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.content).toBe('fake response');
    expect(body.model).toBe('claude-opus-5');
    expect(response.headers.get('x-request-id')).toBe(body.requestId);
    expect(fake.calls[0]).toMatchObject({ model: 'claude-opus-5', maxTokens: 1024 });
  });

  it('rejects an invalid body with 400 and never echoes it', async () => {
    const response = await postChat(running.baseUrl, {
      messages: [{ role: 'user', content: '' }],
      model: 'SMUGGLED-VALUE',
    });
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).toContain('messages.0.content');
    expect(text).not.toContain('SMUGGLED-VALUE');
    expect(fake.calls).toHaveLength(0);
  });

  it('maps upstream failures to 502 upstream_error', async () => {
    fake.enqueue(new LlmProviderError('rate_limited', 'slow down', { status: 429 }));

    const response = await postChat(running.baseUrl, validBody);
    const body = errorBody.extend({ kind: z.string() }).parse(await response.json());

    expect(response.status).toBe(502);
    expect(body).toMatchObject({ error: 'upstream_error', kind: 'rate_limited' });
    expect(response.headers.get('x-request-id')).toBe(body.requestId);
  });

  it('maps timeouts to 504', async () => {
    fake.enqueue(new LlmProviderError('timeout', 'too slow'));

    const response = await postChat(running.baseUrl, validBody);
    const body: unknown = await response.json();

    expect(response.status).toBe(504);
    expect(body).toMatchObject({ error: 'upstream_error', kind: 'timeout' });
  });
});

describe('POST /v1/chat with registered stages (e2e)', () => {
  beforeAll(() => {
    stubEnv(validEnv());
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('returns 400 request_blocked when an inbound stage blocks, without calling the provider', async () => {
    const fake = new FakeLlmProvider();
    const blocking: InboundStage = {
      name: 'test-block',
      run: () =>
        Promise.resolve({
          kind: 'block',
          reason: 'TEST-RULE',
          findings: [{ ruleId: 'TEST-RULE', category: 'test', matchedSegment: 'hello', confidence: 1 }],
        }),
    };
    const { app, baseUrl } = await bootApp(fake, [blocking]);

    try {
      const response = await postChat(baseUrl, validBody);
      const text = await response.text();
      const body: unknown = JSON.parse(text);

      expect(response.status).toBe(400);
      expect(body).toMatchObject({ error: 'request_blocked', stage: 'test-block', reason: 'TEST-RULE' });
      expect(text).not.toContain('matchedSegment');
      expect(fake.calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('returns 500 pipeline_failure when a stage throws (fail closed)', async () => {
    const fake = new FakeLlmProvider();
    const broken: InboundStage = {
      name: 'test-broken',
      run: () => Promise.reject(new Error('detector crashed')),
    };
    const { app, baseUrl } = await bootApp(fake, [broken]);

    try {
      const response = await postChat(baseUrl, validBody);
      const body: unknown = await response.json();

      expect(response.status).toBe(500);
      expect(body).toMatchObject({ error: 'pipeline_failure', stage: 'test-broken' });
      expect(fake.calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run test/chat.e2e.spec.ts`
Expected: FAIL — 404 on `/v1/chat` (or missing `INBOUND_STAGES` provider to override).

- [ ] **Step 7: Implement service, controller, module**

`src/chat/chat.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { RequestContextService } from '../common/context/request-context.service.js';
import { GatewayPipeline } from '../pipeline/gateway-pipeline.js';
import { RequestBlockedException } from './chat.exceptions.js';
import { chatResponseSchema, type ChatRequest, type ChatResponse } from './chat.schemas.js';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly pipeline: GatewayPipeline,
    private readonly contextService: RequestContextService,
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const context = this.contextService.get();
    const { requestId } = context;
    const result = await this.pipeline.run(request);

    if (result.kind === 'blocked') {
      throw new RequestBlockedException(result.phase, result.stage, result.reason, requestId);
    }

    const { response } = result;
    const exec = context.exec;
    this.logger.log(
      `completed [${requestId}] provider=${exec?.provider ?? 'unknown'} model=${response.model} latencyMs=${exec?.latencyMs ?? 0} in=${response.usage.inputTokens} out=${response.usage.outputTokens}`,
    );
    // Parsed through the strict contract so no internal field can ever leak into a 200 body.
    return chatResponseSchema.parse({
      requestId,
      content: response.content,
      model: response.model,
      stopReason: response.stopReason,
      usage: response.usage,
    });
  }
}
```

`src/chat/chat.controller.ts`:

```ts
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { chatRequestSchema, type ChatRequest, type ChatResponse } from './chat.schemas.js';
import { ChatService } from './chat.service.js';

@Controller('v1/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /** Body validated by the global StandardSchemaValidationPipe against chatRequestSchema. */
  @Post()
  @HttpCode(HttpStatus.OK)
  chat(@Body({ schema: chatRequestSchema }) request: ChatRequest): Promise<ChatResponse> {
    return this.chatService.chat(request);
  }
}
```

`src/chat/chat.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { PipelineModule } from '../pipeline/pipeline.module.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { GatewayExceptionFilter } from './gateway-exception.filter.js';

@Module({
  imports: [PipelineModule],
  controllers: [ChatController],
  providers: [ChatService, { provide: APP_FILTER, useClass: GatewayExceptionFilter }],
})
export class ChatModule {}
```

Replace `src/app.module.ts` with:

```ts
import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import express from 'express';
import { ChatModule } from './chat/chat.module.js';
import { RequestContextMiddleware } from './common/context/request-context.middleware.js';
import { RequestContextModule } from './common/context/request-context.module.js';
import { AppConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';

/**
 * JSON body cap. The chat contract allows 64 messages of 32k chars plus a 32k system prompt;
 * at up to 4 UTF-8 bytes per character that is about 8.3 MB, so 10mb leaves headroom for
 * JSON escaping. Larger bodies are rejected with 413 before any handler runs.
 */
export const JSON_BODY_LIMIT = '10mb';

@Module({
  imports: [AppConfigModule.forRoot(), RequestContextModule, HealthModule, ChatModule],
  providers: [{ provide: APP_PIPE, useClass: StandardSchemaValidationPipe }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Order is load-bearing: the request context must exist before the body is parsed, so
    // 400/413 parse failures still carry x-request-id and can be audited. Nest's built-in
    // parser is therefore disabled (`bodyParser: false`) in main.ts and in test bootstraps,
    // and RequestContextMiddleware must stay first as more middleware is added.
    consumer
      .apply(RequestContextMiddleware, express.json({ limit: JSON_BODY_LIMIT }))
      .forRoutes('{*path}');
  }
}
```

(`JSON_BODY_LIMIT`, the `express.json` registration, and `bodyParser: false` in `src/main.ts` already exist from the Task 4 follow-up; keep them.)

- [ ] **Step 8: Run the e2e spec to verify it passes**

Run: `pnpm vitest run test/chat.e2e.spec.ts`
Expected: PASS (6 tests). If the 400 body lacks `messages.0.content`, confirm `StandardSchemaValidationPipe` is registered via `APP_PIPE` and the parameter uses `@Body({ schema })`.

- [ ] **Step 9: Checkpoint**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: green; `dist/chat/`, `dist/pipeline/`, `dist/providers/` present.

---

### Task 12: Documentation and final verification

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md` (owner approves the edit first)

- [ ] **Step 1: README — API section**

Insert after "## Setup":

````markdown
## API

`POST /v1/chat` — one completion through the security pipeline. No auth yet (see Known limitations).

```bash
curl -s http://localhost:3000/v1/chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Say hello"}],"maxTokens":64}'
```

Request: `{ messages: [{ role: 'user' | 'assistant', content }], system?, maxTokens? }`
(strict: unknown keys are rejected; the first message must be from `user`; the model is fixed by
`LLM_MODEL`; there is no `temperature`, current Claude models reject it). Response: `{ requestId, content, model, stopReason, usage: { inputTokens, outputTokens } }`.
Every response carries an `x-request-id` header, including body-parse failures: JSON bodies are
capped at 10 MB (`JSON_BODY_LIMIT`) and larger ones are rejected with 413.

| Situation | Status | Body `error` |
| --- | --- | --- |
| Body is not valid JSON | 400 | `invalid_body` |
| Body over 10 MB | 413 | `body_too_large` |
| Body fails the schema | 400 | Nest validation message list |
| An inbound stage blocks | 400 | `request_blocked` (+ `phase`, `stage`, `reason`) |
| An outbound stage blocks | 502 | `request_blocked` |
| Provider timeout | 504 | `upstream_error` (`kind: timeout`) |
| Other provider failure | 502 | `upstream_error` (+ `kind`) |
| A stage threw | 500 | `pipeline_failure` (+ `stage`) |
| Anything else | 500 | `internal_error` |

Every error body carries `requestId`; none carries message content, findings, or provider text.
````

- [ ] **Step 2: README — Known limitations**

Append to the list:

```markdown
- `POST /v1/chat` has no authentication or rate limiting yet. Do not expose it beyond localhost.
- No security stages are registered yet; the pipeline runs inbound → provider → outbound with empty stage lists.
- Only the Anthropic adapter exists. `LLM_PROVIDER=openai` fails at boot with "OpenAI adapter not implemented".
- Stage and provider outcomes are recorded in the request context only; nothing is persisted until the audit spec lands.
- The Anthropic SDK merges `ANTHROPIC_CUSTOM_HEADERS` from the process environment into every request; that variable cannot be pinned from the client constructor, so do not set it in production environments.
```

- [ ] **Step 3: CLAUDE.md — proposed edit (apply only after the owner approves)**

Replace items 3–5 of "Control → Nest seam" and the request pipeline diagram with:

```markdown
3. injection         InboundStage → InjectionDetector over a rule registry (multi-provider)
4. PII               InboundStage → detector strategies + Tokenizer + VaultRepository
5. output validation OutboundStage, reads inbound findings from the request context
```

```
ApiKeyGuard → RateLimitGuard → StandardSchemaValidationPipe(chatRequestSchema) → AuditInterceptor(open)
  → GatewayPipeline: INBOUND_STAGE_ORDER (canonicalise → injection → PII/tokenise)
  → LlmExecutor → LlmProvider adapter
  → OUTBOUND_STAGE_ORDER (output validation) → (block 502 | return)
  → AuditInterceptor(finalise)
```

And add under "Architecture":

```markdown
### Pipeline

`src/pipeline/` runs ordered `InboundStage`s, then `LlmExecutor`, then `OutboundStage`s.
A stage returns `pass | transform(value) | block(reason, findings)`; every verdict is timed and
appended to `RequestContext.stages`. A throwing stage fails closed (500). To add a control:
implement the stage as an `@Injectable` class in its own module directory and append it to
`INBOUND_STAGE_ORDER` / `OUTBOUND_STAGE_ORDER` in `src/pipeline/pipeline.module.ts`.
Providers implement `LlmProviderAdapter` (convert → send → parse → convert) with pure
conversions in a codec file; `FakeLlmProvider` is for tests only.
```

- [ ] **Step 4: Full verification**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 5: Smoke (optional, real network)**

With `.env.local` holding a placeholder `ANTHROPIC_API_KEY`, start `pnpm start:local` and run the curl from Step 1. Expected: HTTP 502 with `{"error":"upstream_error","kind":"auth",...}` and a log line `upstream auth (401) [<uuid>]` — proves the real adapter, the error table and the filter without a paid key. With a real key the same call returns 200 and the model's reply.

- [ ] **Step 6: Checkpoint**

Stop. The owner reviews `git status`, commits, and logs the session in `PROMPTS.md`.
