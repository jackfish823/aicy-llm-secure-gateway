import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { API_KEY_MODEL, type ApiKey } from './api-key.schema.js';
import type { ApiKeyRecord, ApiKeyStore } from './api-key.service.js';

/** Stands in for the Mongoose model: the two calls ApiKeyService makes, over an array. */
export class InMemoryApiKeyStore implements ApiKeyStore {
  readonly records: ApiKeyRecord[] = [];
  /** Test hook: return the first record regardless of hash, to exercise the compare path. */
  matchAny = false;

  findOne(filter: { keyHash: string }): { exec(): Promise<ApiKeyRecord | null> } {
    const found = this.matchAny
      ? this.records[0]
      : this.records.find((record) => record.keyHash === filter.keyHash);
    return { exec: () => Promise.resolve(found ?? null) };
  }

  create(doc: Omit<ApiKey, 'createdAt'>): Promise<ApiKeyRecord> {
    const record = { id: String(this.records.length + 1), ...doc };
    this.records.push(record);
    return Promise.resolve(record);
  }
}

/**
 * Boots AppModule without a Mongo server: the Mongoose connection becomes a no-op and the
 * ApiKey model becomes `store`. Everything else (guard, service, hashing) is real.
 */
export const withoutMongo = (
  builder: TestingModuleBuilder,
  store: InMemoryApiKeyStore = new InMemoryApiKeyStore(),
): TestingModuleBuilder =>
  builder
    .overrideProvider(getConnectionToken())
    .useValue({ close: () => Promise.resolve() })
    .overrideProvider(getModelToken(API_KEY_MODEL))
    .useValue(store);
