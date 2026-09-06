import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from './request-context.js';
import { REQUEST_ID_HEADER, RequestContextMiddleware } from './request-context.middleware.js';
import { RequestContextService } from './request-context.service.js';

describe('RequestContextMiddleware', () => {
  it('creates a context for the handler chain and sets the x-request-id header', () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    const setHeader = vi.fn();
    let seen: RequestContext | undefined;

    middleware.use({}, { setHeader }, () => {
      seen = service.get();
    });

    expect(seen).toBeDefined();
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, seen?.requestId);
    expect(service.tryGet()).toBeUndefined();
  });

  it('gives every request its own context', () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    const ids: string[] = [];
    const next = (): void => {
      ids.push(service.get().requestId);
    };

    middleware.use({}, { setHeader: vi.fn() }, next);
    middleware.use({}, { setHeader: vi.fn() }, next);

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('sets the header before running the chain, so it survives a throwing handler', () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    const setHeader = vi.fn();

    expect(() => {
      middleware.use({}, { setHeader }, () => {
        throw new Error('downstream');
      });
    }).toThrow('downstream');
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, expect.any(String));
  });
});
