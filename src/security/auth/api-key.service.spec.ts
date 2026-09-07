import { describe, expect, it } from 'vitest';
import { InMemoryApiKeyStore } from './api-key.fixture.js';
import { API_KEY_PREFIX, ApiKeyService } from './api-key.service.js';

const PEPPER = 'placeholder-pepper-placeholder-pepper-0000';

const build = (pepper = PEPPER) => {
  const store = new InMemoryApiKeyStore();
  return { store, service: new ApiKeyService({ apiKeyPepper: pepper }, store) };
};

describe('ApiKeyService', () => {
  it('hashes deterministically to 64 hex chars and changes with the pepper', () => {
    const { service } = build();
    const other = build('another-pepper-another-pepper-another-pepper').service;

    expect(service.hash('sk_x')).toMatch(/^[0-9a-f]{64}$/);
    expect(service.hash('sk_x')).toBe(service.hash('sk_x'));
    expect(service.hash('sk_x')).not.toBe(other.hash('sk_x'));
  });

  it('creates a prefixed key and stores only its hash', async () => {
    const { service, store } = build();

    const { key, id } = await service.create('ops', 'admin');

    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key.length).toBe(API_KEY_PREFIX.length + 43);
    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toMatchObject({
      id,
      name: 'ops',
      role: 'admin',
      keyHash: service.hash(key),
    });
    expect(JSON.stringify(store.records)).not.toContain(key);
  });

  it('resolves a created key back to its identity', async () => {
    const { service } = build();
    const { key, id } = await service.create('app', 'client');

    await expect(service.findByKey(key)).resolves.toEqual({ id, name: 'app', role: 'client' });
  });

  it('returns undefined for an unknown key', async () => {
    const { service } = build();
    await service.create('app', 'client');

    await expect(service.findByKey('sk_unknown')).resolves.toBeUndefined();
  });

  it('returns undefined when the stored hash is malformed instead of throwing', async () => {
    const { service, store } = build();
    const { key } = await service.create('app', 'client');
    // findOne matches by hash, so a truncated stored hash would never be found; matchAny forces
    // the constant-time compare path with mismatched buffer lengths.
    store.records[0] = {
      id: '1',
      name: 'app',
      role: 'client',
      keyHash: service.hash(key).slice(0, 62),
    };
    store.matchAny = true;

    await expect(service.findByKey(key)).resolves.toBeUndefined();
  });
});
