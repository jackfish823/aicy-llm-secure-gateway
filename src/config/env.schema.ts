import { z } from 'zod';
import { appEnvShape } from './domains/app.config.js';
import { authEnvShape } from './domains/auth.config.js';
import { llmEnvShape, requireSelectedProviderKey } from './domains/llm.config.js';
import { mongoEnvShape } from './domains/mongo.config.js';
import { piiEnvShape } from './domains/pii.config.js';
import { rateLimitEnvShape } from './domains/rate-limit.config.js';
import { redisEnvShape } from './domains/redis.config.js';
import { parseEnv } from './parse-env.js';

export const envSchema = z
  .object({
    ...appEnvShape,
    ...mongoEnvShape,
    ...redisEnvShape,
    ...llmEnvShape,
    ...authEnvShape,
    ...rateLimitEnvShape,
    ...piiEnvShape,
  })
  .superRefine(requireSelectedProviderKey);

export type Env = z.output<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  return parseEnv(envSchema, raw);
}
