import { Inject, Injectable, type LoggerService, Optional } from '@nestjs/common';
import pino, { type DestinationStream, type Level, type Logger as PinoLogger } from 'pino';
import { appConfig, type AppConfig } from '../../config/domains/app.config.js';
import { RequestContextService } from '../context/request-context.service.js';

/** Where log lines go; tests inject an in-memory stream, production uses stdout. */
export const LOG_STREAM = Symbol('LOG_STREAM');

export type LogFields = Record<string, unknown>;

/** Field names that must never be printed even if a caller passes them by mistake. */
const REDACTED_FIELDS = [
  'apiKey',
  'authorization',
  'content',
  'matchedSegment',
  'messages',
  'system',
];

const NEST_TO_PINO: Record<AppConfig['logLevel'], Level> = {
  fatal: 'fatal',
  error: 'error',
  warn: 'warn',
  log: 'info',
  debug: 'debug',
  verbose: 'trace',
};

const isFields = (value: unknown): value is LogFields =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Error) &&
  Object.getPrototypeOf(value) === Object.prototype;

const toMessage = (message: unknown): string => {
  if (typeof message === 'string') {
    return message;
  }
  return message === undefined ? '' : JSON.stringify(message);
};

/**
 * Pino-backed Nest logger. Every line is JSON `{ level, time, context, msg, requestId?, ...fields }`.
 * Call it through Nest's `Logger`: `this.logger.log('Chat completed', { event: 'chat.completed', model })`.
 * A trailing plain object is merged as structured fields; `requestId` comes from the request
 * context automatically. Never pass message content: it is not a field, and the redact list is
 * only a backstop.
 */
@Injectable()
export class AppLoggerService implements LoggerService {
  private readonly pino: PinoLogger;

  constructor(
    @Inject(appConfig.KEY) config: AppConfig,
    private readonly contextService: RequestContextService,
    @Optional() @Inject(LOG_STREAM) stream?: DestinationStream,
  ) {
    const options: pino.LoggerOptions = {
      level: NEST_TO_PINO[config.logLevel],
      base: { app: 'securellm-gateway' },
      redact: [...REDACTED_FIELDS, ...REDACTED_FIELDS.map((field) => `*.${field}`)],
      ...(config.logPretty && stream === undefined
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, ignore: 'pid,hostname,app' },
            },
          }
        : {}),
    };
    this.pino = stream === undefined ? pino(options) : pino(options, stream);
  }

  log(message: unknown, ...params: unknown[]): void {
    this.write('info', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('trace', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, params);
  }

  private write(level: Level, message: unknown, params: unknown[]): void {
    const rest = [...params];
    const last = rest.at(-1);
    const context = typeof last === 'string' ? last : undefined;
    if (context !== undefined) {
      rest.pop();
    }

    const fields: LogFields = {};
    const extras: string[] = [];

    for (const param of rest) {
      if (isFields(param)) {
        Object.assign(fields, param);
      } else if (typeof param === 'string') {
        extras.push(param);
      }
    }

    if (isFields(message)) {
      Object.assign(fields, message);
    }
    if (level === 'error' && extras.length === 1) {
      fields.stack = extras[0];
    }

    this.pino[level](
      { context, requestId: this.contextService.tryGet()?.requestId, ...fields },
      toMessage(message),
    );
  }
}
