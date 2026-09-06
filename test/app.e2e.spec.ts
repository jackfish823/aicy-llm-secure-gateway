import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { stubEnv, UUID_PATTERN, validEnv } from '../src/config/env.fixture.js';

describe('application (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    // AppModule validates the environment while it is being imported, so stub first.
    stubEnv(validEnv());
    const { AppModule } = await import('../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
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

  it('every response carries a generated x-request-id', async () => {
    const response = await fetch(`${baseUrl}/healthz`, { headers: { 'x-request-id': 'spoofed' } });

    expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  });

  it('sets x-request-id on error responses too', async () => {
    const response = await fetch(`${baseUrl}/no-such-route`);

    expect(response.status).toBe(404);
    expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  });

  it('parses JSON bodies inside the request context, so parse failures carry an id', async () => {
    const response = await fetch(`${baseUrl}/no-such-route`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json FRAGMENT-NEVER-ECHOED',
    });
    const text = await response.text();
    const body: unknown = JSON.parse(text);

    expect(response.status).toBe(400);
    expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
    expect(body).toMatchObject({ statusCode: 400, error: 'invalid_body' });
    expect(text).not.toContain('FRAGMENT');
  });

  it('gives each request a distinct id', async () => {
    const [first, second] = await Promise.all([
      fetch(`${baseUrl}/healthz`),
      fetch(`${baseUrl}/healthz`),
    ]);

    expect(first.headers.get('x-request-id')).toMatch(UUID_PATTERN);
    expect(first.headers.get('x-request-id')).not.toBe(second.headers.get('x-request-id'));
  });
});
