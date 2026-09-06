import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestContext } from './request-context.js';

export class RequestContextMissingError extends Error {
  constructor() {
    super('No request context: code ran outside RequestContextService.run()');
    this.name = 'RequestContextMissingError';
  }
}

/** One store per process, so a duplicate DI registration cannot fragment the context. */
const storage = new AsyncLocalStorage<RequestContext>();

/** AsyncLocalStorage wrapper. One context per HTTP request, established by the middleware. */
@Injectable()
export class RequestContextService {
  run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  }

  get(): RequestContext {
    const context = storage.getStore();
    if (context === undefined) {
      throw new RequestContextMissingError();
    }
    return context;
  }

  tryGet(): RequestContext | undefined {
    return storage.getStore();
  }
}
