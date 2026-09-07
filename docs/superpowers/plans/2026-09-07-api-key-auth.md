# API Key Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every route requires an `x-api-key` header backed by a Mongo `api_keys` document, with `client` and `admin` roles, `@Public()` / `@Admin()` decorators, and a CLI to mint keys.

**Architecture:** `ApiKeyService` (HMAC-SHA256 with the env pepper, constant-time compare, Mongoose model behind a two-method `ApiKeyStore` interface) → `ApiKeyGuard` registered once as a global `APP_GUARD` in `AuthModule` (fail-closed, sets `RequestContext.principal`) → `MongooseModule.forRootAsync` in `AppModule`. Tests never touch Mongo: a shared fixture provides an in-memory store and a `withoutMongo()` helper that overrides the Mongoose connection and model tokens.

**Tech Stack:** NestJS 12, `@nestjs/mongoose` 12, `mongoose` 9, `node:crypto`, Zod 4, Vitest.

**Repo rules that bind every task:** no `any`, no `as`, no `!`; arrow functions for module-level helpers; `.js` import extensions; `no-console` (use `process.stdout.write` in the CLI); never log or print a key or hash except the one-time CLI output; no git operations (the user commits). Spec: `docs/superpowers/specs/2026-09-07-api-key-auth-design.md`.

**Gate after every task:** `pnpm lint && pnpm typecheck && pnpm test` all green.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/security/auth/api-key.schema.ts` | Mongoose schema, `ApiKey` shape, `ApiKeyRole`, model token |
| `src/security/auth/api-key.service.ts` | `hash`, `findByKey`, `create`; `ApiKeyStore` + `ApiKeyRecord` interfaces |
| `src/security/auth/api-key.fixture.ts` | `InMemoryApiKeyStore`, `withoutMongo(builder)` (tests only, excluded from build) |
| `src/security/auth/auth.decorators.ts` | `@Public()`, `@Admin()`, metadata keys |
| `src/security/auth/api-key.guard.ts` | `ApiKeyGuard`, `AuthException`, `API_KEY_HEADER` |
| `src/security/auth/auth.module.ts` | `forFeature`, service, `APP_GUARD` |
| `src/cli/create-api-key.ts` | `pnpm keys:create` |
| `src/app.module.ts` | `MongooseModule.forRootAsync`, import `AuthModule` |
| `src/health/health.controller.ts` | `@Public()` |
| `test/chat.e2e.spec.ts`, `test/app.e2e.spec.ts` | `withoutMongo`, key header, 401 cases |
| `eslint.config.mjs`, `vitest.config.ts`, `package.json`, `README.md` | layering, coverage exclude, deps/script, docs |

---

### Task 1: Schema, store fixture, service

**Files:**
- Create: `src/security/auth/api-key.schema.ts`
- Create: `src/security/auth/api-key.service.ts`
- Create: `src/security/auth/api-key.fixture.ts`
- Test: `src/security/auth/api-key.service.spec.ts`

- [ ] **Step 1: Install deps**

```bash
pnpm add @nestjs/mongoose@^12.0.0 mongoose@^9.9.5
```

Expected: both appear under `dependencies` in `package.json`.

- [ ] **Step 2: Write the failing test**

`src/security/auth/api-key.service.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { InMemoryApiKeyStore } from './api-key.fixture.js';
import { API_KEY_PREFIX, ApiKeyService } from './api-key.service.js';

const PEPPER = 'placeholder-pepper-placeholder-pepper-0000';

const build = (pepper = PEPPER) => {
  const store = new InMemoryApiKeyStore();
  return { store, service: new ApiKeyService({ apiKeyPepper: pepper }, store) };
};

