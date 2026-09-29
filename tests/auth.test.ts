import { describe, expect, it } from 'vitest';
import { findProxyCredentials } from '../src/core/proxy/auth-manager';
import type { FixedProfile, Profile } from '../src/core/types';

describe('Proxy Auth Manager', () => {
  it('finds credentials for matching proxy server', () => {
    const fixed: FixedProfile = {
      id: 'p1',
      name: 'Authenticated Proxy',
      profileType: 'FixedProfile',
      fallbackProxy: {
        scheme: 'http',
        host: 'proxy.internal',
        port: 8080,
        auth: {
          username: 'admin',
          password: 'secret_password',
        },
      },
      bypassList: [],
    };

    const direct: Profile = {
      id: 'direct',
      name: 'Direct',
      profileType: 'DirectProfile',
    };

    const profiles: Record<string, Profile> = {
      p1: fixed,
      direct: direct,
    };

    // Match exact host & port
    const creds = findProxyCredentials('proxy.internal', 8080, profiles);
    expect(creds).toEqual({ username: 'admin', password: 'secret_password' });

    // Case-insensitive hostname match
    const credsUpper = findProxyCredentials('PROXY.INTERNAL', 8080, profiles);
    expect(credsUpper).toEqual({ username: 'admin', password: 'secret_password' });

    // Wrong port
    expect(findProxyCredentials('proxy.internal', 3128, profiles)).toBeNull();

    // Unknown host
    expect(findProxyCredentials('other.proxy', 8080, profiles)).toBeNull();
  });
});
