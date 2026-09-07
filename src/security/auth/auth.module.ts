import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiKeyGuard } from './api-key.guard.js';
import { API_KEY_MODEL, apiKeySchema } from './api-key.schema.js';
import { ApiKeyService } from './api-key.service.js';

/** Registers the global API key guard. Import before any other guard-providing module. */
@Module({
  imports: [MongooseModule.forFeature([{ name: API_KEY_MODEL, schema: apiKeySchema }])],
  providers: [ApiKeyService, { provide: APP_GUARD, useClass: ApiKeyGuard }],
  exports: [ApiKeyService],
})
export class AuthModule {}
