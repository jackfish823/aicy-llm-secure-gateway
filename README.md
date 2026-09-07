# SecureLLM Gateway

NestJS service that sits between internal application code and external LLM providers.
Every LLM call in the org routes through it. The gateway enforces auth, rate limiting,
prompt-injection detection, inbound PII redaction, outbound response validation, and an
audit trail.

## Requirements

- Node 24+ and pnpm 9+
- Docker (Mongo and Redis for local development)

## Setup

```bash
pnpm install
cp .env.example .env.local   # then replace the placeholder values
docker compose up -d         # mongo + redis; the gateway connects to Mongo at boot
pnpm keys:create --name dev --role client   # prints the key once
pnpm start:local
curl http://localhost:3000/healthz
```

## API

`POST /v1/chat` — one completion through the security pipeline.

Every route except `GET /healthz` requires an `x-api-key` header. Keys have a role: `client`
may call `POST /v1/chat`; `admin` may also call routes marked `@Admin()` (none yet). Mint one
with `pnpm keys:create --name <label> --role <admin|client>`; the key is printed once and only
its HMAC-SHA256 (keyed with `AUTH_API_KEY_PEPPER`) is stored in the `api_keys` collection.
Revoke a key by deleting its document.

```bash
curl -s http://localhost:3000/v1/chat \
  -H 'content-type: application/json' \
  -H 'x-api-key: sk_...' \
  -d '{"messages":[{"role":"user","content":"Say hello"}],"maxTokens":64}'
```

Request: `{ messages: [{ role: 'user' | 'assistant', content }], system?, maxTokens? }`
(strict: unknown keys are rejected; the first message must be from `user`; the model is fixed by
`LLM_MODEL`; there is no `temperature`, current Claude models reject it).
Response: `{ requestId, content, model, stopReason, usage: { inputTokens, outputTokens } }`.
Every response carries an `x-request-id` header, including body-parse failures: JSON bodies are
capped at 10 MB (`JSON_BODY_LIMIT`) and larger ones are rejected with 413.

| Situation                | Status | Body `error`                                      |
| ------------------------ | ------ | ------------------------------------------------- |
| No or unknown `x-api-key`| 401    | `unauthorized`                                    |
| Key lacks required role  | 403    | `forbidden`                                       |
| Body is not valid JSON   | 400    | `invalid_body`                                    |
| Body over 10 MB          | 413    | `body_too_large`                                  |
| Body fails the schema    | 400    | Nest validation message list                      |
| An inbound stage blocks  | 400    | `request_blocked` (+ `phase`, `stage`, `reason`)  |
| An outbound stage blocks | 502    | `request_blocked`                                 |
| Provider timeout         | 504    | `upstream_error` (`kind: timeout`)                |
| Other provider failure   | 502    | `upstream_error` (+ `kind`)                       |
| A stage threw            | 500    | `pipeline_failure` (+ `stage`)                    |
| Anything else            | 500    | `internal_error`                                  |

Every error body carries `requestId`; none carries message content, findings, or provider text.

## Scripts

| Script                         | What it does                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `pnpm start:local`             | `NODE_ENV=development`, watch mode, loads `.env.local` then `.env` (process env wins)  |
| `pnpm start:debug`             | Same as `start:local` with the Node inspector attached                                |
| `pnpm build` + `pnpm start`    | Compile to `dist/`, then run with `NODE_ENV=production` from the process environment  |
| `pnpm test` / `test:watch`     | Vitest unit + e2e suites                                                              |
| `pnpm test:cov`                | Vitest with V8 coverage                                                               |
| `pnpm test:corpus`             | Corpus suite only (spec files matching `corpus`; none exist yet)                      |
| `pnpm lint` / `lint:fix`       | ESLint with type-aware rules: no `any`, no type assertions, no non-null assertions    |
| `pnpm typecheck`               | `tsc --noEmit` over `src/`, `test/` and the tooling configs                           |
| `pnpm format` / `format:check` | Prettier over sources and root config files                                           |
| `pnpm verify:corpus`           | Checks the adversarial corpus is complete and well-formed without printing any payload |

## Configuration

All configuration comes from environment variables. The full set is validated once at boot
with Zod (`src/config/env.schema.ts`); a bad environment fails fast with every offending
variable named and no values printed. Each domain owns a typed factory in
`src/config/domains/`. Inject one with `@Inject(redisConfig.KEY)` typed as
`ConfigType<typeof redisConfig>`, or read raw validated variables through
`ConfigService<Env, true>`.

