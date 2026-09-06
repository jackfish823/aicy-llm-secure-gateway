import { Controller, Get } from '@nestjs/common';

export interface HealthStatus {
  status: 'ok';
}

@Controller('healthz')
export class HealthController {
  @Get()
  check(): HealthStatus {
    return { status: 'ok' };
  }
}
