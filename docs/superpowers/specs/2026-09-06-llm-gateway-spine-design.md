# LLM Gateway Spine — Design

Date: 2026-09-06
Status: approved in brainstorming session; implementation plan pending

## 1. Goal

Build the provider-agnostic core that every later security control plugs into:

- `POST /v1/chat` with a gateway-owned request/response contract.
- A per-request context (AsyncLocalStorage) that records what every layer decided.
- An explicit, ordered stage pipeline (inbound → provider exec → outbound) where adding a
  control is one class plus one array entry, and every stage verdict is recorded uniformly.
- A provider port (`LlmProvider`) with an adapter base class that forces each provider to
  implement request conversion, response parsing/conversion, and error translation.
- One real adapter (Anthropic) and one fake adapter for tests.

## 2. Non-goals (each is its own later spec)

Canonicalisation, prompt-injection detection, PII detection/tokenisation/vault, output
validation rules, API-key auth and roles, rate limiting, audit persistence (Mongo sink,
interceptor, `GET /v1/audit`), the OpenAI adapter, Mongo/Redis connection modules, streaming,
retries/backoff, cost accounting.

The spine ships with **zero stages registered** and **no guards** on `/v1/chat`. Until the
auth and rate-limit specs land, the endpoint is an open proxy to the configured provider key
and must not be exposed beyond localhost. README "Known limitations" states this.

## 3. Constraints carried from CLAUDE.md

- Every stage is a plain service with pure methods; Nest wrappers are thin.
- Detection results are identities (`{ ruleId, category, matchedSegment, confidence }`), never booleans.
- Request context is AsyncLocalStorage, never `Scope.REQUEST`.
- Output validation later needs inbound findings; they are threaded through the context now.
- No `any`, no assertions, no `!`. External shapes (LLM responses, request bodies) are parsed with Zod.
- Never log message content, tokens, or resolved PII.

Deviation agreed in this session: injection and PII become **pipeline stages** run by
`GatewayPipeline` inside `ChatService`, not Nest `Pipe`s on `@Body()`; body validation uses
Nest 12's built-in `StandardSchemaValidationPipe` with a Zod schema instead of a custom
`ZodValidationPipe`. CLAUDE.md is updated accordingly after implementation (section 11).

## 4. Architecture

```
HTTP ─▶ RequestContextMiddleware (ALS store, x-request-id)
     ─▶ [guards: later specs]
     ─▶ StandardSchemaValidationPipe(@Body({ schema: chatRequestSchema }))  → 400
     ─▶ ChatController.chat()
        └▶ ChatService.chat(request)
           └▶ GatewayPipeline.run(request)
              ├▶ INBOUND_STAGES[] in order   pass | transform | block(400)
              ├▶ LlmExecutor.complete()      ChatRequest→LlmRequest, timeout, ExecOutcome
              │   └▶ LlmProvider (adapter)   LlmRequest→native→raw→parsed→LlmResponse
              └▶ OUTBOUND_STAGES[] in order  pass | transform | block(502)
     ◀─ ChatResponse | error body (blocked / upstream_error / pipeline_failure)
```

Every stage and the exec step append an outcome to the request context. The audit spec later
persists that context; nothing in the spine writes to a database.

## 5. Components

### 5.1 Chat contract — `src/chat/chat.schemas.ts`

Zod schemas, `.strict()` (unknown keys rejected so callers cannot smuggle provider params).

```
ChatMessage  { role: 'user' | 'assistant', content: string 1..32_000 chars }
ChatRequest  { messages: ChatMessage[] 1..64, first role must be 'user',
               system?: string 1..32_000, maxTokens?: int 1..8192 }
               (no `temperature`: models after Claude Opus 4.6 reject any value but 1.0)
ChatResponse { requestId: string, content: string, model: string,
               stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'other',
               usage: { inputTokens: int, outputTokens: int } }
```

