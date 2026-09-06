import type { StagePhase } from '../common/context/request-context.js';

/** A stage threw instead of returning a verdict. The pipeline fails closed. */
export class PipelineStageError extends Error {
  constructor(
    readonly stage: string,
    readonly phase: StagePhase,
    cause: unknown,
  ) {
    super(`pipeline stage "${stage}" (${phase}) failed`, { cause });
    this.name = 'PipelineStageError';
  }
}
