import { describe, expect, it } from 'vitest';
import { parseSwitchyOmegaBackup } from '../src/core/parsers/switchyomega';
import { DEFAULT_SETTINGS } from '../src/core/storage/storage';

describe('parseSwitchyOmegaBackup', () => {
  it('round-trips native NeoOmega backup without losing profiles', () => {
    const backup = JSON.stringify({
      ...DEFAULT_SETTINGS,
      activeProfileId: 'proxy',
    });
    const parsed = parseSwitchyOmegaBackup(backup);
    expect(parsed.activeProfileId).toBe('proxy');
    expect(Object.keys(parsed.profiles)).toContain('autoSwitch');
    expect(parsed.profiles['proxy']?.profileType).toBe('FixedProfile');
  });

  it('imports SwitchyOmega .bak profiles', () => {
    const bak = JSON.stringify({
      schemaVersion: 2,
      '+My Proxy': {
        name: 'My Proxy',
        profileType: 'FixedProfile',
        color: '#99ccee',
        fallbackProxy: { scheme: 'socks5', host: '10.0.0.1', port: 1080 },
        bypassList: [{ conditionType: 'BypassCondition', pattern: '<local>' }],
      },
      '+Auto': {
        name: 'Auto',
        profileType: 'SwitchProfile',
        defaultProfileName: 'direct',
        rules: [
          { condition: { conditionType: 'HostWildcardCondition', pattern: '*.example.com' }, profileName: 'My Proxy' },
        ],
      },
      '-startupProfileName': 'Auto',
    });
    const parsed = parseSwitchyOmegaBackup(bak);
    expect(parsed.activeProfileId).toBe('auto');
    const fixed = parsed.profiles['my_proxy'];
    expect(fixed?.profileType).toBe('FixedProfile');
    if (fixed?.profileType === 'FixedProfile') {
      expect(fixed.fallbackProxy).toEqual({ scheme: 'socks5', host: '10.0.0.1', port: 1080 });
    }
    const sw = parsed.profiles['auto'];
    if (sw?.profileType === 'SwitchProfile') {
      expect(sw.rules[0]?.profileId).toBe('my_proxy');
      expect(sw.rules[0]?.condition.pattern).toBe('*.example.com');
    } else {
      throw new Error('auto profile missing');
    }
  });
});
