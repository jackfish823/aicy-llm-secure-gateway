import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestContextModule } from '../common/context/request-context.module.js';
import { AppConfigModule } from '../config/config.module.js';
import { stubEnv, validEnv } from '../config/env.fixture.js';
import { AnthropicProvider } from '../providers/anthropic/anthropic.provider.js';
import { LlmExecutor } from '../providers/llm-executor.js';
import { LLM_PROVIDER, type LlmProvider } from '../providers/llm-provider.js';
import { GatewayPipeline } from './gateway-pipeline.js';
import { PipelineModule } from './pipeline.module.js';
import { INBOUND_STAGES, OUTBOUND_STAGES, type InboundStage, type OutboundStage } from './stage.js';

describe('PipelineModule wiring', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('boots on the validated config and resolves pipeline, executor, provider and frozen stage lists', async () => {
    stubEnv(validEnv());
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule.forRoot(), RequestContextModule, PipelineModule],
    }).compile();

    expect(moduleRef.get(GatewayPipeline)).toBeInstanceOf(GatewayPipeline);
    expect(moduleRef.get(LlmExecutor)).toBeInstanceOf(LlmExecutor);
    expect(moduleRef.get<LlmProvider>(LLM_PROVIDER)).toBeInstanceOf(AnthropicProvider);

    const inbound = moduleRef.get<readonly InboundStage[]>(INBOUND_STAGES);
    const outbound = moduleRef.get<readonly OutboundStage[]>(OUTBOUND_STAGES);
    expect(inbound).toEqual([]);
    expect(outbound).toEqual([]);
    expect(Object.isFrozen(inbound)).toBe(true);
    expect(Object.isFrozen(outbound)).toBe(true);

    await moduleRef.close();
  });
});