The model is never caller-chosen; it comes from `LlmConfig`. `MAX_MESSAGES` and
`MAX_CONTENT_CHARS` are named constants in the schema file; `MAX_OUTPUT_TOKENS` (8192) is
defined once in `llm.config.ts` and imported by the schema, because the env default
`LLM_MAX_OUTPUT_TOKENS` must respect the same bound.

### 5.2 Request context — `src/common/context/`

```
RequestContext {
  requestId: string           // crypto.randomUUID(); incoming x-request-id is ignored
  startedAt: number           // performance.now()
  principal?: { apiKeyId: string; roles: readonly string[] }   // written by ApiKeyGuard later
  stages: StageOutcome[]      // appended by GatewayPipeline
  exec?: ExecOutcome          // written by LlmExecutor
}
StageOutcome { stage: string; phase: 'inbound' | 'outbound';
               verdict: 'pass' | 'transform' | 'block' | 'error';
               reason?: string; findings: Finding[]; durationMs: number }
Finding      { ruleId: string; category: string; matchedSegment: string; confidence: number }
ExecOutcome  { provider: string; model: string; latencyMs: number;
               usage?: { inputTokens: number; outputTokens: number }; errorKind?: LlmProviderErrorKind }
```

- `RequestContextService`: `run(ctx, fn)`, `get()` (throws `RequestContextMissingError`
  outside a request), `tryGet()`.
- `RequestContextMiddleware` (all routes, registered in `AppModule.configure`): creates the
  context, sets the `x-request-id` response header. Middleware rather than interceptor so
  guards can write `principal`.
- Body parsing happens inside the context: Nest's built-in parser is disabled
  (`bodyParser: false` in `main.ts` and test bootstraps) and `express.json({ limit:
  JSON_BODY_LIMIT })` is registered right after the middleware, so 400/413 parse failures
  still carry `x-request-id` and can be audited. `JSON_BODY_LIMIT` is 10 MB, derived from
  the contract caps (64 × 32k chars + 32k system at 4 bytes per char).
- `Finding` lives here because both inbound and outbound stages produce them and the output
  validation spec reads inbound findings from `ctx.stages`.

### 5.3 Pipeline — `src/pipeline/`

```ts
interface InboundStage  { readonly name: string;
                          run(input: InboundInput, ctx: RequestContext): Promise<StageVerdict<InboundInput>>; }
interface OutboundStage { readonly name: string;
                          run(input: OutboundInput, ctx: RequestContext): Promise<StageVerdict<OutboundInput>>; }

InboundInput  { request: ChatRequest }                      // later specs add optional fields (e.g. canonical)
OutboundInput { request: ChatRequest; response: LlmResponse }

type StageVerdict<T> =
  | { kind: 'pass';      findings?: Finding[] }
  | { kind: 'transform'; value: T; findings?: Finding[] }
  | { kind: 'block';     reason: string; findings: Finding[] };
```

- Registration: `INBOUND_STAGES` / `OUTBOUND_STAGES` symbol tokens, provided in
  `PipelineModule` as arrays built from ordered class lists `INBOUND_STAGE_ORDER` /
  `OUTBOUND_STAGE_ORDER` (both empty in this spec). Adding a layer = one stage class + one
  entry in the order list. Order lives in exactly one place.
- `GatewayPipeline.run(request): Promise<PipelineResult>`
  - `PipelineResult = { kind: 'completed'; response: LlmResponse; request: ChatRequest }
                    | { kind: 'blocked'; phase: 'inbound' | 'outbound'; stage: string; reason: string }`
  - Inbound stages run in order. `transform` replaces the input for the following stages.
    `block` short-circuits: later stages and the provider are never called.
  - Exec via `LlmExecutor`; provider errors propagate as `LlmProviderError`.
  - Outbound stages run in order over `{ request, response }` with the same semantics;
    `transform` replaces the response returned to the caller.
  - Every stage is timed and appended to `ctx.stages` with its verdict and findings.
  - **Fail closed:** a stage that throws is recorded as `verdict: 'error'` and the runner
    throws `PipelineStageError(stage)`; the provider is not called (inbound) or the response
    is not returned (outbound).
