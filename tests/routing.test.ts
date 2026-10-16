import { describe, expect, it } from 'vitest';
import { resolveRouting } from '../src/core/routing';
import type { AppSettings, FixedProfile, SwitchProfile } from '../src/core/types';

const direct = { id: 'direct', name: 'Direct', profileType: 'DirectProfile' } as const;
const proxy: FixedProfile = {
  id: 'proxy', name: 'Proxy', profileType: 'FixedProfile',
  fallbackProxy: { scheme: 'http', host: '127.0.0.1', port: 7890 },
  bypassList: [{ id: 'b1', conditionType: 'BypassCondition', pattern: '<local>' }],
};
const sw: SwitchProfile = {
  id: 'auto', name: 'Auto', profileType: 'SwitchProfile', defaultProfileId: 'direct',
  rules: [{
    id: 'r1', profileId: 'proxy', enabled: true,
    condition: { conditionType: 'HostWildcardCondition', pattern: '*.google.com' },
  }],
};

function settingsWith(activeProfileId: string): AppSettings {
  return { activeProfileId, profiles: { direct, proxy, auto: sw }, order: ['auto'] } as unknown as AppSettings;
}

describe('resolveRouting', () => {
  it('proxied host under switch profile returns proxy', () => {
    expect(resolveRouting(settingsWith('auto'), 'https://www.google.com/', 'www.google.com')).toBe('proxy');
  });
  it('unmatched host falls back to direct', () => {
    expect(resolveRouting(settingsWith('auto'), 'https://example.com/', 'example.com')).toBe('direct');
  });
  it('fixed profile: bypass match is direct, else proxy', () => {
    const s = settingsWith('proxy');
    expect(resolveRouting(s, 'http://localhost:8080/', 'localhost')).toBe('direct');
    expect(resolveRouting(s, 'https://example.com/', 'example.com')).toBe('proxy');
  });
});
