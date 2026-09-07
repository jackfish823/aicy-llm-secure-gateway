import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { authConfig, type AuthConfig } from '../../config/domains/auth.config.js';
import { API_KEY_MODEL, type ApiKey, type ApiKeyRole } from './api-key.schema.js';

export const API_KEY_PREFIX = 'sk_';
const KEY_BYTES = 32;

/** A stored key as the service sees it. */
export interface ApiKeyRecord {
  id: string;
  name: string;
  role: ApiKeyRole;
  keyHash: string;
}

/** The two calls made on the Mongoose model, so tests substitute an in-memory store. */
export interface ApiKeyStore {
  findOne(filter: { keyHash: string }): { exec(): Promise<ApiKeyRecord | null> };
  create(doc: Omit<ApiKey, 'createdAt'>): Promise<ApiKeyRecord>;
}

/** What the guard needs after a successful lookup. Never includes the hash. */
export interface ApiKeyIdentity {
  id: string;
  name: string;
  role: ApiKeyRole;
}

const sameHash = (stored: string, computed: string): boolean => {
  const a = Buffer.from(stored, 'hex');
  const b = Buffer.from(computed, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

@Injectable()
export class ApiKeyService {
  constructor(
    @Inject(authConfig.KEY) private readonly config: AuthConfig,
    @InjectModel(API_KEY_MODEL) private readonly store: ApiKeyStore,
  ) {}

  hash(key: string): string {
    return createHmac('sha256', this.config.apiKeyPepper).update(key).digest('hex');
  }

  async findByKey(key: string): Promise<ApiKeyIdentity | undefined> {
    const keyHash = this.hash(key);
    const record = await this.store.findOne({ keyHash }).exec();
    if (record === null || !sameHash(record.keyHash, keyHash)) {
      return undefined;
    }
    return { id: record.id, name: record.name, role: record.role };
  }

  /** Returns the plaintext key exactly once. Callers must not log it. */
  async create(name: string, role: ApiKeyRole): Promise<{ key: string; id: string }> {
    const key = `${API_KEY_PREFIX}${randomBytes(KEY_BYTES).toString('base64url')}`;
    const record = await this.store.create({ name, role, keyHash: this.hash(key) });
    return { key, id: record.id };
  }
}
