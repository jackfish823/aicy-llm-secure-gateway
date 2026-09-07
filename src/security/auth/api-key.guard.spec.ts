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
  open(): string {
    return 'open';
  }

  @Admin()
  admin(): string {
    return 'admin';
  }

  plain(): string {
    return 'plain';
  }
}

const PEPPER = 'placeholder-pepper-placeholder-pepper-0000';

const build = async () => {
  const contextService = new RequestContextService();
  const service = new ApiKeyService({ apiKeyPepper: PEPPER }, new InMemoryApiKeyStore());
  const guard = new ApiKeyGuard(new Reflector(), service, contextService);
  const client = await service.create('app', 'client');
  const admin = await service.create('ops', 'admin');
  const context = createRequestContext();

  const run = (handler: () => string, headers: Record<string, string>): Promise<boolean> => {
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
    expect(error.getResponse()).toEqual({
      statusCode: 401,
      error: 'unauthorized',
      requestId: context.requestId,
    });
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
