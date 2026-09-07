import { NestFactory } from '@nestjs/core';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { AppModule } from '../app.module.js';
import { API_KEY_ROLES } from '../security/auth/api-key.schema.js';
import { ApiKeyService } from '../security/auth/api-key.service.js';

const USAGE = 'usage: pnpm keys:create --name <label> --role <admin|client>\n';

const argsSchema = z.object({ name: z.string().min(1), role: z.enum(API_KEY_ROLES) });

const { values } = parseArgs({
  options: { name: { type: 'string' }, role: { type: 'string' } },
});
const args = argsSchema.safeParse(values);
if (!args.success) {
  process.stderr.write(USAGE);
  process.exit(2);
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const { key, id } = await app.get(ApiKeyService).create(args.data.name, args.data.role);
  // The only place a plaintext key is ever written. Shown once; not stored anywhere.
  process.stdout.write(`Created ${args.data.role} key ${id} (${args.data.name}).\n${key}\n`);
} finally {
  await app.close();
}
