import { describe, expect, it } from 'vitest';
import { mongoConfigFromEnv } from './mongo.config.js';

describe('mongo config', () => {
  it('requires MONGO_URI', () => {
    expect(() => mongoConfigFromEnv({})).toThrow(/MONGO_URI/);
  });

  it('accepts mongodb:// URIs', () => {
    expect(mongoConfigFromEnv({ MONGO_URI: 'mongodb://localhost:27017/securellm' })).toEqual({
      uri: 'mongodb://localhost:27017/securellm',
    });
  });

  it('accepts mongodb+srv:// URIs', () => {
    expect(
      mongoConfigFromEnv({ MONGO_URI: 'mongodb+srv://cluster.example.com/securellm' }).uri,
    ).toBe('mongodb+srv://cluster.example.com/securellm');
  });

  it('rejects other schemes', () => {
    expect(() => mongoConfigFromEnv({ MONGO_URI: 'postgres://localhost/db' })).toThrow(/MONGO_URI/);
  });
});
