import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
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
const finding: Finding = {
  ruleId: 'TEST-1',
  category: 'test',
  matchedSegment: 'hello',
  confidence: 1,
};

const inbound = (
  name: string,
  verdict: (input: InboundInput) => StageVerdict<InboundInput>,
  log: string[],
): InboundStage => {
  return {
    name,
    run: (input) => {
      log.push(name);
      return Promise.resolve(verdict(input));
    },
  };
};

const outbound = (
  name: string,
  verdict: (input: OutboundInput) => StageVerdict<OutboundInput>,
  log: string[],
): OutboundStage => {
  return {
    name,
    run: (input) => {
      log.push(name);
      return Promise.resolve(verdict(input));
    },
  };
};

const build = (inboundStages: InboundStage[], outboundStages: OutboundStage[] = []) => {
  const fake = new FakeLlmProvider();
  const contextService = new RequestContextService();
  const executor = new LlmExecutor(fake, config, contextService);
  const pipeline = new GatewayPipeline(inboundStages, outboundStages, executor, contextService);
  const context: RequestContext = createRequestContext();
  const run = () => contextService.run(context, () => pipeline.run(request));
  return { fake, pipeline, context, run };
};

describe('GatewayPipeline', () => {
  it('runs inbound stages in order, chaining transforms into the provider call', async () => {
    const log: string[] = [];
    const { fake, context, run } = build([
      inbound(
        'a',
        (input) => ({
          kind: 'transform',
          value: {
            request: {
              messages: [
                { role: 'user', content: `${input.request.messages[0]?.content ?? ''} A` },
              ],
            },
          },
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
    expect(context.stages[1]).toMatchObject({
      stage: 'b',
      verdict: 'block',
      reason: 'INJ-A',
      findings: [finding],
    });
    expect(context.exec).toBeUndefined();
  });

  it('runs outbound stages over the response, applying transforms and blocks', async () => {
    const log: string[] = [];
    const redact = outbound(
      'redact',
      (input) => ({
        kind: 'transform',
        value: { ...input, response: { ...input.response, content: 'redacted' } },
      }),
      log,
    );
    const { run } = build([], [redact]);

    const result = await run();

    expect(result.kind).toBe('completed');
    if (result.kind === 'completed') {
      expect(result.response.content).toBe('redacted');
    }

    const blockLog: string[] = [];
    const blocker = outbound(
      'leak',
      () => ({ kind: 'block', reason: 'SECRET', findings: [] }),
      blockLog,
    );
    const blocked = await build([], [blocker]).run();

    expect(blocked).toEqual({
      kind: 'blocked',
      phase: 'outbound',
      stage: 'leak',
      reason: 'SECRET',
    });
  });

  it('fails closed when a stage throws: error outcome, PipelineStageError, provider not called', async () => {
    const log: string[] = [];
    const broken: InboundStage = {
      name: 'broken',
      run: () => Promise.reject(new Error('detector crashed')),
    };
    const { fake, context, run } = build([broken, inbound('after', () => ({ kind: 'pass' }), log)]);

    const failure: unknown = await run().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PipelineStageError);
    expect(failure).toMatchObject({ stage: 'broken', phase: 'inbound' });
    expect(log).toEqual([]);
    expect(fake.calls).toHaveLength(0);
    expect(context.stages[0]).toMatchObject({
      stage: 'broken',
      verdict: 'error',
      reason: 'stage_error',
    });
  });

  it('records real durations for a slow stage', async () => {
    const slow: InboundStage = {
      name: 'slow',
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return { kind: 'pass' };
      },
    };
    const { context, run } = build([slow]);

    await run();

    expect(context.stages[0]?.durationMs).toBeGreaterThanOrEqual(10);
  });

  it('fails closed when an outbound stage throws, recording the outbound phase', async () => {
    const broken: OutboundStage = {
      name: 'broken-out',
      run: () => Promise.reject(new Error('validator crashed')),
    };
    const { context, run } = build([], [broken]);

    await expect(run()).rejects.toMatchObject({ stage: 'broken-out', phase: 'outbound' });
    expect(context.stages[0]).toMatchObject({
      stage: 'broken-out',
      phase: 'outbound',
      verdict: 'error',
      reason: 'stage_error',
    });
  });

  it('chains outbound transforms and returns the final request and response', async () => {
    const log: string[] = [];
    const rename = inbound(
      'rename',
      (input) => ({ kind: 'transform', value: { request: { ...input.request, system: 'added' } } }),
      log,
    );
    const first = outbound(
      'first',
      (input) => ({
        kind: 'transform',
        value: { ...input, response: { ...input.response, content: 'one' } },
      }),
      log,
    );
    const second = outbound(
      'second',
      (input) => ({
        kind: 'transform',
        value: {
          ...input,
          response: { ...input.response, content: `${input.response.content} two` },
        },
      }),
      log,
    );
    const { run } = build([rename], [first, second]);

    const result = await run();

    expect(log).toEqual(['rename', 'first', 'second']);
    expect(result).toMatchObject({
      kind: 'completed',
      request: { system: 'added' },
      response: { content: 'one two' },
    });
  });

  it('never writes caller content or stage error text to warn/error logs', async () => {
    const secret = 'SECRET-PAYLOAD-DO-NOT-LOG';
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    try {
      const thrower: InboundStage = {
        name: 'thrower',
        run: () => Promise.reject(new Error(`regex failed on ${secret}`)),
      };
      await expect(build([thrower]).run()).rejects.toBeInstanceOf(PipelineStageError);

      const leaky = inbound(
        'leaky',
        () => ({ kind: 'block', reason: `matched ${secret}`, findings: [] }),
        [],
      );
      const { context, run } = build([leaky]);
      const result = await run();

      expect(result).toEqual({
        kind: 'blocked',
        phase: 'inbound',
        stage: 'leaky',
        reason: 'invalid_reason',
      });
      expect(context.stages[0]?.reason).toBe('invalid_reason');
      expect(errorSpy).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      expect(JSON.stringify([...errorSpy.mock.calls, ...warnSpy.mock.calls])).not.toContain(secret);
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      debugSpy.mockRestore();
    }
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

  it('sanitises a stage name that is not a short code', async () => {
    const log: string[] = [];
    const { context, run } = build([
      inbound('has spaces and $ymbols', () => ({ kind: 'block', reason: 'X', findings: [] }), log),
    ]);

    const result = await run();

    expect(result).toEqual({
      kind: 'blocked',
      phase: 'inbound',
      stage: 'invalid_stage',
      reason: 'X',
    });
    expect(context.stages[0]?.stage).toBe('invalid_stage');
  });
});
