import { Module } from '@nestjs/common';
import { llmConfig } from '../config/domains/llm.config.js';
import { LlmExecutor } from './llm-executor.js';
import { createLlmProvider } from './llm-provider.factory.js';
import { LLM_PROVIDER } from './llm-provider.js';

@Module({
  providers: [
    { provide: LLM_PROVIDER, useFactory: createLlmProvider, inject: [llmConfig.KEY] },
    LlmExecutor,
  ],
  exports: [LLM_PROVIDER, LlmExecutor],
})
export class ProvidersModule {}
