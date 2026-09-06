import { type ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';
import { RequestContextService } from '../common/context/request-context.service.js';
import { PipelineStageError } from '../pipeline/pipeline.errors.js';
import { LlmProviderError } from '../providers/llm-provider.js';

/**
 * The gateway's single exception boundary. HttpExceptions (validation 400s, blocks, 404s,
 * body-parse failures) keep Nest's default handling; provider and pipeline failures get
 * gateway-shaped bodies; anything else becomes a content-free 500. No branch ever emits an
 * error message to the client, and logs carry only class names, kinds, statuses and ids.
 */
@Catch()
export class GatewayExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(GatewayExceptionFilter.name);

  constructor(private readonly contextService: RequestContextService) {
    super();
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException) {
      super.catch(exception, host);
      return;
    }

    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) {
      return;
    }
    const requestId = this.contextService.tryGet()?.requestId ?? 'unknown';

    if (exception instanceof LlmProviderError) {
      const statusCode =
        exception.kind === 'timeout' ? HttpStatus.GATEWAY_TIMEOUT : HttpStatus.BAD_GATEWAY;
      const status = exception.status === undefined ? '' : ` (${exception.status})`;
      this.logger.error(`upstream ${exception.kind}${status} [${requestId}]`);
      // The provider's own error is only ever visible at debug (off by default).
      this.logger.debug(
        exception.cause instanceof Error
          ? `${exception.cause.name}: ${exception.cause.message}`
          : 'no provider cause attached',
      );
      response
        .status(statusCode)
        .json({ statusCode, error: 'upstream_error', kind: exception.kind, requestId });
      return;
    }

    if (exception instanceof PipelineStageError) {
      const statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      response
        .status(statusCode)
        .json({ statusCode, error: 'pipeline_failure', stage: exception.stage, requestId });
      return;
    }

    const statusCode = HttpStatus.INTERNAL_SERVER_ERROR;

    this.logger.error(
      `unhandled ${exception instanceof Error ? exception.name : typeof exception} [${requestId}]`,
    );
    this.logger.debug(
      exception instanceof Error
        ? (exception.stack ?? exception.message)
        : 'non-Error value thrown',
    );

    response.status(statusCode).json({ statusCode, error: 'internal_error', requestId });
  }
}
