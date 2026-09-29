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
});
