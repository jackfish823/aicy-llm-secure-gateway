import { describe, expect, it, vi } from 'vitest';
import { UUID_PATTERN } from '../../config/env.fixture.js';
import { createRequestContext, elapsedMs } from './request-context.js';
import { RequestContextMissingError, RequestContextService } from './request-context.service.js';

describe('createRequestContext', () => {
  it('generates a unique id and starts with no outcomes', () => {
    const first = createRequestContext();
    const second = createRequestContext();

    expect(first.requestId).toMatch(UUID_PATTERN);
    expect(first.requestId).not.toBe(second.requestId);
    expect(first.stages).toEqual([]);
    expect(first.exec).toBeUndefined();
    expect(elapsedMs(first.startedAt)).toBeGreaterThanOrEqual(0);
  });

  it('rounds elapsed time to two decimals', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000.126);
    try {
      expect(elapsedMs(1000)).toBe(0.13);
    } finally {
      now.mockRestore();
    }
  });
});

describe('RequestContextService', () => {
  it('exposes the context inside run()', () => {
    const service = new RequestContextService();
    const context = createRequestContext();

    const seen = service.run(context, () => service.get());

    expect(seen).toBe(context);
    expect(service.run(context, () => service.tryGet())).toBe(context);
  });

  it('throws outside run()', () => {
    const service = new RequestContextService();

    expect(() => service.get()).toThrow(RequestContextMissingError);
    expect(service.tryGet()).toBeUndefined();
  });

  it('isolates concurrent flows', async () => {
    const service = new RequestContextService();
    const first = createRequestContext();
    const second = createRequestContext();

    const [seenFirst, seenSecond] = await Promise.all([
      service.run(first, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return service.get().requestId;
      }),
      service.run(second, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return service.get().requestId;
      }),
    ]);

    expect(seenFirst).toBe(first.requestId);
    expect(seenSecond).toBe(second.requestId);
  });

  it('shares one mutable context across awaits and repeated get() calls', async () => {
    const service = new RequestContextService();
    const context = createRequestContext();

    await service.run(context, async () => {
      service.get().stages.push({
        stage: 'a',
        phase: 'inbound',
        verdict: 'pass',
        findings: [],
        durationMs: 0,
      });
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(service.get().stages).toHaveLength(1);
    });

    expect(context.stages).toHaveLength(1);
    expect(service.tryGet()).toBeUndefined();
  });

  it('restores the outer context after a nested run()', () => {
    const service = new RequestContextService();
    const outer = createRequestContext();
    const inner = createRequestContext();

    service.run(outer, () => {
      expect(service.run(inner, () => service.get())).toBe(inner);
      expect(service.get()).toBe(outer);
    });
  });

  it('separate service instances share the same store', () => {
    const first = new RequestContextService();
    const second = new RequestContextService();
    const context = createRequestContext();

    expect(first.run(context, () => second.tryGet())).toBe(context);
  });
});
