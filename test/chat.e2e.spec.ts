import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { chatResponseSchema } from '../src/chat/chat.schemas.js';
import { stubEnv, validEnv } from '../src/config/env.fixture.js';
import { GatewayPipeline } from '../src/pipeline/gateway-pipeline.js';
import {
  INBOUND_STAGES,
  OUTBOUND_STAGES,
  type InboundStage,
  type OutboundStage,
} from '../src/pipeline/stage.js';
import { FakeLlmProvider } from '../src/providers/fake/fake.provider.js';
import { LLM_PROVIDER, LlmProviderError } from '../src/providers/llm-provider.js';

interface RunningApp {
  app: NestExpressApplication;
  baseUrl: string;
}

interface BootOptions {
  inboundStages?: InboundStage[];
  outboundStages?: OutboundStage[];
  pipeline?: Pick<GatewayPipeline, 'run'>;
}

async function bootApp(fake: FakeLlmProvider, options: BootOptions = {}): Promise<RunningApp> {
  const { AppModule } = await import('../src/app.module.js');
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LLM_PROVIDER)
    .useValue(fake)
    .overrideProvider(INBOUND_STAGES)
    .useValue(options.inboundStages ?? [])
    .overrideProvider(OUTBOUND_STAGES)
    .useValue(options.outboundStages ?? []);
  if (options.pipeline !== undefined) {
    builder = builder.overrideProvider(GatewayPipeline).useValue(options.pipeline);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  app.disable('x-powered-by');
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

function postRaw(
  baseUrl: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}/v1/chat`, { method: 'POST', headers, body });
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
      'SMUGGLED-KEY': 1,
    });
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).toContain('messages.0.content');
    expect(text).toContain('unrecognized key');
    expect(text).not.toContain('SMUGGLED-KEY');
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

  it('rejects malformed JSON with a content-free invalid_body 400 carrying the request id', async () => {
    const response = await postRaw(
      running.baseUrl,
      '{"messages": [{"role": "user", "content": "SMUGGLED-FRAGMENT',
      {
        'content-type': 'application/json',
      },
    );
    const text = await response.text();
    const body = errorBody.parse(JSON.parse(text));

    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_body');
    expect(response.headers.get('x-request-id')).toBe(body.requestId);
    expect(text).not.toContain('SMUGGLED');
    expect(fake.calls).toHaveLength(0);
  });

  it('rejects an oversized body with body_too_large 413 and a request id', async () => {
    const oversized = JSON.stringify({
      messages: [{ role: 'user', content: 'x'.repeat(11 * 1024 * 1024) }],
    });

    const response = await postRaw(running.baseUrl, oversized, {
      'content-type': 'application/json',
    });
    const body = errorBody.parse(await response.json());

    expect(response.status).toBe(413);
    expect(body.error).toBe('body_too_large');
    expect(response.headers.get('x-request-id')).toBe(body.requestId);
    expect(fake.calls).toHaveLength(0);
  });

  it('treats a body without a JSON content type as an invalid request', async () => {
    const response = await postRaw(running.baseUrl, JSON.stringify(validBody));

    expect(response.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });

  it('does not advertise the server framework', async () => {
    const response = await postChat(running.baseUrl, validBody);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-powered-by')).toBeNull();
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
          findings: [
            { ruleId: 'TEST-RULE', category: 'test', matchedSegment: 'hello', confidence: 1 },
          ],
        }),
    };
    const { app, baseUrl } = await bootApp(fake, { inboundStages: [blocking] });

    try {
      const response = await postChat(baseUrl, validBody);
      const text = await response.text();
      const body: unknown = JSON.parse(text);

      expect(response.status).toBe(400);
      expect(body).toMatchObject({
        error: 'request_blocked',
        stage: 'test-block',
        reason: 'TEST-RULE',
      });
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
    const { app, baseUrl } = await bootApp(fake, { inboundStages: [broken] });

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

  it('returns 502 request_blocked when an outbound stage blocks', async () => {
    const fake = new FakeLlmProvider();
    const blocking: OutboundStage = {
      name: 'test-output-block',
      run: () =>
        Promise.resolve({
          kind: 'block',
          reason: 'OUTPUT_SECRET',
          findings: [
            { ruleId: 'OUT-1', category: 'secret', matchedSegment: 'AKIA-FAKE', confidence: 1 },
          ],
        }),
    };
    const { app, baseUrl } = await bootApp(fake, { outboundStages: [blocking] });

    try {
      const response = await postChat(baseUrl, validBody);
      const text = await response.text();
      const body: unknown = JSON.parse(text);

      expect(response.status).toBe(502);
      expect(body).toMatchObject({
        error: 'request_blocked',
        phase: 'outbound',
        stage: 'test-output-block',
        reason: 'OUTPUT_SECRET',
      });
      expect(text).not.toContain('AKIA-FAKE');
      expect(fake.calls).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('turns an unexpected error into a content-free internal_error 500', async () => {
    const fake = new FakeLlmProvider();
    const { app, baseUrl } = await bootApp(fake, {
      pipeline: { run: () => Promise.reject(new Error('boom SECRET-DETAIL')) },
    });

    try {
      const response = await postChat(baseUrl, validBody);
      const text = await response.text();
      const body = errorBody.parse(JSON.parse(text));

      expect(response.status).toBe(500);
      expect(body.error).toBe('internal_error');
      expect(response.headers.get('x-request-id')).toBe(body.requestId);
      expect(text).not.toContain('SECRET-DETAIL');
    } finally {
      await app.close();
    }
  });
});
