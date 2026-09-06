import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ChatModule } from './chat/chat.module.js';
import { JsonBodyMiddleware } from './common/http/json-body.middleware.js';
import { AppLoggerService } from './common/logger/app-logger.service.js';
import { RequestContextMiddleware } from './common/context/request-context.middleware.js';
import { RequestContextModule } from './common/context/request-context.module.js';
import { AppConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [AppConfigModule.forRoot(), RequestContextModule, HealthModule, ChatModule],
  providers: [AppLoggerService, { provide: APP_PIPE, useClass: StandardSchemaValidationPipe }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Order is load-bearing: the request context must exist before the body is parsed, so
    // parse failures (400/413) still carry x-request-id and get gateway-shaped bodies. Nest's
    // built-in parser is disabled (`bodyParser: false`) in main.ts and in test bootstraps,
    // and RequestContextMiddleware must stay first as more middleware is added.
    consumer.apply(RequestContextMiddleware, JsonBodyMiddleware).forRoutes('{*path}');
  }
}
