import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import { createRequestContext, elapsedMs } from './request-context.js';
import { RequestContextService } from './request-context.service.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/** The parts of the request the middleware reads (Express's `Request` satisfies it). */
export interface RequestSummary {
  method?: string;
  path?: string;
}

/**
 * The parts of the response the middleware uses (Express's `Response` satisfies it).
 * Keeps unit tests free of Express fakes.
 */
export interface ResponseSink {
  setHeader(name: string, value: string): unknown;
  on(event: 'finish', listener: () => void): unknown;
  statusCode: number;
}

const MAX_PATH_CHARS = 200;

/**
 * Opens one RequestContext per request and logs one summary line when the response finishes,
 * whatever the outcome. Runs before guards so they can record the principal. Any
 * client-supplied x-request-id is ignored: ids are always generated here.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestContextMiddleware.name);

  constructor(private readonly contextService: RequestContextService) {}

  use(req: RequestSummary, res: ResponseSink, next: () => void): void {
    const context = createRequestContext();
    res.setHeader(REQUEST_ID_HEADER, context.requestId);
    // 'finish' fires outside the async context, so the id is passed explicitly.
    res.on('finish', () => {
      this.logger.log('Request completed', {
        event: 'http.request',
        requestId: context.requestId,
        method: req.method,
        path: req.path?.slice(0, MAX_PATH_CHARS),
        status: res.statusCode,
        durationMs: elapsedMs(context.startedAt),
      });
    });
    this.contextService.run(context, () => {
      next();
    });
  }
}
