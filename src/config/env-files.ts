import { z } from 'zod';
import { appEnvShape, type NodeEnv } from './domains/app.config.js';
import { parseEnv } from './parse-env.js';

export interface EnvFileOptions {
  ignoreEnvFile: boolean;
  envFilePath: string[];
}

export function resolveEnvFiles(nodeEnv: NodeEnv): EnvFileOptions {
  switch (nodeEnv) {
    case 'development':
      return { ignoreEnvFile: false, envFilePath: ['.env.local', '.env'] };
    case 'test':
      return { ignoreEnvFile: false, envFilePath: ['.env.test'] };
    case 'production':
      return { ignoreEnvFile: true, envFilePath: [] };
  }
}

const nodeEnvSchema = z.object({ NODE_ENV: appEnvShape.NODE_ENV });

export function readNodeEnv(raw: Record<string, unknown>): NodeEnv {
  return parseEnv(nodeEnvSchema, raw).NODE_ENV;
}