describe('ApiKeyService', () => {
  it('hashes deterministically to 64 hex chars and changes with the pepper', () => {
    const { service } = build();
    const other = build('another-pepper-another-pepper-another-pepper').service;

    expect(service.hash('sk_x')).toMatch(/^[0-9a-f]{64}$/);
    expect(service.hash('sk_x')).toBe(service.hash('sk_x'));
    expect(service.hash('sk_x')).not.toBe(other.hash('sk_x'));
  });

  it('creates a prefixed key and stores only its hash', async () => {
    const { service, store } = build();

    const { key, id } = await service.create('ops', 'admin');

    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key.length).toBe(API_KEY_PREFIX.length + 43);
    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toMatchObject({ id, name: 'ops', role: 'admin', keyHash: service.hash(key) });
    expect(JSON.stringify(store.records)).not.toContain(key);
  });

  it('resolves a created key back to its identity', async () => {
    const { service } = build();
    const { key, id } = await service.create('app', 'client');

    await expect(service.findByKey(key)).resolves.toEqual({ id, name: 'app', role: 'client' });
  });

  it('returns undefined for an unknown key', async () => {
    const { service } = build();
    await service.create('app', 'client');

    await expect(service.findByKey('sk_unknown')).resolves.toBeUndefined();
  });

  it('returns undefined when the stored hash is malformed instead of throwing', async () => {
    const { service, store } = build();
    const { key } = await service.create('app', 'client');
    // findOne matches by hash, so a truncated stored hash would never be found; matchAny forces
    // the constant-time compare path with mismatched buffer lengths.
    store.records[0] = { id: '1', name: 'app', role: 'client', keyHash: service.hash(key).slice(0, 62) };
    store.matchAny = true;

    await expect(service.findByKey(key)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/security/auth/api-key.service.spec.ts`
Expected: FAIL, cannot resolve `./api-key.fixture.js` / `./api-key.service.js`.

- [ ] **Step 4: Schema**

`src/security/auth/api-key.schema.ts`:

```ts
import { type HydratedDocument, Schema } from 'mongoose';

export const API_KEY_ROLES = ['admin', 'client'] as const;
export type ApiKeyRole = (typeof API_KEY_ROLES)[number];

/** One issued key. `keyHash` is HMAC-SHA256(pepper, key); the plaintext key is never stored. */
export interface ApiKey {
  name: string;
  role: ApiKeyRole;
  keyHash: string;
  createdAt: Date;
}

export type ApiKeyDocument = HydratedDocument<ApiKey>;

/** Injection token for `@InjectModel` and `getModelToken`. */
export const API_KEY_MODEL = 'ApiKey';

export const apiKeySchema = new Schema<ApiKey>(
  {
    name: { type: String, required: true },
    role: { type: String, enum: API_KEY_ROLES, required: true },
    keyHash: { type: String, required: true, unique: true },
  },
  { collection: 'api_keys', timestamps: { createdAt: true, updatedAt: false } },
);
```

- [ ] **Step 5: Service**

`src/security/auth/api-key.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { authConfig, type AuthConfig } from '../../config/domains/auth.config.js';
import { API_KEY_MODEL, type ApiKey, type ApiKeyRole } from './api-key.schema.js';

export const API_KEY_PREFIX = 'sk_';
const KEY_BYTES = 32;

/** A stored key as the service sees it. */
export interface ApiKeyRecord {
  id: string;
  name: string;
  role: ApiKeyRole;
  keyHash: string;
}

/** The two calls made on the Mongoose model, so tests substitute an in-memory store. */
export interface ApiKeyStore {
  findOne(filter: { keyHash: string }): { exec(): Promise<ApiKeyRecord | null> };
  create(doc: Omit<ApiKey, 'createdAt'>): Promise<ApiKeyRecord>;
}

/** What the guard needs after a successful lookup. Never includes the hash. */
export interface ApiKeyIdentity {
  id: string;
  name: string;
  role: ApiKeyRole;
}

const sameHash = (stored: string, computed: string): boolean => {
  const a = Buffer.from(stored, 'hex');
  const b = Buffer.from(computed, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

@Injectable()
export class ApiKeyService {
  constructor(
    @Inject(authConfig.KEY) private readonly config: AuthConfig,
    @InjectModel(API_KEY_MODEL) private readonly store: ApiKeyStore,
  ) {}

  hash(key: string): string {
    return createHmac('sha256', this.config.apiKeyPepper).update(key).digest('hex');
  }

  async findByKey(key: string): Promise<ApiKeyIdentity | undefined> {
    const keyHash = this.hash(key);
    const record = await this.store.findOne({ keyHash }).exec();
    if (record === null || !sameHash(record.keyHash, keyHash)) {
      return undefined;
    }
    return { id: record.id, name: record.name, role: record.role };
  }

  /** Returns the plaintext key exactly once. Callers must not log it. */
  async create(name: string, role: ApiKeyRole): Promise<{ key: string; id: string }> {
    const key = `${API_KEY_PREFIX}${randomBytes(KEY_BYTES).toString('base64url')}`;
    const record = await this.store.create({ name, role, keyHash: this.hash(key) });
    return { key, id: record.id };
  }
}
```

- [ ] **Step 6: Fixture**

`src/security/auth/api-key.fixture.ts` (excluded from the build by `**/*.fixture.ts`):

```ts
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { API_KEY_MODEL, type ApiKey } from './api-key.schema.js';
import type { ApiKeyRecord, ApiKeyStore } from './api-key.service.js';

/** Stands in for the Mongoose model: the two calls ApiKeyService makes, over an array. */
export class InMemoryApiKeyStore implements ApiKeyStore {
  readonly records: ApiKeyRecord[] = [];
  /** Test hook: return the first record regardless of hash, to exercise the compare path. */
  matchAny = false;

  findOne(filter: { keyHash: string }): { exec(): Promise<ApiKeyRecord | null> } {
    const found = this.matchAny
      ? this.records[0]
      : this.records.find((record) => record.keyHash === filter.keyHash);
    return { exec: () => Promise.resolve(found ?? null) };
  }

  create(doc: Omit<ApiKey, 'createdAt'>): Promise<ApiKeyRecord> {
    const record = { id: String(this.records.length + 1), ...doc };
    this.records.push(record);
    return Promise.resolve(record);
  }
}

/**
 * Boots AppModule without a Mongo server: the Mongoose connection becomes a no-op and the
 * ApiKey model becomes `store`. Everything else (guard, service, hashing) is real.
 */
export const withoutMongo = (
  builder: TestingModuleBuilder,
  store: InMemoryApiKeyStore = new InMemoryApiKeyStore(),
): TestingModuleBuilder =>
  builder
    .overrideProvider(getConnectionToken())
    .useValue({ close: () => Promise.resolve() })
    .overrideProvider(getModelToken(API_KEY_MODEL))
    .useValue(store);
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run src/security/auth/api-key.service.spec.ts`
Expected: 5 passed. Then `pnpm lint && pnpm typecheck` clean.

---

### Task 2: Decorators and guard

**Files:**
- Create: `src/security/auth/auth.decorators.ts`
- Create: `src/security/auth/api-key.guard.ts`
- Test: `src/security/auth/api-key.guard.spec.ts`

- [ ] **Step 1: Write the failing test**

`src/security/auth/api-key.guard.spec.ts`:

```ts
import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host.js';
import { describe, expect, it } from 'vitest';
import { createRequestContext } from '../../common/context/request-context.js';
import { RequestContextService } from '../../common/context/request-context.service.js';
import { InMemoryApiKeyStore } from './api-key.fixture.js';
import { ApiKeyGuard, AuthException } from './api-key.guard.js';
import { ApiKeyService } from './api-key.service.js';
import { Admin, Public } from './auth.decorators.js';

class Routes {
  @Public()
  open(): void {}

  @Admin()
  admin(): void {}

  plain(): void {}
}

const PEPPER = 'placeholder-pepper-placeholder-pepper-0000';

const build = async () => {
  const contextService = new RequestContextService();
  const service = new ApiKeyService({ apiKeyPepper: PEPPER }, new InMemoryApiKeyStore());
  const guard = new ApiKeyGuard(new Reflector(), service, contextService);
  const client = await service.create('app', 'client');
  const admin = await service.create('ops', 'admin');
  const context = createRequestContext();

  const run = (handler: () => void, headers: Record<string, string>): Promise<boolean> => {
    const host = new ExecutionContextHost([{ headers }], Routes, handler);
    host.setType('http');
    return contextService.run(context, () => guard.canActivate(host));
  };
  return { run, context, client, admin };
};

const rejection = async (promise: Promise<boolean>): Promise<AuthException> => {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof AuthException) {
      return error;
    }
    throw new Error('expected an AuthException', { cause: error });
  }
  throw new Error('expected the guard to reject');
};

describe('ApiKeyGuard', () => {
  it('lets a @Public route through with no header and no principal', async () => {
    const { run, context } = await build();

    await expect(run(Routes.prototype.open, {})).resolves.toBe(true);
    expect(context.principal).toBeUndefined();
  });

  it('rejects a missing header with 401 unauthorized', async () => {
    const { run, context } = await build();

    const error = await rejection(run(Routes.prototype.plain, {}));

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toEqual({ statusCode: 401, error: 'unauthorized', requestId: context.requestId });
    expect(error.reason).toBe('missing');
  });

  it('rejects an unknown key with 401 and never echoes it', async () => {
    const { run } = await build();

    const error = await rejection(run(Routes.prototype.plain, { 'x-api-key': 'sk_NOPE' }));

    expect(error.getStatus()).toBe(401);
    expect(error.reason).toBe('invalid');
    expect(JSON.stringify(error.getResponse())).not.toContain('NOPE');
  });

  it('rejects a client key on an @Admin route with 403 forbidden', async () => {
    const { run, client } = await build();

    const error = await rejection(run(Routes.prototype.admin, { 'x-api-key': client.key }));

    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toMatchObject({ error: 'forbidden' });
  });

  it('accepts an admin key on an @Admin route', async () => {
    const { run, admin, context } = await build();

    await expect(run(Routes.prototype.admin, { 'x-api-key': admin.key })).resolves.toBe(true);
    expect(context.principal).toEqual({ apiKeyId: admin.id, roles: ['admin'] });
  });

  it('accepts a client key on a plain route and records the principal', async () => {
    const { run, client, context } = await build();

    await expect(run(Routes.prototype.plain, { 'x-api-key': client.key })).resolves.toBe(true);
    expect(context.principal).toEqual({ apiKeyId: client.id, roles: ['client'] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/security/auth/api-key.guard.spec.ts`
Expected: FAIL, cannot resolve `./api-key.guard.js` / `./auth.decorators.js`.

- [ ] **Step 3: Decorators**

`src/security/auth/auth.decorators.ts`:

```ts
import { type CustomDecorator, SetMetadata } from '@nestjs/common';
import type { ApiKeyRole } from './api-key.schema.js';

export const IS_PUBLIC = 'auth:public';
export const REQUIRED_ROLE = 'auth:role';

/** Skips the API key check. Liveness endpoints only. */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC, true);

/** Requires an admin key; client keys get 403. */
export const Admin = (): CustomDecorator<string> => {
  const role: ApiKeyRole = 'admin';
  return SetMetadata(REQUIRED_ROLE, role);
};
```

- [ ] **Step 4: Guard**

`src/security/auth/api-key.guard.ts`:

```ts
import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestContextService } from '../../common/context/request-context.service.js';
import type { ApiKeyRole } from './api-key.schema.js';
import { ApiKeyService } from './api-key.service.js';
import { IS_PUBLIC, REQUIRED_ROLE } from './auth.decorators.js';

export const API_KEY_HEADER = 'x-api-key';

export type AuthRejection = 'missing' | 'invalid' | 'forbidden';

/** 401 for a missing or unknown key, 403 for a known key without the required role. */
export class AuthException extends HttpException {
  constructor(
    readonly reason: AuthRejection,
    requestId: string,
  ) {
    const forbidden = reason === 'forbidden';
    const statusCode = forbidden ? HttpStatus.FORBIDDEN : HttpStatus.UNAUTHORIZED;
    super({ statusCode, error: forbidden ? 'forbidden' : 'unauthorized', requestId }, statusCode);
  }
}

/** The one request field the guard reads (Express's `Request` satisfies it). */
export interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Global guard: every route needs a valid key unless marked @Public(); @Admin() routes need
 * an admin key. Runs after the request-context and body middleware and before pipes. On
 * success the principal is written to the request context for later stages and audit.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeyService,
    private readonly contextService: RequestContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, targets) === true) {
      return true;
    }

    const header = context.switchToHttp().getRequest<AuthRequest>().headers[API_KEY_HEADER];
    if (typeof header !== 'string' || header === '') {
      throw this.reject('missing');
    }

    const identity = await this.apiKeys.findByKey(header);
    if (identity === undefined) {
      throw this.reject('invalid');
    }

    const required = this.reflector.getAllAndOverride<ApiKeyRole | undefined>(REQUIRED_ROLE, targets);
    if (required !== undefined && identity.role !== required) {
      throw this.reject('forbidden', identity.id);
    }

    this.contextService.get().principal = { apiKeyId: identity.id, roles: [identity.role] };
    return true;
  }

  /** Logs the reason (never the key) and builds the exception. */
  private reject(reason: AuthRejection, apiKeyId?: string): AuthException {
    this.logger.warn('Request not authenticated', { event: 'auth.rejected', reason, apiKeyId });
    return new AuthException(reason, this.contextService.tryGet()?.requestId ?? 'unknown');
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/security/auth/api-key.guard.spec.ts`
Expected: 6 passed. Then `pnpm lint && pnpm typecheck` clean. If the deep import `@nestjs/core/helpers/execution-context-host.js` fails to resolve, the package exports `./*.js`; check the path spelling before trying anything else.

---

### Task 3: Wire it up (module, Mongo root, health, layering, e2e)

**Files:**
- Create: `src/security/auth/auth.module.ts`
- Modify: `src/app.module.ts`
- Modify: `src/health/health.controller.ts`
- Modify: `eslint.config.mjs`
- Modify: `test/app.e2e.spec.ts`, `test/chat.e2e.spec.ts`

- [ ] **Step 1: Write the failing e2e tests**

In `test/chat.e2e.spec.ts`:

Add imports:

```ts
import { withoutMongo } from '../src/security/auth/api-key.fixture.js';
import { ApiKeyService } from '../src/security/auth/api-key.service.js';
```

Wrap the builder in `bootApp`:

```ts
  let builder = withoutMongo(Test.createTestingModule({ imports: [AppModule] }))
    .overrideProvider(LLM_PROVIDER)
    .useValue(fake)
```

Add a `clientKey` to `RunningApp` and mint it after `compile()`:

```ts
interface RunningApp {
  app: NestExpressApplication;
  baseUrl: string;
  clientKey: string;
}
...
  const moduleRef = await builder.compile();
  const { key: clientKey } = await moduleRef.get(ApiKeyService).create('e2e', 'client');
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  app.disable('x-powered-by');
  await app.listen(0);
  return { app, baseUrl: await app.getUrl(), clientKey };
```

Make `postChat` and `postRaw` send the key by default (both take `running` now):

```ts
const postChat = (running: RunningApp, body: unknown, key = running.clientKey): Promise<Response> => {
  return fetch(`${running.baseUrl}/v1/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify(body),
  });
};

const postRaw = (
  running: RunningApp,
  body: string,
  headers: Record<string, string> = {},
): Promise<Response> => {
  return fetch(`${running.baseUrl}/v1/chat`, {
    method: 'POST',
    headers: { 'x-api-key': running.clientKey, ...headers },
    body,
  });
};
```

Update every existing call site from `postChat(running.baseUrl, …)` to `postChat(running, …)` and `postRaw(running.baseUrl, …)` to `postRaw(running, …)`. Then add two cases inside the main `describe`:

```ts
  it('rejects a request without an API key with 401 before touching the provider', async () => {
    const response = await postChat(running, validBody, '');
    const body = errorBody.parse(await response.json());

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ statusCode: 401, error: 'unauthorized' });
    expect(response.headers.get('x-request-id')).toBe(body.requestId);
    expect(fake.calls).toHaveLength(0);
  });

  it('rejects an unknown API key with 401 and never echoes it', async () => {
    const response = await postChat(running, validBody, 'sk_NOT-A-REAL-KEY');
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(text).not.toContain('NOT-A-REAL-KEY');
    expect(fake.calls).toHaveLength(0);
  });
```

(`postChat(running, validBody, '')` sends an empty header value; the guard treats it as missing.)

In `test/app.e2e.spec.ts`, wrap the builder:

```ts
import { withoutMongo } from '../src/security/auth/api-key.fixture.js';
...
    const moduleRef = await withoutMongo(Test.createTestingModule({ imports: [AppModule] })).compile();
```

Add one case:

```ts
  it('GET /healthz is public', async () => {
    const response = await fetch(`${baseUrl}/healthz`);

    expect(response.status).toBe(200);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/`
Expected: the two new chat cases FAIL with status 200 (no guard yet); `withoutMongo` overrides are harmless until Mongoose is wired.

- [ ] **Step 3: AuthModule**

`src/security/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiKeyGuard } from './api-key.guard.js';
import { API_KEY_MODEL, apiKeySchema } from './api-key.schema.js';
import { ApiKeyService } from './api-key.service.js';

/** Registers the global API key guard. Import before any other guard-providing module. */
@Module({
  imports: [MongooseModule.forFeature([{ name: API_KEY_MODEL, schema: apiKeySchema }])],
  providers: [ApiKeyService, { provide: APP_GUARD, useClass: ApiKeyGuard }],
  exports: [ApiKeyService],
})
export class AuthModule {}
```

- [ ] **Step 4: AppModule**

Replace the imports array and add the Mongoose root in `src/app.module.ts`:

```ts
import { MongooseModule } from '@nestjs/mongoose';
import { mongoConfig, type MongoConfig } from './config/domains/mongo.config.js';
import { AuthModule } from './security/auth/auth.module.js';
...
@Module({
  imports: [
    AppConfigModule.forRoot(),
    MongooseModule.forRootAsync({
      inject: [mongoConfig.KEY],
      useFactory: (config: MongoConfig) => ({ uri: config.uri }),
    }),
    RequestContextModule,
    // AuthModule registers the global guard; keep it before ChatModule so auth runs first.
    AuthModule,
    HealthModule,
    ChatModule,
  ],
  providers: [AppLoggerService, { provide: APP_PIPE, useClass: StandardSchemaValidationPipe }],
})
```

- [ ] **Step 5: Health public**

`src/health/health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { Public } from '../security/auth/auth.decorators.js';

export interface HealthStatus {
  status: 'ok';
}

@Controller('healthz')
export class HealthController {
  /** Liveness only, unauthenticated so orchestrators can probe it. */
  @Public()
  @Get()
  check(): HealthStatus {
    return { status: 'ok' };
  }
}
```

- [ ] **Step 6: Layering guards in `eslint.config.mjs`**

Add `'**/security/**'` to the `src/common/**` restricted group (common must not value-import security), and add a new block after the `src/providers/**` block:

```js
  {
    files: ['src/security/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/chat/**', '**/pipeline/**', '**/providers/**'],
              allowTypeImports: true,
              message:
                'security may only import from common and config; a value import from a feature layer inverts the layering.',
            },
          ],
        },
      ],
    },
  },
```

- [ ] **Step 7: Run everything**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all green, including the two new 401 cases and the existing chat cases (they now send `clientKey`). If `pnpm test` hangs for ~30 s and then fails with a Mongo connection error, `withoutMongo` is not wrapping a builder somewhere: grep `test/` for `createTestingModule` without `withoutMongo`.

---

### Task 4: CLI, scripts, docs

**Files:**
- Create: `src/cli/create-api-key.ts`
- Modify: `package.json` (scripts), `vitest.config.ts` (coverage exclude), `README.md`
- Modify: `docs/superpowers/specs/2026-09-07-api-key-auth-design.md` (script path)

- [ ] **Step 1: CLI**

`src/cli/create-api-key.ts` (no tests: it is glue over `ApiKeyService.create`, which is tested; it needs a real environment and Mongo):

```ts
import { NestFactory } from '@nestjs/core';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { AppModule } from '../app.module.js';
import { API_KEY_ROLES } from '../security/auth/api-key.schema.js';
import { ApiKeyService } from '../security/auth/api-key.service.js';

const USAGE = 'usage: pnpm keys:create --name <label> --role <admin|client>\n';

const argsSchema = z.object({ name: z.string().min(1), role: z.enum(API_KEY_ROLES) });

const { values } = parseArgs({
  options: { name: { type: 'string' }, role: { type: 'string' } },
});
const args = argsSchema.safeParse(values);
if (!args.success) {
  process.stderr.write(USAGE);
  process.exit(2);
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const { key, id } = await app.get(ApiKeyService).create(args.data.name, args.data.role);
  // The only place a plaintext key is ever written. Shown once; not stored anywhere.
  process.stdout.write(`Created ${args.data.role} key ${id} (${args.data.name}).\n${key}\n`);
} finally {
  await app.close();
}
```

- [ ] **Step 2: Scripts and coverage**

`package.json` scripts, add:

```json
    "keys:create": "nest build && NODE_ENV=development node dist/cli/create-api-key.js",
```

`vitest.config.ts` coverage exclude:

```ts
      exclude: ['src/main.ts', 'src/cli/**', 'src/**/*.spec.ts', 'src/**/*.fixture.ts'],
```

- [ ] **Step 3: Build and try the CLI (needs Mongo running: `docker compose up -d`)**

Run: `pnpm keys:create --name smoke --role client`
Expected: one line `Created client key <id> (smoke).` then the key, process exits 0. Do not paste the key anywhere. Run again with `--role nope`: prints usage, exits 2.

- [ ] **Step 4: Smoke the guard against the real server**

Run `pnpm start:local` in one terminal. In another (replace `KEY` with the smoke key from Step 3):

```bash
curl -si http://localhost:3000/v1/chat -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"hi"}]}'
```

Expected: `401` with `{"statusCode":401,"error":"unauthorized","requestId":"…"}`, and server log lines `auth.rejected` (reason `missing`), `request.rejected`, `http.request`.

```bash
curl -si http://localhost:3000/v1/chat -H 'content-type: application/json' -H 'x-api-key: KEY' -d '{"messages":[{"role":"user","content":"hi"}]}'
```

Expected: passes auth (200 or `upstream_error` if the Anthropic key is a placeholder; either proves the guard let it through). `curl -si http://localhost:3000/healthz` → 200 with no key.

- [ ] **Step 5: README**

In `README.md`:

Setup: add `pnpm keys:create --name dev --role client` after `docker compose up -d`, and note Mongo must be up before `pnpm start:local` (the app connects at boot).

API section: replace "No auth yet (see Known limitations)." with:

> Every route except `GET /healthz` requires `x-api-key`. Keys have a role: `client` may call `POST /v1/chat`; `admin` may also call routes marked `@Admin()` (none yet). Mint one with `pnpm keys:create --name <label> --role <admin|client>`; the key is printed once and only its HMAC-SHA256 (with `AUTH_API_KEY_PEPPER`) is stored in the `api_keys` collection. Revoke by deleting the document.

Add `-H 'x-api-key: sk_…'` to the curl example. Add to the error table above the body rows:

```
| No or unknown `x-api-key`     | 401    | `unauthorized`                                    |
| Key lacks the required role   | 403    | `forbidden`                                       |
```

Configuration table, `AUTH_API_KEY_PEPPER` notes: `At least 32 characters; HMAC key for stored API key hashes. Changing it invalidates every key.`

Add a short **Auth** section after **Pipeline**:

> `src/security/auth/`. `ApiKeyGuard` is a global guard registered by `AuthModule`; routes are protected unless decorated `@Public()`, and `@Admin()` requires the `admin` role. The guard sets `RequestContext.principal` (`{ apiKeyId, roles }`) for later stages and audit. Rejections log `auth.rejected` with a `reason` (`missing` | `invalid` | `forbidden`) and never the key. Tests boot the app through `withoutMongo()` from `api-key.fixture.ts`; nothing in the suite connects to Mongo.

Known limitations: delete the "no authentication or rate limiting" line and add `POST /v1/chat has no rate limiting yet.` and `API keys have no expiry or rotation; revoke by deleting the document.`

- [ ] **Step 6: Spec path fix**

In `docs/superpowers/specs/2026-09-07-api-key-auth-design.md` replace both `scripts/create-api-key.ts` occurrences with `src/cli/create-api-key.ts` and add to the "Key creation script" section: `Lives under src/ so nest build compiles it; pnpm keys:create builds then runs dist/cli/create-api-key.js.`

- [ ] **Step 7: Final gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all green; `dist/cli/create-api-key.js` exists; `dist/` contains no `*.fixture.js`.

---

## Owner follow-ups (not for agents)

- Commit.
- CLAUDE.md "Control → Nest seam" row 1 matches this design already; optionally note `@Public()` / `@Admin()` there.
- `.env.example` needs no new variable.
