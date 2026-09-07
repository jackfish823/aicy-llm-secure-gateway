import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestContextService } from '../../common/context/request-context.service.js';
import type { ApiKeyRole } from './api-key.schema.js';
import { ApiKeyService } from './api-key.service.js';
import { IS_PUBLIC, REQUIRED_ROLE } from './auth.decorators.js';

export const API_KEY_HEADER = 'x-api-key';

export type AuthRejection = 'missing' | 'invalid' | 'forbidden';

/** 401 for a missing or unknown key, 403 for a known key without the required role. */
export class AuthException extends HttpException {
  constructor(
    readonly reason: AuthRejection,
    requestId: string,
  ) {
    const forbidden = reason === 'forbidden';
    const statusCode = forbidden ? HttpStatus.FORBIDDEN : HttpStatus.UNAUTHORIZED;
    super({ statusCode, error: forbidden ? 'forbidden' : 'unauthorized', requestId }, statusCode);
  }
}

export interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Global guard: every route needs a valid key unless marked @Public(); @Admin() routes need
 * an admin key. Runs after the request-context and body middleware and before pipes. On
 * success the principal is written to the request context for later stages and audit.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeyService,
    private readonly contextService: RequestContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, targets) === true) {
      return true;
    }

    const header = context.switchToHttp().getRequest<AuthRequest>().headers[API_KEY_HEADER];
    if (typeof header !== 'string' || header === '') {
      throw this.reject('missing');
    }

    const identity = await this.apiKeys.findByKey(header);
    if (identity === undefined) {
      throw this.reject('invalid');
    }

    const required = this.reflector.getAllAndOverride<ApiKeyRole | undefined>(
      REQUIRED_ROLE,
      targets,
    );

    if (required !== undefined && identity.role !== required) {
      throw this.reject('forbidden', identity.id);
    }

    this.contextService.get().principal = { apiKeyId: identity.id, roles: [identity.role] };
    return true;
  }

  private reject(reason: AuthRejection, apiKeyId?: string): AuthException {
    this.logger.warn('Request not authenticated', { event: 'auth.rejected', reason, apiKeyId });

    return new AuthException(reason, this.contextService.tryGet()?.requestId ?? 'unknown');
  }
}