| Variable               | Required                      | Default       | Notes                                                         |
| ---------------------- | ----------------------------- | ------------- | ------------------------------------------------------------- |
| `NODE_ENV`             | no                            | `development` | `development` \| `test` \| `production`; selects dotenv files |
| `PORT`                 | no                            | `3000`        | 1-65535                                                       |
| `LOG_LEVEL`            | no                            | `log`         | `fatal` \| `error` \| `warn` \| `log` \| `debug` \| `verbose` |
| `LOG_PRETTY`           | no                            | `false`       | Human-readable lines (`start:local` sets `true`); JSON otherwise |
| `MONGO_URI`            | yes                           |               | `mongodb://` or `mongodb+srv://`, database name included      |
| `REDIS_URL`            | yes                           |               | `redis://` or `rediss://`                                     |
| `REDIS_KEY_PREFIX`     | no                            | `sllm:`       | Prefix for every key the gateway writes                       |
| `LLM_PROVIDER`         | yes                           |               | `anthropic` \| `openai`                                       |
| `LLM_MODEL`            | yes                           |               | Model id sent to the provider                                 |
| `LLM_TIMEOUT_MS`       | no                            | `30000`       | Positive integer                                              |
| `LLM_MAX_OUTPUT_TOKENS`| no                            | `1024`        | Default `max_tokens`, 1-8192; request `maxTokens` wins        |
| `LLM_BASE_URL`         | no                            |               | Optional proxy URL; empty means unset                         |
| `ANTHROPIC_API_KEY`    | when `LLM_PROVIDER=anthropic` |               |                                                               |
| `OPENAI_API_KEY`       | when `LLM_PROVIDER=openai`    |               |                                                               |
| `AUTH_API_KEY_PEPPER`  | yes                           |               | ≥32 chars; HMAC key for stored API key hashes. Changing it invalidates every key |
| `PII_TOKEN_KEY`        | yes                           |               | 32 bytes as 64 hex characters (AES-256-GCM)                   |
| `RATE_LIMIT_WINDOW_MS` | no                            | `60000`       | Positive integer                                              |
| `RATE_LIMIT_MAX`       | no                            | `60`          | Requests per key per window                                   |

Dotenv files by `NODE_ENV`: `development` loads `.env.local` then `.env` (first match
wins, real environment variables override both); `test` loads `.env.test`; `production`
loads nothing. `.env.example` is the committed template; `.env` and `.env.local` are
gitignored.

## Testing

Vitest. Security modules are unit-tested by calling the service directly. The
adversarial corpus under `test/fixtures/corpus/` is loaded by ID at runtime and never
inlined in test code; see `CLAUDE.md` for the rules around it.

## Pipeline

`src/pipeline/` runs ordered inbound stages, then the provider call (`LlmExecutor`, which owns
the timeout), then ordered outbound stages. A stage returns `pass | transform(value) |
block(reason, findings)`; every verdict is timed and appended to the request context
(`RequestContext.stages`), and a throwing stage fails closed with a 500. To add a security
control: implement `InboundStage` or `OutboundStage` as an `@Injectable` class and append it to
`INBOUND_STAGE_ORDER` / `OUTBOUND_STAGE_ORDER` in `src/pipeline/pipeline.module.ts`.
Providers implement `LlmProviderAdapter` (convert → send → parse → convert → validate) with the
pure conversions in a codec file (`src/providers/anthropic/anthropic.codec.ts`);
`FakeLlmProvider` is for tests only and is excluded from the production build.

## Auth

`src/security/auth/`. `ApiKeyGuard` is a global guard registered by `AuthModule`: routes are
protected unless decorated `@Public()`, and `@Admin()` requires the `admin` role. On success the
guard sets `RequestContext.principal` (`{ apiKeyId, roles }`) for later stages and audit.
Rejections log `auth.rejected` with a `reason` (`missing` | `invalid` | `forbidden`) and never
the key. Tests boot the app through `withoutMongo()` from `api-key.fixture.ts`; nothing in the
suite connects to Mongo.

## Logging

Pino, JSON to stdout (pretty in `start:local`). Use Nest's `Logger` as usual; pass a human
message plus a flat fields object with an `event` in `resource.action` form:

```ts
private readonly logger = new Logger(ChatService.name);
this.logger.log('Chat completed', { event: 'chat.completed', model, latencyMs });
```

Each line becomes `{ level, time, app, context, msg, requestId, event, ...fields }`; `context`
(the class name) and `requestId` are injected automatically. Levels: `log` for normal
operations, `warn` for handled anomalies (a stage blocked a request), `error` for failures,
`debug` for detail that may include provider error text (off at the default `LOG_LEVEL`).
Never put message content, findings, or keys in a field; `apiKey`, `content`,
`matchedSegment`, `messages`, `system` and `authorization` are redacted as a backstop.
Logs are operational only: the audit trail is a separate per-request record and nothing is
copied from one to the other.

## Known limitations

- Out of scope for now: semantic/model-based injection classification, multi-tenant key
  rotation, streaming responses, token-level cost accounting.
- The gateway container is not part of `docker-compose.yml` yet; run it on the host.
- `GET /healthz` is liveness only. It does not check Mongo or Redis.
- `POST /v1/chat` has no rate limiting yet.
- API keys have no expiry or rotation; revoke by deleting the document.
- No security stages are registered yet; the pipeline runs inbound → provider → outbound with empty stage lists.
- Only the Anthropic adapter exists. `LLM_PROVIDER=openai` fails at boot with "OpenAI adapter not implemented".
- Stage and provider outcomes are recorded in the request context only; nothing is persisted until the audit spec lands.
- The Anthropic SDK merges `ANTHROPIC_CUSTOM_HEADERS` from the process environment into every request; that variable cannot be pinned from the client constructor, so do not set it in production environments.
