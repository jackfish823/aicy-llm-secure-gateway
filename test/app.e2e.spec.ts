import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { stubEnv, validEnv } from '../src/config/env.fixture.js';

describe('application (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    // AppModule validates the environment while it is being imported, so stub first.
    stubEnv(validEnv());
    const { AppModule } = await import('../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('GET /healthz reports ok', async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: 'ok' });
  });
});
