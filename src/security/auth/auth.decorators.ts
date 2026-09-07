import { type CustomDecorator, SetMetadata } from '@nestjs/common';
import type { ApiKeyRole } from './api-key.schema.js';

export const IS_PUBLIC = 'auth:public';
export const REQUIRED_ROLE = 'auth:role';

/** Skips the API key check. Liveness endpoints only. */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC, true);

/** Requires an admin key; client keys get 403. */
export const Admin = (): CustomDecorator => {
  const role: ApiKeyRole = 'admin';
  return SetMetadata(REQUIRED_ROLE, role);
};
