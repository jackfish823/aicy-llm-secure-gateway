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
docker compose up -d         # mongo + redis
pnpm start:local
curl http://localhost:3000/healthz
```

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
| `MONGO_URI`            | yes                           |               | `mongodb://` or `mongodb+srv://`, database name included      |
| `REDIS_URL`            | yes                           |               | `redis://` or `rediss://`                                     |
| `REDIS_KEY_PREFIX`     | no                            | `sllm:`       | Prefix for every key the gateway writes                       |
| `LLM_PROVIDER`         | yes                           |               | `anthropic` \| `openai`                                       |
| `LLM_MODEL`            | yes                           |               | Model id sent to the provider                                 |
| `LLM_TIMEOUT_MS`       | no                            | `30000`       | Positive integer                                              |
| `LLM_BASE_URL`         | no                            |               | Optional proxy URL; empty means unset                         |
| `ANTHROPIC_API_KEY`    | when `LLM_PROVIDER=anthropic` |               |                                                               |
| `OPENAI_API_KEY`       | when `LLM_PROVIDER=openai`    |               |                                                               |
| `AUTH_API_KEY_PEPPER`  | yes                           |               | At least 32 characters                                        |
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

## Known limitations

- Out of scope for now: semantic/model-based injection classification, multi-tenant key
  rotation, streaming responses, token-level cost accounting.
- The gateway container is not part of `docker-compose.yml` yet; run it on the host.
- `GET /healthz` is liveness only. It does not check Mongo or Redis.
