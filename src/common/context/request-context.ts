import { randomUUID } from 'node:crypto';
import type { LlmProviderErrorKind, TokenUsage } from '../../providers/llm-provider.js';

/** Identity of a rule that fired. Detectors return these, never booleans (CLAUDE.md). */
export interface Finding {
  readonly ruleId: string;
  readonly category: string;
  /** Raw matched span from the caller's message. Audit store only: never logged, never returned to a client. */
  readonly matchedSegment: string;
  readonly confidence: number;
}

export type StagePhase = 'inbound' | 'outbound';
export type StageVerdictKind = 'pass' | 'transform' | 'block' | 'error';

/**
 * What one pipeline stage decided for this request. CONTAINS CALLER CONTENT through
 * `findings[].matchedSegment`; audit-only. Never log or serialise a StageOutcome wholesale.
 * Written only by GatewayPipeline, which sets `reason` whenever verdict is 'block' or 'error'.
 */
export interface StageOutcome {
  readonly stage: string;
  readonly phase: StagePhase;
  readonly verdict: StageVerdictKind;
  /** Short code, never content. Present for 'block' and 'error' verdicts. */
  readonly reason?: string;
  readonly findings: readonly Finding[];
  readonly durationMs: number;
}

/**
 * What the provider call did for this request. Written only by LlmExecutor: exactly one of
 * `usage` (success) or `errorKind` (failure) is set.
 */
export interface ExecOutcome {
  readonly provider: string;
  readonly model: string;
  readonly latencyMs: number;
  readonly usage?: TokenUsage;
  readonly errorKind?: LlmProviderErrorKind;
}

/** Written by ApiKeyGuard in a later spec. */
export interface Principal {
  apiKeyId: string;
  roles: readonly string[];
}

export interface RequestContext {
  readonly requestId: string;
  readonly startedAt: number;
  readonly stages: StageOutcome[];

  principal?: Principal;
  exec?: ExecOutcome;
}

export function createRequestContext(): RequestContext {
  return { requestId: randomUUID(), startedAt: performance.now(), stages: [] };
}

export function elapsedMs(since: number): number {
  return Math.round((performance.now() - since) * 100) / 100;
}
