import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { AppLoggerService } from './common/logger/app-logger.service.js';
import { appConfig, type AppConfig } from './config/index.js';

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  const { port, env } = app.get<AppConfig>(appConfig.KEY);

  app.useLogger(app.get(AppLoggerService));
  app.flushLogs();
  app.disable('x-powered-by');
  app.enableShutdownHooks();

  await app.listen(port);
  new Logger('Bootstrap').log('SecureLLM Gateway listening', { event: 'app.started', port, env });
};

await bootstrap();
