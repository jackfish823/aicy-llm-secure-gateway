import { Injectable, type NestMiddleware } from '@nestjs/common';
import { createRequestContext } from './request-context.js';
import { RequestContextService } from './request-context.service.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Structural subset of Node's `ServerResponse.setHeader` (Express's `Response` satisfies it).
 * Keeps unit tests free of Express fakes.
 */
export interface HeaderWriter {
  setHeader(name: string, value: string): unknown;
}

/**
 * Opens one RequestContext per request. Runs before guards so they can record the principal.
 * Any client-supplied x-request-id is ignored: ids are always generated here.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly contextService: RequestContextService) {}

  use(_req: unknown, res: HeaderWriter, next: () => void): void {
    const context = createRequestContext();
    res.setHeader(REQUEST_ID_HEADER, context.requestId);
    this.contextService.run(context, () => {
      next();
    });
  }
}
