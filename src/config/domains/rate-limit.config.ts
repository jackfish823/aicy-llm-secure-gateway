import { registerAs } from '@nestjs/config';
import { z } from 'zod';
import { parseEnv } from '../parse-env.js';

export const rateLimitEnvShape = {
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
};

export const rateLimitEnvSchema = z.object(rateLimitEnvShape);
export type RateLimitEnv = z.output<typeof rateLimitEnvSchema>;

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

export function toRateLimitConfig(env: RateLimitEnv): RateLimitConfig {
  return { windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX };
}

export function rateLimitConfigFromEnv(raw: Record<string, unknown>): RateLimitConfig {
  return toRateLimitConfig(parseEnv(rateLimitEnvSchema, raw));
}

export const rateLimitConfig = registerAs('rateLimit', () => rateLimitConfigFromEnv(process.env));
