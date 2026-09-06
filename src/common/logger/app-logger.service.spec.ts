import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/domains/app.config.js';
import { createRequestContext } from '../context/request-context.js';
import { RequestContextService } from '../context/request-context.service.js';
import { AppLoggerService } from './app-logger.service.js';

const config: AppConfig = {
  env: 'test',
  port: 3000,
  logLevel: 'log',
  logLevels: ['fatal', 'error', 'warn', 'log'],
  logPretty: false,
  isProduction: false,
};

const build = (overrides: Partial<AppConfig> = {}) => {
  const lines: string[] = [];
  const contextService = new RequestContextService();
  const logger = new AppLoggerService({ ...config, ...overrides }, contextService, {
    write: (line: string) => {
      lines.push(line);
    },
  });
  const entries = (): Record<string, unknown>[] =>
    lines.map((line) => {
      const parsed: unknown = JSON.parse(line);
      return typeof parsed === 'object' && parsed !== null ? { ...parsed } : {};
    });
  return { logger, contextService, entries };
};

describe('AppLoggerService', () => {
  it('writes one JSON line with level, context, message and merged fields', () => {
    const { logger, entries } = build();

    logger.log(
      'Chat completed',
      { event: 'chat.completed', model: 'claude-opus-5' },
      'ChatService',
    );

    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({
      level: 30,
      context: 'ChatService',
      msg: 'Chat completed',
      event: 'chat.completed',
      model: 'claude-opus-5',
      app: 'securellm-gateway',
    });
  });

  it('injects requestId inside a request context and omits it outside', () => {
    const { logger, contextService, entries } = build();
    const context = createRequestContext();

    logger.warn('outside', 'X');
    contextService.run(context, () => {
      logger.warn('inside', 'X');
    });

    expect(entries()[0]).not.toHaveProperty('requestId');
    expect(entries()[1]).toMatchObject({ requestId: context.requestId, msg: 'inside' });
  });

  it('honours LOG_LEVEL', () => {
    const { logger, entries } = build({ logLevel: 'warn' });

    logger.log('dropped', 'X');
    logger.debug('dropped', 'X');
    logger.warn('kept', 'X');
    logger.error('kept', 'X');

    expect(entries().map((entry) => entry.msg)).toEqual(['kept', 'kept']);
  });

  it('redacts fields that must never be printed, even nested one level', () => {
    const { logger, entries } = build();

    logger.log('oops', { apiKey: 'sk-secret', nested: { content: 'private text' }, ok: 1 }, 'X');

    const line = JSON.stringify(entries()[0]);
    expect(line).not.toContain('sk-secret');
    expect(line).not.toContain('private text');
    expect(entries()[0]).toMatchObject({ ok: 1 });
  });

  it("maps Nest's error(message, stack, context) convention to a stack field", () => {
    const { logger, entries } = build();

    logger.error('boom', 'Error: boom\n    at somewhere', 'X');

    expect(entries()[0]).toMatchObject({ level: 50, msg: 'boom', context: 'X' });
    expect(entries()[0]?.stack).toContain('at somewhere');
  });

  it('serialises a non-string message and treats an object message as fields', () => {
    const { logger, entries } = build();

    logger.log({ event: 'raw.object', count: 2 }, 'X');
    logger.log(42, 'X');

    expect(entries()[0]).toMatchObject({ event: 'raw.object', count: 2 });
    expect(entries()[1]).toMatchObject({ msg: '42' });
  });
});
