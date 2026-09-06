import { describe, expect, it } from 'vitest';
import { JSON_BODY_LIMIT, toBodyException } from './json-body.middleware.js';

describe('toBodyException', () => {
  it('maps a 413 parser error to body_too_large', () => {
    const exception = toBodyException({ status: 413, message: 'request entity too large' }, 'r1');

    expect(exception.getStatus()).toBe(413);
    expect(exception.getResponse()).toEqual({
      statusCode: 413,
      error: 'body_too_large',
      requestId: 'r1',
    });
  });

  it('maps every other failure to invalid_body without the parser message', () => {
    const parseError = new SyntaxError(
      'Unexpected token \'"\', "PRIVATE-BYTES"... is not valid JSON',
    );

    for (const error of [parseError, { status: 415 }, 'string error', null, undefined]) {
      const exception = toBodyException(error, 'r2');

      expect(exception.getStatus()).toBe(400);
      expect(exception.getResponse()).toEqual({
        statusCode: 400,
        error: 'invalid_body',
        requestId: 'r2',
      });
      expect(JSON.stringify(exception.getResponse())).not.toContain('PRIVATE-BYTES');
    }
  });

  it('exposes the documented body limit', () => {
    expect(JSON_BODY_LIMIT).toBe('10mb');
  });
});
