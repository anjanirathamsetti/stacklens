import { describe, expect, it } from 'vitest';
import { cachedMatcher, DEFAULT_REDACT_KEYS, matcher, resolveOptions } from '../src/core/options';

describe('resolveOptions', () => {
  it('reads environment variables', () => {
    const o = resolveOptions(
      {},
      { STACKLENS_APP: 'svc', STACKLENS_PROJECT: 'p', STACKLENS_ENABLED: 'false', STACKLENS_ENDPOINT: 'http://x/api/ingest' },
    );
    expect(o).toMatchObject({ application: 'svc', project: 'p', enabled: false, endpoint: 'http://x/api/ingest' });
  });

  it('prefers explicit options over env', () => {
    expect(resolveOptions({ application: 'explicit' }, { STACKLENS_APP: 'env' }).application).toBe('explicit');
    expect(resolveOptions({ serviceName: 'alias' }, {}).application).toBe('alias');
  });

  it('defaults to the local server', () => {
    expect(resolveOptions({}, {}).endpoint).toBe('http://localhost:4300/api/ingest');
  });

  it('reads the API key from options or STACKLENS_API_KEY', () => {
    expect(resolveOptions({}, {}).apiKey).toBeUndefined();
    expect(resolveOptions({}, { STACKLENS_API_KEY: 'slk_env' }).apiKey).toBe('slk_env');
    expect(resolveOptions({ apiKey: 'slk_opt' }, { STACKLENS_API_KEY: 'slk_env' }).apiKey).toBe('slk_opt');
  });
});

describe('cachedMatcher', () => {
  it('gives the same answers as the uncached matcher', () => {
    const plain = matcher(DEFAULT_REDACT_KEYS);
    const cached = cachedMatcher(DEFAULT_REDACT_KEYS);
    for (const key of [
      'password',
      'Password',
      'apiKey',
      'API-KEY',
      'authorization',
      'cookie',
      'token',
      'cvv',
      'id',
      'status',
      'passport',
    ]) {
      expect(cached(key)).toBe(plain(key));
      expect(cached(key)).toBe(plain(key)); // second call hits the cache
    }
  });

  it('stays bounded', () => {
    const m = cachedMatcher([/x/], 10);
    for (let i = 0; i < 100; i++) m(`k${i}`);
    expect(m('x')).toBe(true);
  });
});
