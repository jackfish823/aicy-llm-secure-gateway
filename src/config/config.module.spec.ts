import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppConfigModule } from './config.module.js';
import { appConfig, type AppConfig } from './domains/app.config.js';
import { redisConfig, type RedisConfig } from './domains/redis.config.js';
import { stubEnv, validEnv } from './env.fixture.js';
import type { Env } from './env.schema.js';

describe('AppConfigModule', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('serves validated, typed values through ConfigService and the domain factories', async () => {
    stubEnv(validEnv({ PORT: '4321', REDIS_KEY_PREFIX: 'gw:' }));

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule.forRoot()],
    }).compile();

    const configService = moduleRef.get<ConfigService<Env, true>>(ConfigService);
    expect(configService.get('PORT', { infer: true })).toBe(4321);

    const app = moduleRef.get<AppConfig>(appConfig.KEY);
    expect(app.port).toBe(4321);
    expect(app.env).toBe('test');

    const redis = moduleRef.get<RedisConfig>(redisConfig.KEY);
    expect(redis.keyPrefix).toBe('gw:');

    await moduleRef.close();
  });

  it('refuses to boot on an invalid environment, naming the variable but not the value', async () => {
    stubEnv(validEnv({ MONGO_URI: 'postgres://nope', AUTH_API_KEY_PEPPER: 'tiny-secret' }));

    const boot = AppConfigModule.forRoot();

    await expect(boot).rejects.toThrow(/MONGO_URI/);
    await expect(boot).rejects.toThrow(/AUTH_API_KEY_PEPPER/);
    await expect(boot).rejects.not.toThrow(/tiny-secret/);
  });
});
