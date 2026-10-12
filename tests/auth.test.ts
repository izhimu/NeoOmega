import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTempProxyCredentials,
  findProxyCredentials,
  getCredsCache,
  initAuthManager,
  isChallengeLooping,
  rebuildCache,
  resetChallengeTracker,
  setTempProxyCredentials,
} from '../src/core/proxy/auth-manager';
import type { AppSettings, FixedProfile, Profile } from '../src/core/types';
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

  it('rebuildCache gives priority to active profile credentials on host:port collision', () => {
    const p1: FixedProfile = {
      id: 'p1',
      name: 'Proxy 1',
      profileType: 'FixedProfile',
      fallbackProxy: { scheme: 'http', host: 'shared.proxy', port: 8080, auth: { username: 'u1', password: 'p1' } },
      bypassList: [],
    };
    const p2: FixedProfile = {
      id: 'p2',
      name: 'Proxy 2',
      profileType: 'FixedProfile',
      fallbackProxy: { scheme: 'http', host: 'shared.proxy', port: 8080, auth: { username: 'u2', password: 'p2' } },
      bypassList: [],
    };

    const settings: AppSettings = {
      activeProfileId: 'p1',
      profiles: { p1, p2 },
      order: ['p1', 'p2'],
      theme: 'auto',
      enableErrorMonitoring: false,
    };

    rebuildCache(settings);
    const cache1 = getCredsCache();
    expect(cache1?.get('shared.proxy:8080')).toEqual({ username: 'u1', password: 'p1' });

    // When p2 is active, p2 credentials must win
    settings.activeProfileId = 'p2';
    rebuildCache(settings);
    const cache2 = getCredsCache();
    expect(cache2?.get('shared.proxy:8080')).toEqual({ username: 'u2', password: 'p2' });

    // Active SwitchProfile routing to p2: p2 creds must win over p1
    const sw: Profile = {
      id: 'sw',
      name: 'Auto',
      profileType: 'SwitchProfile',
      color: '#a855f7',
      defaultProfileId: 'p1',
      rules: [
        {
          id: 'r1',
          enabled: true,
          condition: { conditionType: 'HostWildcardCondition', pattern: '*.corp.com' },
          profileId: 'p2',
        },
      ],
    } as Profile;
    settings.profiles['sw'] = sw;
    settings.activeProfileId = 'sw';
    rebuildCache(settings);
    expect(getCredsCache()?.get('shared.proxy:8080')).toEqual({ username: 'u2', password: 'p2' });
  });

  it('isChallengeLooping guards against infinite 407 re-challenges', () => {
    resetChallengeTracker();
    const host = 'auth.proxy';
    const port = 8080;

    // Same request re-challenged (wrong password loop): blocked at 4th retry
    expect(isChallengeLooping(host, port, 'req-1', 1000)).toBe(false); // 1
    expect(isChallengeLooping(host, port, 'req-1', 2000)).toBe(false); // 2
    expect(isChallengeLooping(host, port, 'req-1', 3000)).toBe(false); // 3
    expect(isChallengeLooping(host, port, 'req-1', 4000)).toBe(true);  // 4 -> blocked
    // Whole host:port blocked for 60s, any request
    expect(isChallengeLooping(host, port, 'req-2', 30000)).toBe(true);

    // After 60s cooldown elapses: reset on next challenge
    expect(isChallengeLooping(host, port, 'req-2', 65000)).toBe(false);
  });

  it('isChallengeLooping tolerates parallel connections (no false lockout)', () => {
    resetChallengeTracker();
    const host = 'auth.proxy';
    const port = 8080;

    // 6 parallel sockets each challenged once within the same second
    for (let i = 0; i < 6; i++) {
      expect(isChallengeLooping(host, port, `conn-${i}`, 1000)).toBe(false);
    }
  });

  it('rebuildCache lifts the loop block (fixed password takes effect immediately)', () => {
    resetChallengeTracker();
    const host = 'auth.proxy';
    const port = 8080;
    for (let t = 0; t < 4; t++) isChallengeLooping(host, port, 'req-1', 1000 + t * 1000);
    expect(isChallengeLooping(host, port, 'req-2', 5000)).toBe(true);

    rebuildCache({ profiles: {}, activeProfileId: 'direct', order: [] } as unknown as AppSettings);
    expect(isChallengeLooping(host, port, 'req-2', 5000)).toBe(false);
  });

  it('onAuthRequired respects isProxy, tabId for temp credentials, and loop guard', () => {
    resetChallengeTracker();
    clearTempProxyCredentials();

    type AuthListener = (
      details: { isProxy: boolean; challenger: { host: string; port: number }; tabId: number; requestId: string },
      callback?: (res: { authCredentials?: { username: string; password?: string } }) => void
    ) => void;
    let listener: AuthListener | null = null;
    const mockChrome = {
      webRequest: {
        onAuthRequired: {
          addListener: (fn: AuthListener) => {
            listener = fn;
          },
        },
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
        },
        onChanged: {
          addListener: vi.fn(),
        },
      },
    };
    Object.assign(globalThis, { chrome: mockChrome });

    initAuthManager();
    expect(listener).not.toBeNull();

    // 1. details.isProxy === false -> origin challenge rejected
    const originCb = vi.fn();
    listener!({ isProxy: false, challenger: { host: 'origin.com', port: 443 }, tabId: 1, requestId: 'r1' }, originCb);
    expect(originCb).toHaveBeenCalledWith({});

    // 2. tempProxyAuth only applies to SW-internal fetches (tabId === -1)
    setTempProxyCredentials('temp.proxy', 8080, { username: 'sw_user', password: 'sw_pass' });
    const swCb = vi.fn();
    listener!({ isProxy: true, challenger: { host: 'temp.proxy', port: 8080 }, tabId: -1, requestId: 'r2' }, swCb);
    expect(swCb).toHaveBeenCalledWith({ authCredentials: { username: 'sw_user', password: 'sw_pass' } });

    // Real browsing tab (tabId >= 0) must NOT receive tempProxyAuth creds
    const tabCb = vi.fn();
    listener!({ isProxy: true, challenger: { host: 'temp.proxy', port: 8080 }, tabId: 42, requestId: 'r3' }, tabCb);
    expect(tabCb).toHaveBeenCalledWith({});
  });
});
