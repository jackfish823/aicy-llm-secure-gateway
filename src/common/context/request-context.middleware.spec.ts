import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from './request-context.js';
import {
  REQUEST_ID_HEADER,
  RequestContextMiddleware,
  type ResponseSink,
} from './request-context.middleware.js';
import { RequestContextService } from './request-context.service.js';

const fakeResponse = (setHeader: ResponseSink['setHeader'] = vi.fn()): ResponseSink => ({
  setHeader,
  on: vi.fn(),
  statusCode: 200,
});

describe('RequestContextMiddleware', () => {
  it('creates a context for the handler chain and sets the x-request-id header', () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    const setHeader = vi.fn();
    let seen: RequestContext | undefined;

    middleware.use({}, fakeResponse(setHeader), () => {
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

    middleware.use({}, fakeResponse(), next);
    middleware.use({}, fakeResponse(), next);

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('sets the header before running the chain, so it survives a throwing handler', () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    const setHeader = vi.fn();

    expect(() => {
      middleware.use({}, fakeResponse(setHeader), () => {
        throw new Error('downstream');
      });
    }).toThrow('downstream');
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, expect.any(String));
  });

  it('logs one summary line with id, method, path, status and duration when the response finishes', () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    let onFinish: (() => void) | undefined;
    const res: ResponseSink = {
      setHeader: vi.fn(),
      on: (_event, listener) => {
        onFinish = listener;
      },
      statusCode: 400,
    };

    try {
      middleware.use({ method: 'POST', path: '/v1/chat' }, res, () => undefined);
      expect(logSpy).not.toHaveBeenCalled();
      onFinish?.();

      expect(logSpy).toHaveBeenCalledTimes(1);
      const fields: unknown = logSpy.mock.calls[0]?.[1];
      expect(fields).toHaveProperty('requestId');
      expect(fields).toMatchObject({
        event: 'http.request',
        method: 'POST',
        path: '/v1/chat',
        status: 400,
      });
    } finally {
      logSpy.mockRestore();
    }
  });
});
