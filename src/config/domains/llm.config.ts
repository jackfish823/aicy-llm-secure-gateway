import { registerAs } from '@nestjs/config';
import { z } from 'zod';
import { EnvValidationError, parseEnv } from '../parse-env.js';

export const LLM_PROVIDERS = ['anthropic', 'openai'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

type ProviderKeyVar = 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY';

const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);
const optionalEnvString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalEnvUrl = z.preprocess(emptyToUndefined, z.url().optional());

export const llmEnvShape = {
  LLM_PROVIDER: z.enum(LLM_PROVIDERS),
  LLM_MODEL: z.string().min(1),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  LLM_BASE_URL: optionalEnvUrl,
  ANTHROPIC_API_KEY: optionalEnvString,
  OPENAI_API_KEY: optionalEnvString,
};

interface LlmKeyEnv {
  LLM_PROVIDER: LlmProvider;
  ANTHROPIC_API_KEY?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
}

function providerKeyVar(provider: LlmProvider): ProviderKeyVar | undefined {
  switch (provider) {
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
    case 'openai':
      return 'OPENAI_API_KEY';
    default:
      return undefined;
  }
}

function selectedApiKey(env: LlmKeyEnv): string | undefined {
  switch (env.LLM_PROVIDER) {
    case 'anthropic':
      return env.ANTHROPIC_API_KEY;
    case 'openai':
      return env.OPENAI_API_KEY;
    default:
      return undefined;
  }
}

export function requireSelectedProviderKey(env: LlmKeyEnv, ctx: z.RefinementCtx): void {
  const keyVar = providerKeyVar(env.LLM_PROVIDER);
  if (keyVar !== undefined && selectedApiKey(env) === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: [keyVar],
      message: `required when LLM_PROVIDER=${env.LLM_PROVIDER}`,
    });
  }
}

export const llmEnvSchema = z.object(llmEnvShape).superRefine(requireSelectedProviderKey);
export type LlmEnv = z.output<typeof llmEnvSchema>;

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  /** Key of the selected provider only. Never log it. */
  apiKey: string;
  timeoutMs: number;
  /** Optional override, e.g. an internal proxy in front of the provider. */
  baseUrl: string | undefined;
}

export function toLlmConfig(env: LlmEnv): LlmConfig {
  const apiKey = selectedApiKey(env);
  if (apiKey === undefined) {
    // Unreachable once llmEnvSchema's refinement has run; kept explicit instead of asserting.
    throw new EnvValidationError([
      `${providerKeyVar(env.LLM_PROVIDER) ?? 'LLM_PROVIDER'}: required when LLM_PROVIDER=${env.LLM_PROVIDER}`,
    ]);
  }
  return {
    provider: env.LLM_PROVIDER,
    model: env.LLM_MODEL,
    apiKey,
    timeoutMs: env.LLM_TIMEOUT_MS,
    baseUrl: env.LLM_BASE_URL,
  };
}

export function llmConfigFromEnv(raw: Record<string, unknown>): LlmConfig {
  return toLlmConfig(parseEnv(llmEnvSchema, raw));
}

export const llmConfig = registerAs('llm', () => llmConfigFromEnv(process.env));
