import { HttpException, HttpStatus } from '@nestjs/common';
import type { StagePhase } from '../common/context/request-context.js';

/** A security stage blocked the request. Body never includes content or findings. */
export class RequestBlockedException extends HttpException {
  constructor(phase: StagePhase, stage: string, reason: string, requestId: string) {
    const statusCode = phase === 'inbound' ? HttpStatus.BAD_REQUEST : HttpStatus.BAD_GATEWAY;
    super({ statusCode, error: 'request_blocked', phase, stage, reason, requestId }, statusCode);
  }
}
