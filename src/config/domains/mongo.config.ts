import { registerAs } from '@nestjs/config';
import { z } from 'zod';
import { parseEnv } from '../parse-env.js';

export const mongoEnvShape = {
  MONGO_URI: z
    .string()
    .regex(/^mongodb(\+srv)?:\/\/\S+$/, 'must be a mongodb:// or mongodb+srv:// URI'),
};

export const mongoEnvSchema = z.object(mongoEnvShape);
export type MongoEnv = z.output<typeof mongoEnvSchema>;

export interface MongoConfig {
  uri: string;
}

export const toMongoConfig = (env: MongoEnv): MongoConfig => {
  return { uri: env.MONGO_URI };
};

export const mongoConfigFromEnv = (raw: Record<string, unknown>): MongoConfig => {
  return toMongoConfig(parseEnv(mongoEnvSchema, raw));
};

export const mongoConfig = registerAs('mongo', () => mongoConfigFromEnv(process.env));