- Alternatives rejected: `next()` middleware chain (verdicts implicit, audit non-uniform),
  RxJS operator pipeline (overkill for a linear, short-circuiting sequence).

### 5.4 Exec layer and provider port — `src/providers/`

Two conversion levels with different owners:

1. Gateway level, once: `LlmExecutor` builds `LlmRequest` from `ChatRequest` + `LlmConfig`
   (`model`, `maxTokens ?? LLM_MAX_OUTPUT_TOKENS`, `temperature`, `system`, `messages`).
2. Provider level, enforced per adapter by the base class below.

```ts
LlmRequest  { readonly model: string; readonly system?: string; readonly messages: readonly LlmMessage[]; readonly maxTokens: number }
LlmResponse { content: string; model: string; stopReason: StopReason; usage: { inputTokens: number; outputTokens: number } }

interface LlmProvider { readonly name: LlmProviderName;
                        complete(request: LlmRequest, options: { signal: AbortSignal }): Promise<LlmResponse>; }
const LLM_PROVIDER = Symbol('LLM_PROVIDER');

class LlmProviderError extends Error {
  kind: 'timeout' | 'rate_limited' | 'auth' | 'bad_request' | 'bad_response' | 'network' | 'upstream';
  retryable: boolean;      // timeout, rate_limited, network, upstream → true; others → false
  status?: number;         // upstream HTTP status when known
}
```

- `LlmExecutor.complete(request: ChatRequest): Promise<LlmResponse>`: builds `LlmRequest`,
  calls the provider with `AbortSignal.timeout(cfg.timeoutMs)` and races it against the same
  deadline, so the timeout is a hard latency ceiling even for an adapter that ignores the
  signal (the abandoned call is not cancelled, only ignored). Converts any
  non-`LlmProviderError` throw into `timeout` (if the deadline passed) or `upstream`, and
  records `ExecOutcome` (latency, usage or errorKind). `ExecOutcome` is a single slot: if a
  retry layer is ever added, only the last attempt is recorded there.
- `LlmProviderAdapter<TRequest, TResponse>` — abstract base implementing `LlmProvider`.
  `complete()` is a fixed template: `toProviderRequest` → `send` (raw, `unknown`) →
  `parseProviderResponse` (Zod; failure = `bad_response`) → `toLlmResponse`; any throw from
  `send` goes through `toProviderError`. A new provider must implement all five abstract
  methods; the type system enforces the conversions.
- Pure conversions live in a codec module per provider (`anthropic.codec.ts`:
  `toAnthropicRequest`, `anthropicResponseSchema`, `fromAnthropicResponse`,
  `toAnthropicError`). Adapter methods delegate to them, so codecs are unit-tested directly
  and the adapter test covers only wiring.
- `AnthropicProvider` (`@anthropic-ai/sdk` 0.124.x, peer zod ^4):
  - Client built by `createAnthropicClient(config)` inside `createLlmProvider` and passed to
    `AnthropicProvider`'s constructor (tests pass a stub exposing `messages.create`). Every
    knob the SDK would otherwise read from the environment is pinned: `logLevel: 'off'` (at
    `debug` the SDK logs request bodies and would honour `ANTHROPIC_LOG`), `baseURL` always
    explicit (never `ANTHROPIC_BASE_URL`), `timeout: timeoutMs`, `maxRetries: 0` so the
    executor deadline is the single timing authority. The SDK still merges
    `ANTHROPIC_CUSTOM_HEADERS` from the environment; recorded in README Known limitations.
  - Request: `messages.create({ model, max_tokens, system?, messages }, { signal })`.
  - Response schema (defensive, SDK output treated as `unknown`): `model: string`,
    `content: { type: string; text?: string }[]`, `stop_reason: string | null`,
    `usage: { input_tokens: number; output_tokens: number }`. `content` = text blocks joined in
    order; `stop_reason` maps `end_turn` / `max_tokens` / `stop_sequence`, anything else → `other`.
  - Error table: SDK `APIError` status 400/404/413 → `bad_request`, 401/403 → `auth`,
    429 → `rate_limited`, 5xx incl. 529 → `upstream`; `APIConnectionTimeoutError` or an aborted
    signal → `timeout`; `APIConnectionError` → `network`; schema failure → `bad_response`;
    anything else → `upstream`. The provider's own error text is never returned and never
    logged at `error`: the filter logs `kind`, `status` and the request id, and emits the
    cause's class name and message at `debug` only (off at the default `LOG_LEVEL`).
