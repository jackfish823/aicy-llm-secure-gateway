import type { LogLevel } from '@nestjs/common';
import { registerAs } from '@nestjs/config';
import { z } from 'zod';
import { parseEnv } from '../parse-env.js';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

const LOG_LEVELS = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const;
type ConfiguredLogLevel = (typeof LOG_LEVELS)[number];

export const appEnvShape = {
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('log'),
};

export const appEnvSchema = z.object(appEnvShape);
export type AppEnv = z.output<typeof appEnvSchema>;

export interface AppConfig {
  env: NodeEnv;
  port: number;
  logLevel: ConfiguredLogLevel;
  logLevels: LogLevel[];
  isProduction: boolean;
}

export const toAppConfig = (env: AppEnv): AppConfig => {
  return {
    env: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    logLevels: LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(env.LOG_LEVEL) + 1),
    isProduction: env.NODE_ENV === 'production',
  };
};

export const appConfigFromEnv = (raw: Record<string, unknown>): AppConfig => {
  return toAppConfig(parseEnv(appEnvSchema, raw));
};

export const appConfig = registerAs('app', () => appConfigFromEnv(process.env));
