import {
  BadRequestException,
  type HttpException,
  Injectable,
  type NestMiddleware,
  PayloadTooLargeException,
} from '@nestjs/common';
import express, { type NextFunction, type Request, type Response } from 'express';
import { RequestContextService } from '../context/request-context.service.js';

/**
 * JSON body cap. The chat contract allows 64 messages of 32k chars plus a 32k system prompt;
 * at up to 4 UTF-8 bytes per character that is about 8.3 MB, so 10mb leaves headroom for
 * JSON escaping.
 */
export const JSON_BODY_LIMIT = '10mb';

/**
 * Wraps express.json so parser failures become gateway-shaped errors: body-parser's own
 * messages embed a prefix of the raw body, which must never be echoed. Registered after
 * RequestContextMiddleware so the request id is available.
 */
@Injectable()
export class JsonBodyMiddleware implements NestMiddleware {
  private readonly parse = express.json({ limit: JSON_BODY_LIMIT });

  constructor(private readonly contextService: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    this.parse(req, res, (error?: unknown) => {
      if (error === undefined || error === null) {
        next();
        return;
      }
      const requestId = this.contextService.tryGet()?.requestId ?? 'unknown';
      next(toBodyException(error, requestId));
    });
  }
}

/** Body-parser failures → gateway-shaped HttpExceptions; the parser's message is never used. */
export const toBodyException = (error: unknown, requestId: string): HttpException => {
  return statusOf(error) === 413
    ? new PayloadTooLargeException({ statusCode: 413, error: 'body_too_large', requestId })
    : new BadRequestException({ statusCode: 400, error: 'invalid_body', requestId });
};

const statusOf = (error: unknown): number | undefined => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  ) {
    return error.status;
  }
  return undefined;
};