- `FakeLlmProvider` (`src/providers/fake/`): implements `LlmProvider` directly.
  `enqueue(LlmResponse | LlmProviderError)`, `calls: LlmRequest[]`, default reply when the
  queue is empty, honours `signal` for timeout tests. Used via
  `Test.createTestingModule().overrideProvider(LLM_PROVIDER)`. Not selectable through env, so
  production cannot silently run against a fake.
- `ProvidersModule`: `LLM_PROVIDER` factory over `LlmConfig.provider` — `anthropic` →
  `AnthropicProvider`; `openai` → boot fails with "OpenAI adapter not implemented" until that spec lands.

### 5.5 HTTP surface — `src/chat/`

- `ChatController`: `@Controller('v1/chat')`, `@Post()`, `@Body({ schema: chatRequestSchema })`.
  `StandardSchemaValidationPipe` registered globally via `APP_PIPE` in `AppModule`.
- `ChatService.chat(request)`: runs the pipeline, maps `blocked` to `RequestBlockedException`,
  builds `ChatResponse` with `requestId` from the context.
- Error responses. Every response carries the `x-request-id` header (middleware). Bodies
  produced by the gateway's own filter and exceptions include `requestId`; the schema-validation
  400 keeps Nest's default body. No error body ever includes message content, findings, or
  provider text:

