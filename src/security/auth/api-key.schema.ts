import { type HydratedDocument, Schema } from 'mongoose';

export const API_KEY_ROLES = ['admin', 'client'] as const;
export type ApiKeyRole = (typeof API_KEY_ROLES)[number];

/** One issued key. `keyHash` is HMAC-SHA256(pepper, key); the plaintext key is never stored. */
export interface ApiKey {
  name: string;
  role: ApiKeyRole;
  keyHash: string;
  createdAt: Date;
}

export type ApiKeyDocument = HydratedDocument<ApiKey>;

/** Injection token for `@InjectModel` and `getModelToken`. */
export const API_KEY_MODEL = 'ApiKey';

export const apiKeySchema = new Schema<ApiKey>(
  {
    name: { type: String, required: true },
    role: { type: String, enum: API_KEY_ROLES, required: true },
    keyHash: { type: String, required: true, unique: true },
  },
  { collection: 'api_keys', timestamps: { createdAt: true, updatedAt: false } },
);
