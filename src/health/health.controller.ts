import { Controller, Get } from '@nestjs/common';
import { Public } from '../security/auth/auth.decorators.js';

export interface HealthStatus {
  status: 'ok';
}

@Controller('healthz')
export class HealthController {
  @Public()
  @Get()
  check(): HealthStatus {
    return { status: 'ok' };
  }
}
