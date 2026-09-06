import type { ChatRequest } from '../chat/chat.schemas.js';
import type { Finding, RequestContext } from '../common/context/request-context.js';
import type { LlmResponse } from '../providers/llm-provider.js';

export const INBOUND_STAGES = Symbol('INBOUND_STAGES');
export const OUTBOUND_STAGES = Symbol('OUTBOUND_STAGES');

/** What inbound stages see. Later specs add optional derived fields (e.g. canonical text). */
export interface InboundInput {
  readonly request: ChatRequest;
}

/** What outbound stages see: the final inbound request and the provider's response. */
export interface OutboundInput {
  readonly request: ChatRequest;
  readonly response: LlmResponse;
}

/**
 * A stage's decision. `transform` replaces the input for the following stages;
 * `block` stops the pipeline. Findings are recorded in the request context either way.
 *
 * `reason` must be a short stable code (`INJ-A1`, `PII_SHAPE`, `OUTPUT_SECRET`) matching
 * `[A-Za-z0-9_.:-]{1,64}`: it is logged and returned to the client, so never put matched
 * text in it — that belongs in `findings[].matchedSegment`, which is audit-only. The runner
 * replaces anything else with `invalid_reason`. `findings` may be empty for blocks that are
 * not rule hits (size guards and the like).
 */
export type StageVerdict<T> =
  | { kind: 'pass'; findings?: Finding[] }
  | { kind: 'transform'; value: T; findings?: Finding[] }
  | { kind: 'block'; reason: string; findings: Finding[] };

/** Stages must not mutate `input`; return `transform` with a new value so the audit trail reflects every change. */
export interface InboundStage {
  /** Short stable code; it reaches logs and HTTP bodies, so the runner sanitises it like a block reason. */
  readonly name: string;
  run(input: InboundInput, context: RequestContext): Promise<StageVerdict<InboundInput>>;
}

/** Stages must not mutate `input`; return `transform` with a new value so the audit trail reflects every change. */
export interface OutboundStage {
  /** Short stable code; it reaches logs and HTTP bodies, so the runner sanitises it like a block reason. */
  readonly name: string;
  run(input: OutboundInput, context: RequestContext): Promise<StageVerdict<OutboundInput>>;
}
