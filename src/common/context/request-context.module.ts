import { Global, Module } from '@nestjs/common';
import { RequestContextService } from './request-context.service.js';

@Global()
@Module({
  providers: [RequestContextService],
  exports: [RequestContextService],
})
export class RequestContextModule {}
