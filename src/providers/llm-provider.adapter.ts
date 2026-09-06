import {
  LlmProviderError,
  llmResponseSchema,
  type LlmCompletionOptions,
  type LlmProvider,
  type LlmProviderName,
  type LlmRequest,
  type LlmResponse,
} from './llm-provider.js';

/**
 * Template for every real provider. `complete()` fixes the sequence
 * convert → send → parse → convert → validate, so an adapter cannot skip request mapping,
 * response validation, or error translation, and cannot hand the gateway a response that
 * violates the neutral contract. Keep the pure conversions in a codec module and make
 * these methods delegate to them. Every failure leaves `complete()` as an LlmProviderError:
 * an already-classified error always wins, and a bug in a pure conversion is non-retryable.
 */
export abstract class LlmProviderAdapter<TRequest, TResponse> implements LlmProvider {
  abstract readonly name: LlmProviderName;

  /** Neutral request → provider-native request. Pure; a throw is classified `bad_request`. */
  protected abstract toProviderRequest(request: LlmRequest): TRequest;

  /**
   * Perform the network call and return the raw result untyped; it is parsed next. Must hand
   * `signal` to the transport: the executor's timeout has no other enforcement mechanism.
   */
  protected abstract send(request: TRequest, signal: AbortSignal): Promise<unknown>;

  /** Validate the raw result (Zod). Throw on mismatch; a plain throw is classified `bad_response`. */
  protected abstract parseProviderResponse(raw: unknown): TResponse;

  /** Provider-native response → neutral response. Pure; a throw is classified `bad_response`. */
  protected abstract toLlmResponse(response: TResponse): LlmResponse;

  /**
   * Anything `send` throws → LlmProviderError with the right kind. The message must be
   * gateway-authored and generic: put the provider's own error in `cause`, never in the
   * message, because the message is logged and drives HTTP mapping.
   */
  protected abstract toProviderError(error: unknown): LlmProviderError;

  /** Do not override: the fixed sequence is the point of this class. */
  async complete(request: LlmRequest, options: LlmCompletionOptions): Promise<LlmResponse> {
    const providerRequest = this.guard('bad_request', 'could not map the request', () =>
      this.toProviderRequest(request),
    );

    let raw: unknown;

    try {
      raw = await this.send(providerRequest, options.signal);
    } catch (error: unknown) {
      throw this.classifySendError(error);
    }

    const parsed = this.guard('bad_response', 'returned an unexpected response shape', () =>
      this.parseProviderResponse(raw),
    );

    const neutral = this.guard('bad_response', 'could not map the response', () =>
      this.toLlmResponse(parsed),
    );

    const validated = llmResponseSchema.safeParse(neutral);

    if (!validated.success) {
      throw new LlmProviderError(
        'bad_response',
        `${this.name} adapter produced an invalid LlmResponse`,
        { cause: validated.error },
      );
    }
    return validated.data;
  }

  /** Runs a pure conversion: an already-classified error passes through, anything else gets `kind`. */
  private guard<T>(kind: 'bad_request' | 'bad_response', what: string, fn: () => T): T {
    try {
      return fn();
    } catch (error: unknown) {
      if (error instanceof LlmProviderError) {
        throw error;
      }
      throw new LlmProviderError(kind, `${this.name} ${what}`, { cause: error });
    }
  }

  /** Already-classified errors win; a broken translator must not lose the original failure. */
  private classifySendError(error: unknown): LlmProviderError {
    if (error instanceof LlmProviderError) {
      return error;
    }
    try {
      return this.toProviderError(error);
    } catch {
      return new LlmProviderError(
        'upstream',
        `${this.name} request failed and its error could not be classified`,
        { cause: error },
      );
    }
  }
}
