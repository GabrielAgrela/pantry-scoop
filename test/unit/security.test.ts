import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loggerOptions } from '../../src/http/security.ts';

describe('request logging', () => {
  it('drops query strings (OAuth codes) from logged URLs', () => {
    const logged = loggerOptions.serializers.req({ method: 'GET', url: '/auth/callback?code=secret&state=s', ip: '1.2.3.4' });
    assert.deepEqual(logged, { method: 'GET', url: '/auth/callback', ip: '1.2.3.4' });
  });
});
