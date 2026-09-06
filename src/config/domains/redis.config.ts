import { registerAs } from '@nestjs/config';
import { z } from 'zod';
import { parseEnv } from '../parse-env.js';

export const redisEnvShape = {
  REDIS_URL: z.string().regex(/^rediss?:\/\/\S+$/, 'must be a redis:// or rediss:// URL'),
  REDIS_KEY_PREFIX: z.string().min(1).default('sllm:'),
};

export const redisEnvSchema = z.object(redisEnvShape);
export type RedisEnv = z.output<typeof redisEnvSchema>;

export interface RedisConfig {
  url: string;
  keyPrefix: string;
}

export const toRedisConfig = (env: RedisEnv): RedisConfig => {
  return { url: env.REDIS_URL, keyPrefix: env.REDIS_KEY_PREFIX };
};

export const redisConfigFromEnv = (raw: Record<string, unknown>): RedisConfig => {
  return toRedisConfig(parseEnv(redisEnvSchema, raw));
};

export const redisConfig = registerAs('redis', () => redisConfigFromEnv(process.env));
