import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { PipelineModule } from '../pipeline/pipeline.module.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { GatewayExceptionFilter } from './gateway-exception.filter.js';

@Module({
  imports: [PipelineModule],
  controllers: [ChatController],
  providers: [ChatService, { provide: APP_FILTER, useClass: GatewayExceptionFilter }],
})
export class ChatModule {}
