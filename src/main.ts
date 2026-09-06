import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { appConfig, type AppConfig } from './config/index.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const { port, logLevels, env } = app.get<AppConfig>(appConfig.KEY);

  app.useLogger(logLevels);
  app.flushLogs();
  app.enableShutdownHooks();

  await app.listen(port);
  new Logger('Bootstrap').log(`SecureLLM Gateway listening on port ${port} (${env})`);
}

await bootstrap();