| Case | Status | Body |
| --- | --- | --- |
| Body is not valid JSON | 400 | `{ statusCode, error: 'invalid_body', requestId }` (body-parser's own message, which echoes a prefix of the raw body, is never used) |
| Body over `JSON_BODY_LIMIT` | 413 | `{ statusCode, error: 'body_too_large', requestId }` |
| Body fails schema | 400 | Nest `BadRequestException` with `path: message` list |
| Inbound stage block | 400 | `{ statusCode, error: 'request_blocked', phase, stage, reason, requestId }` |
| Outbound stage block | 502 | same shape |
| `LlmProviderError` kind `timeout` | 504 | `{ statusCode, error: 'upstream_error', kind, requestId }` |
| any other `LlmProviderError` | 502 | same shape |
| `PipelineStageError` (stage threw) | 500 | `{ statusCode, error: 'pipeline_failure', stage, requestId }` |
| anything else | 500 | `{ statusCode, error: 'internal_error', requestId }` |

`RequestBlockedException extends HttpException`. `GatewayExceptionFilter` is a `@Catch()`
boundary registered via `APP_FILTER`: `HttpException`s are delegated to Nest's base filter,
`LlmProviderError`/`PipelineStageError` get the bodies above, and any other throw becomes
`internal_error` (logged as class name + request id only; stack at `debug`). Body parsing runs
through `JsonBodyMiddleware`, which wraps `express.json` and maps its failures to the first two
rows. `X-Powered-By` is disabled. Provider-supplied `model` ids are constrained by
`llmModelSchema` (printable, ≤128 chars) because they are interpolated into log lines.

### 5.6 Configuration change

`LLM_MAX_OUTPUT_TOKENS` (int, `1..MAX_OUTPUT_TOKENS`, default `1024`) added to
`llm.config.ts`, `.env.example`, and the README table. Reason: the Anthropic API requires
`max_tokens`; the contract's `maxTokens` is optional. Bounded by the same cap as the request
contract so a misconfigured default fails at boot instead of on every request.

## 6. Logging and privacy

- `warn` on block: stage, reason, requestId. `error` on provider failure: kind, status, requestId.
  `log` on completion: requestId, provider, model, latencyMs, token usage.
- Never: message content, system prompt, findings' `matchedSegment`, provider error message
  bodies at levels above `debug`, API keys.
- `x-request-id` is always generated server-side; a client-supplied header is ignored.

## 7. Testing (no network anywhere)

- `chat.schemas.spec`: accepts minimal request; rejects empty `messages`, first role not
  `user`, unknown role, unknown top-level key, oversize content, `temperature` out of range,
  non-integer `maxTokens`.
- `request-context.spec`: isolation across concurrent `run()` flows; `get()` throws outside.
- `gateway-pipeline.spec` with in-test stub stages: execution order; transform chaining;
  inbound block skips exec and outbound; outbound block; outcomes recorded (name, verdict,
  findings, duration); stage throw → `error` outcome, `PipelineStageError`, exec not called;
  exec error propagates with `ExecOutcome.errorKind` set.
- `llm-executor.spec`: `LlmRequest` mapping and defaults; timeout → `LlmProviderError('timeout')`
  using a fake that waits on the signal; unknown throw → `upstream`; outcome recorded.
- `anthropic.codec.spec`: request mapping (system, max_tokens, temperature, message order);
  multi-block text join; stop-reason mapping; malformed response → `bad_response`; full error table.
- `anthropic.provider.spec`: stub client receives mapped request and signal; wiring only.
- `fake.provider.spec`: queue order, default reply, call recording.
- `chat.e2e.spec` on `AppModule` with `overrideProvider(LLM_PROVIDER)`: 200 with
  `x-request-id` header and body `requestId`; 400 on invalid body without echoing content;
  502 on upstream error; 504 on timeout; `INBOUND_STAGES` overridden with a blocking stage →
  400 `request_blocked` (proves the wiring, not just the runner).

## 8. Module layout

```
src/
  common/context/   request-context.ts (types)  request-context.service.ts
                    request-context.middleware.ts  request-context.module.ts
  chat/             chat.schemas.ts  chat.controller.ts  chat.service.ts
                    chat.exceptions.ts  gateway-exception.filter.ts  chat.module.ts
  pipeline/         stage.ts  gateway-pipeline.ts  pipeline.errors.ts  pipeline.module.ts
  providers/        llm-provider.ts (port, schemas, error)  llm-provider.adapter.ts (base class)
                    llm-executor.ts  providers.module.ts
                    anthropic/  anthropic.codec.ts  anthropic.provider.ts  anthropic.client.ts
                    fake/       fake.provider.ts
```

## 9. Dependencies added

`@anthropic-ai/sdk` (runtime) and `express` as a direct runtime dependency (it was only
transitive via `@nestjs/platform-express`; `AppModule` imports `express.json` for the
in-context body parser). Nothing else.

## 10. Follow-up specs (in suggested order)

1. Canonicalisation stage + `CanonicalService` (`src/common/canonical/`).
2. Injection detection stage + rule registry + corpus tests (`INJ-*`).
3. PII detection stage + tokenizer + vault (`PII-*`). Note: this is the first stage that
   does I/O inside `runStage` (vault write); the pipeline has no per-stage deadline, so that
   spec must bound the Mongo call itself.
4. Output validation stage (secret shapes, injection echo from inbound findings).
5. `ApiKeyGuard` + roles.
6. `RateLimitGuard` + Redis.
7. Audit interceptor + Mongo sink + `GET /v1/audit`.
8. OpenAI adapter.
9. Mongo/Redis connection modules and dependency health checks.

## 11. Documentation updates after implementation

- CLAUDE.md: control → seam list (items 3, 4, 5 become pipeline stages run by
  `GatewayPipeline`; body validation is `StandardSchemaValidationPipe` + Zod schema), request
  pipeline diagram, and a short "Pipeline" section describing stages, verdicts, and how to add one.
- README: `LLM_MAX_OUTPUT_TOKENS` row; Known limitations gains "no auth or rate limiting on
  `/v1/chat` yet, do not expose beyond localhost", "OpenAI adapter pending", "no stages registered".
