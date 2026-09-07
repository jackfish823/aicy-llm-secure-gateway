# API key authentication — design

Date: 2026-09-07. Builds on the gateway spine (`2026-09-06-llm-gateway-spine-design.md`).

## Goal

Every route requires a valid API key unless marked public. Two roles: `client` (can call
`POST /v1/chat`) and `admin` (client access plus routes marked `@Admin()`, e.g. the future
`GET /v1/audit`). Keys live in Mongo so per-key settings (rate limits) can be added later.

## Non-goals

Key rotation, expiry, an admin HTTP API for keys, rate limiting. Revocation is deleting the
document.

## Header and key format

- Header: `x-api-key: <key>`.
- Key: `sk_` + 43 base64url chars (32 random bytes from `crypto.randomBytes`).
- Stored form: `keyHash = HMAC-SHA256(AUTH_API_KEY_PEPPER, key)` as lowercase hex. The
  plaintext key is printed once by the creation script and never stored or logged.

## Storage

Mongo collection `api_keys`, Mongoose model:

| Field       | Type                  | Notes                                   |
| ----------- | --------------------- | --------------------------------------- |
| `name`      | string                | Human label, required                   |
| `role`      | `'admin' \| 'client'` | Required                                |
| `keyHash`   | string                | Unique index; lookup key                |
| `createdAt` | Date                  | Mongoose timestamps                     |

Connection: `MongooseModule.forRootAsync` in `AppModule`, URI from `mongoConfig`.

## Guard flow

`ApiKeyGuard` is registered once as a global `APP_GUARD` in `AuthModule` (fail-closed: a
route is protected unless decorated `@Public()`). Guards run after middleware (request
context, body parsing) and before pipes, so auth is the first thing after the context exists.
It is registered before any future guard (rate limit), so it runs first.

1. Route has `@Public()` → allow, no principal.
2. Read `x-api-key`. Missing or not a string → 401.
3. `ApiKeyService.findByKey(key)`: hash, `findOne({ keyHash })`, then
   `timingSafeEqual(storedHash, computedHash)`. Not found or mismatch → 401.
4. Route has `@Admin()` and `role !== 'admin'` → 403.
5. Set `RequestContext.principal = { apiKeyId: doc.id, roles: [doc.role] }` → allow.

## Errors

| Situation                           | Status | `error`        |
| ----------------------------------- | ------ | -------------- |
| Header missing or key unknown       | 401    | `unauthorized` |
| Valid key, role not allowed         | 403    | `forbidden`    |

Bodies are `{ statusCode, error, requestId }` (thrown as `HttpException`, so the existing
filter logs `request.rejected`). The guard additionally logs `auth.rejected` with
`reason: 'missing' | 'invalid' | 'forbidden'`. Never the key, never the hash. On success the
principal id is available for later audit; nothing else is logged.

## Decorators

`src/security/auth/auth.decorators.ts`:

- `@Public()` — `SetMetadata(IS_PUBLIC, true)`. Used on `GET /healthz`.
- `@Admin()` — `SetMetadata(REQUIRED_ROLE, 'admin')`.

## Key creation script

`src/cli/create-api-key.ts`, run as `pnpm keys:create --name <label> --role <admin|client>`.
Boots `NestFactory.createApplicationContext(AppModule)` (so env validation and the Mongo
connection are the real ones), calls `ApiKeyService.create(name, role)`, prints the plaintext
key once to stdout, exits. Arguments parsed with `node:util` `parseArgs`; role validated by
Zod enum. Lives under `src/` so `nest build` compiles it; `pnpm keys:create` builds then runs
`dist/cli/create-api-key.js`.

## Files

New:

- `src/security/auth/api-key.schema.ts` — Mongoose schema, `ApiKeyDocument`, `API_KEY_ROLES`
- `src/security/auth/api-key.service.ts` — `hash`, `findByKey`, `create`
- `src/security/auth/api-key.guard.ts`
- `src/security/auth/auth.decorators.ts`
- `src/security/auth/auth.module.ts` — `MongooseModule.forFeature`, service, `APP_GUARD`
- `src/cli/create-api-key.ts`

Modified:

- `src/app.module.ts` — `MongooseModule.forRootAsync`, import `AuthModule`
- `src/health/health.controller.ts` — `@Public()`
- `package.json` — deps `@nestjs/mongoose`, `mongoose`; script `keys:create`
- `README.md` — API section (auth header, 401/403 rows), key creation, remove
  "no authentication" limitation
- `eslint.config.mjs` — layering: `src/security/**` may import `src/common/**` and
  `src/config/**` only

## Tests

- `api-key.service.spec.ts`: `hash` is deterministic, differs by pepper, hex length 64;
  `findByKey` returns `undefined` for unknown key and the document for a known one (model
  stubbed with a minimal `findOne`).
- `api-key.guard.spec.ts`: public route passes without header; missing header → 401;
  unknown key → 401; client key on `@Admin()` route → 403; valid key sets `principal` and
  passes. Service stubbed, `ExecutionContext` built with `createMock`-free hand-rolled
  objects (same style as existing middleware specs).
- `test/chat.e2e.spec.ts`: `bootApp` overrides two providers so the app boots without Mongo:
  the Mongoose connection token (`getConnectionToken()`) with `{ close: async () => {} }` so
  no connection is opened, and the `ApiKey` model token (`getModelToken`) with an in-memory
  stub exposing `findOne`. The real `ApiKeyService` and `ApiKeyGuard` run. Cases: no header
  → 401 with `requestId`; unknown key → 401; valid client key → 200; every existing case
  sends a valid key. `test/app.e2e.spec.ts`: `/healthz` still 200 without a key.

No test touches a real Mongo.
