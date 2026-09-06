import { describe, expect, it } from 'vitest';
import { RequestBlockedException } from './chat.exceptions.js';

describe('RequestBlockedException', () => {
  it('is 400 for inbound blocks and 502 for outbound blocks, with a client-safe body', () => {
    const inbound = new RequestBlockedException('inbound', 'injection', 'INJ-A1', 'req-1');
    const outbound = new RequestBlockedException('outbound', 'output', 'SECRET', 'req-2');

    expect(inbound.getStatus()).toBe(400);
    expect(inbound.getResponse()).toEqual({
      statusCode: 400,
      error: 'request_blocked',
      phase: 'inbound',
      stage: 'injection',
      reason: 'INJ-A1',
      requestId: 'req-1',
    });
    expect(outbound.getStatus()).toBe(502);
    expect(outbound.getResponse()).toMatchObject({ statusCode: 502, phase: 'outbound' });
  });
});
