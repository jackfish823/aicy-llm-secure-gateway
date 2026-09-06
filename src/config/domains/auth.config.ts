import { registerAs } from '@nestjs/config';
import { z } from 'zod';
import { parseEnv } from '../parse-env.js';

export const authEnvShape = {
  AUTH_API_KEY_PEPPER: z.string().min(32),
};

export const authEnvSchema = z.object(authEnvShape);
export type AuthEnv = z.output<typeof authEnvSchema>;

export interface AuthConfig {
  apiKeyPepper: string;
}

export function toAuthConfig(env: AuthEnv): AuthConfig {
  return { apiKeyPepper: env.AUTH_API_KEY_PEPPER };
}

export function authConfigFromEnv(raw: Record<string, unknown>): AuthConfig {
  return toAuthConfig(parseEnv(authEnvSchema, raw));
}

export const authConfig = registerAs('auth', () => authConfigFromEnv(process.env));
