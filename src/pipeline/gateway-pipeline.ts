import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ChatRequest } from '../chat/chat.schemas.js';
import {
  elapsedMs,
  type RequestContext,
  type StagePhase,
} from '../common/context/request-context.js';
import { RequestContextService } from '../common/context/request-context.service.js';
import { LlmExecutor } from '../providers/llm-executor.js';
import type { LlmResponse } from '../providers/llm-provider.js';
import { PipelineStageError } from './pipeline.errors.js';
import {
  INBOUND_STAGES,
  OUTBOUND_STAGES,
  type InboundInput,
  type InboundStage,
  type OutboundInput,
  type OutboundStage,
  type StageVerdict,
} from './stage.js';

export type PipelineResult =
  | { kind: 'completed'; request: ChatRequest; response: LlmResponse }
  | { kind: 'blocked'; phase: StagePhase; stage: string; reason: string };

const REASON_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

const sanitizeCode = (value: string, fallback: string): string => {
  return REASON_PATTERN.test(value) ? value : fallback;
};

/** Structural view shared by both phases; kept private so the generic stays off the public stage contracts. */
interface Stage<T> {
  readonly name: string;
  run(input: T, context: RequestContext): Promise<StageVerdict<T>>;
}

/**
 * Runs inbound stages → provider → outbound stages. Every verdict is timed and appended to
 * the request context. A throwing stage fails the request (fail closed).
 */
@Injectable()
export class GatewayPipeline {
  private readonly logger = new Logger(GatewayPipeline.name);

  constructor(
    @Inject(INBOUND_STAGES) private readonly inboundStages: readonly InboundStage[],
    @Inject(OUTBOUND_STAGES) private readonly outboundStages: readonly OutboundStage[],
    private readonly executor: LlmExecutor,
    private readonly contextService: RequestContextService,
  ) {}

  async run(request: ChatRequest): Promise<PipelineResult> {
    const context = this.contextService.get();

    let input: InboundInput = { request };

    for (const stage of this.inboundStages) {
      const verdict = await this.runStage(stage, 'inbound', input, context);

      if (verdict.kind === 'block') {
        return {
          kind: 'blocked',
          phase: 'inbound',
          stage: sanitizeCode(stage.name, 'invalid_stage'),
          reason: verdict.reason,
        };
      }

      if (verdict.kind === 'transform') {
        input = verdict.value;
      }
    }

    const response = await this.executor.complete(input.request);

    let output: OutboundInput = { request: input.request, response };

    for (const stage of this.outboundStages) {
      const verdict = await this.runStage(stage, 'outbound', output, context);

      if (verdict.kind === 'block') {
        return {
          kind: 'blocked',
          phase: 'outbound',
          stage: sanitizeCode(stage.name, 'invalid_stage'),
          reason: verdict.reason,
        };
      }
      if (verdict.kind === 'transform') {
        output = verdict.value;
      }
    }

    return { kind: 'completed', request: output.request, response: output.response };
  }

  private async runStage<T>(
    stage: Stage<T>,
    phase: StagePhase,
    input: T,
    context: RequestContext,
  ): Promise<StageVerdict<T>> {
    const startedAt = performance.now();

    const name = sanitizeCode(stage.name, 'invalid_stage');

    try {
      const verdict = await stage.run(input, context);

      if (verdict.kind === 'block') {
        const reason = sanitizeCode(verdict.reason, 'invalid_reason');

        context.stages.push({
          stage: name,
          phase,
          verdict: 'block',
          reason,
          findings: verdict.findings,
          durationMs: elapsedMs(startedAt),
        });

        this.logger.warn('Stage blocked request', {
          event: 'stage.blocked',
          stage: name,
          phase,
          reason,
        });

        return { ...verdict, reason };
      }

      context.stages.push({
        stage: name,
        phase,
        verdict: verdict.kind,
        findings: verdict.findings ?? [],
        durationMs: elapsedMs(startedAt),
      });

      return verdict;
    } catch (error: unknown) {
      context.stages.push({
        stage: name,
        phase,
        verdict: 'error',
        reason: 'stage_error',
        findings: [],
        durationMs: elapsedMs(startedAt),
      });

      this.logger.error('Stage threw', {
        event: 'stage.error',
        stage: name,
        phase,
        errorName: error instanceof Error ? error.name : 'non-Error',
      });
      this.logger.debug('Stage error detail', {
        event: 'stage.error.detail',
        stage: name,
        stack: error instanceof Error ? (error.stack ?? error.message) : 'non-Error value thrown',
      });
      throw new PipelineStageError(name, phase, error);
    }
  }
}
