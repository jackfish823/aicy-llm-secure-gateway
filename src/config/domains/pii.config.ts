import { registerAs } from '@nestjs/config';
import { z } from 'zod';
import { parseEnv } from '../parse-env.js';

export const piiEnvShape = {
  /** AES-256-GCM key for reversible PII tokens: 32 bytes as 64 hex chars (`openssl rand -hex 32`). */
  PII_TOKEN_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'must be 32 bytes encoded as 64 hex characters'),
};

export const piiEnvSchema = z.object(piiEnvShape);
export type PiiEnv = z.output<typeof piiEnvSchema>;

export interface PiiConfig {
  /** Raw 32-byte key. Never log or serialise it. */
  tokenKey: Buffer;
}

export function toPiiConfig(env: PiiEnv): PiiConfig {
  return { tokenKey: Buffer.from(env.PII_TOKEN_KEY, 'hex') };
}

export function piiConfigFromEnv(raw: Record<string, unknown>): PiiConfig {
  return toPiiConfig(parseEnv(piiEnvSchema, raw));
}

export const piiConfig = registerAs('pii', () => piiConfigFromEnv(process.env));
