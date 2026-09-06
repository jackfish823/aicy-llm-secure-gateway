import { type DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { appConfig } from './domains/app.config.js';
import { authConfig } from './domains/auth.config.js';
import { llmConfig } from './domains/llm.config.js';
import { mongoConfig } from './domains/mongo.config.js';
import { piiConfig } from './domains/pii.config.js';
import { rateLimitConfig } from './domains/rate-limit.config.js';
import { redisConfig } from './domains/redis.config.js';
import { readNodeEnv, resolveEnvFiles } from './env-files.js';
import { validateEnv } from './env.schema.js';

export const CONFIG_FACTORIES = [
  appConfig,
  mongoConfig,
  redisConfig,
  llmConfig,
  authConfig,
  rateLimitConfig,
  piiConfig,
];

@Module({})
export class AppConfigModule {
  static async forRoot(): Promise<DynamicModule> {
    return await ConfigModule.forRoot({
      isGlobal: true,
      ...resolveEnvFiles(readNodeEnv(process.env)),
      validate: validateEnv,
      load: CONFIG_FACTORIES,
    });
  }
}
