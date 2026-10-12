import { describe, expect, it } from 'vitest';
import { parseSwitchyOmegaBackup } from '../src/core/parsers/switchyomega';

describe('SwitchyOmega Backup Parser', () => {
  it('correctly parses SwitchyOmega/ZeroOmega .bak JSON format', () => {
    const rawBackup = JSON.stringify({
      schemaVersion: 2,
      '-startupProfileName': 'auto switch',
      '+proxy': {
        name: 'proxy',
        profileType: 'FixedProfile',
        color: '#99ccee',
        fallbackProxy: {
          port: 7890,
          scheme: 'http',
          host: '127.0.0.1',
        },
        bypassList: [
          { pattern: '127.0.0.1', conditionType: 'BypassCondition' },
          { pattern: '<local>', conditionType: 'BypassCondition' },
        ],
      },
      '+auto switch': {
        name: 'auto switch',
        profileType: 'SwitchProfile',
        color: '#99dd99',
        defaultProfileName: 'direct',
        rules: [
          {
            condition: {
              pattern: '*.google.com',
              conditionType: 'HostWildcardCondition',
            },
            profileName: 'proxy',
            note: 'Google search',
          },
        ],
      },
    });

    const parsed = parseSwitchyOmegaBackup(rawBackup);

    expect(parsed.activeProfileId).toBe('auto_switch');
    const proxyProfile = parsed.profiles['proxy'];
    expect(proxyProfile).toBeDefined();
    expect(proxyProfile?.profileType).toBe('FixedProfile');

    const switchProfile = parsed.profiles['auto_switch'];
    expect(switchProfile).toBeDefined();
    if (switchProfile?.profileType === 'SwitchProfile') {
      expect(switchProfile.rules).toHaveLength(1);
      expect(switchProfile.rules[0]?.condition.pattern).toBe('*.google.com');
      expect(switchProfile.rules[0]?.profileId).toBe('proxy');
    }
  });

  it('preserves socks5 proxyForHttps, protects builtin mappings, and skips unsupported profileTypes', () => {
    const rawBackup = JSON.stringify({
      schemaVersion: 2,
      '+direct': {
        name: 'direct',
        profileType: 'FixedProfile',
        proxyForHttps: { scheme: 'socks5', host: '10.0.0.2', port: 1080 },
      },
      '+unsupported': {
        name: 'unsupported',
        profileType: 'SystemProfile',
      },
      '+sw': {
        name: 'sw',
        profileType: 'SwitchProfile',
        defaultProfileName: 'direct',
        rules: [
          { condition: { conditionType: 'HostWildcardCondition', pattern: '*.a.com' }, profileName: 'direct' },
          { condition: { conditionType: 'HostWildcardCondition', pattern: '*.b.com' }, profileName: 'unsupported' },
        ],
      },
    });
    const parsed = parseSwitchyOmegaBackup(rawBackup);
    const customDirect = parsed.profiles['direct_2'];
    expect(customDirect?.profileType).toBe('FixedProfile');
    if (customDirect?.profileType === 'FixedProfile') {
      expect(customDirect.proxyForHttps).toEqual({ scheme: 'socks5', host: '10.0.0.2', port: 1080 });
      expect(customDirect.fallbackProxy).toEqual({ scheme: 'socks5', host: '10.0.0.2', port: 1080 });
    }
    expect(parsed.profiles['unsupported']).toBeUndefined();
    const sw = parsed.profiles['sw'];
    if (sw?.profileType === 'SwitchProfile') {
      expect(sw.defaultProfileId).toBe('direct');
      expect(sw.rules[0]?.profileId).toBe('direct');
      expect(sw.rules[1]?.profileId).toBe('direct');
    }
  });

  it('throws on empty object or null JSON', () => {
    expect(() => parseSwitchyOmegaBackup('{}')).toThrow('Not a SwitchyOmega backup');
    expect(() => parseSwitchyOmegaBackup('null')).toThrow('Invalid backup file');
  });

  it('forwards proxy auth and proxyForFtp, drops unsafe regex rules', () => {
    const rawBackup = JSON.stringify({
      schemaVersion: 2,
      '+authproxy': {
        profileType: 'FixedProfile',
        fallbackProxy: { scheme: 'http', host: 'gw.corp', port: 3128, auth: { username: 'u', password: 'p' } },
        proxyForFtp: { scheme: 'http', host: 'ftp.corp', port: 21 },
      },
      '+sw': {
        profileType: 'SwitchProfile',
        defaultProfileName: 'direct',
        rules: [
          { condition: { conditionType: 'UrlRegexCondition', pattern: '(a|aa)+$' }, profileName: 'authproxy' },
          { condition: { conditionType: 'HostWildcardCondition', pattern: '*.ok.com' }, profileName: 'authproxy' },
        ],
      },
    });
    const parsed = parseSwitchyOmegaBackup(rawBackup);
    const fp = parsed.profiles['authproxy'];
    if (fp?.profileType !== 'FixedProfile') throw new Error('expected FixedProfile');
    expect(fp.fallbackProxy?.auth).toEqual({ username: 'u', password: 'p' });
    expect(fp.proxyForFtp?.host).toBe('ftp.corp');
    const sw = parsed.profiles['sw'];
    if (sw?.profileType !== 'SwitchProfile') throw new Error('expected SwitchProfile');
    expect(sw.rules).toHaveLength(1);
    expect(sw.rules[0]?.condition.pattern).toBe('*.ok.com');
  });

  it('normalizes malformed native backups (missing order)', () => {
    const native = JSON.stringify({
      activeProfileId: 'direct',
      profiles: { direct: { id: 'direct', name: 'Direct', profileType: 'DirectProfile' } },
    });
    const parsed = parseSwitchyOmegaBackup(native);
    expect(Array.isArray(parsed.order)).toBe(true);
    expect(parsed.order).toContain('direct');
  });
});
