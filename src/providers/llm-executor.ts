import { Inject, Injectable } from '@nestjs/common';
import type { ChatRequest } from '../chat/chat.schemas.js';
import { elapsedMs, type ExecOutcome } from '../common/context/request-context.js';
import { RequestContextService } from '../common/context/request-context.service.js';
import { llmConfig, type LlmConfig } from '../config/domains/llm.config.js';
import {
  LLM_PROVIDER,
  LlmProviderError,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from './llm-provider.js';

/**
 * The exec layer: gateway-level conversion (ChatRequest → LlmRequest), the timeout, error
 * normalisation, and the ExecOutcome record. Provider-specific conversion lives in adapters.
 */
@Injectable()
export class LlmExecutor {
  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    @Inject(llmConfig.KEY) private readonly config: LlmConfig,
    private readonly contextService: RequestContextService,
  ) {}

  async complete(request: ChatRequest): Promise<LlmResponse> {
    const llmRequest = this.toLlmRequest(request);
    const signal = AbortSignal.timeout(this.config.timeoutMs);
    const startedAt = performance.now();

    try {
      const response = await this.withDeadline(
        this.provider.complete(llmRequest, { signal }),
        signal,
      );
      this.record({
        provider: this.provider.name,
        model: response.model,
        latencyMs: elapsedMs(startedAt),
        usage: response.usage,
      });
      return response;
    } catch (error: unknown) {
      const latencyMs = elapsedMs(startedAt);
      const providerError = this.normalise(error, signal);
      this.record({
        provider: this.provider.name,
        model: llmRequest.model,
        latencyMs,
        errorKind: providerError.kind,
      });
      throw providerError;
    }
  }

  /** The single place a ChatRequest becomes a provider-neutral LlmRequest. */
  private toLlmRequest(request: ChatRequest): LlmRequest {
    return {
      model: this.config.model,
      messages: request.messages,
      maxTokens: request.maxTokens ?? this.config.maxOutputTokens,
      system: request.system,
    };
  }

  /**
   * Adapters must honour `signal`, but the executor is the backstop: once the deadline passes
   * the call is abandoned and reported as a timeout even if the adapter never settles.
   */
  private async withDeadline(
    call: Promise<LlmResponse>,
    signal: AbortSignal,
  ): Promise<LlmResponse> {
    const cleanup = new AbortController();
    const deadline = new Promise<never>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          reject(this.timeoutError());
        },
        { once: true, signal: cleanup.signal },
      );
    });
    try {
      return await Promise.race([call, deadline]);
    } finally {
      cleanup.abort();
    }
  }

  private normalise(error: unknown, signal: AbortSignal): LlmProviderError {
    if (error instanceof LlmProviderError) {
      return error;
    }
    if (signal.aborted) {
      return this.timeoutError(error);
    }
    return new LlmProviderError('upstream', 'provider call failed', { cause: error });
  }

  private timeoutError(cause?: unknown): LlmProviderError {
    return new LlmProviderError('timeout', `provider call exceeded ${this.config.timeoutMs}ms`, {
      cause,
    });
  }

  private record(outcome: ExecOutcome): void {
    const context = this.contextService.tryGet();
    if (context !== undefined) {
      context.exec = outcome;
    }
  }
}
