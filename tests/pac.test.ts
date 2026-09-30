import { describe, expect, it } from 'vitest';
import { formatProxyDirective, generatePacScript, generateTestPacScript, resolveProfile } from '../src/core/pac/generator';
import { matchCondition } from '../src/core/pac/matcher';
import type { FixedProfile, Profile, ProxyServer, SwitchProfile, VirtualProfile } from '../src/core/types';

describe('Condition Matcher', () => {
  it('matches HostWildcardCondition correctly', () => {
    // *.google.com should match google.com and sub.google.com
    const cond = {
      conditionType: 'HostWildcardCondition' as const,
      pattern: '*.google.com',
    };
    expect(matchCondition(cond, 'https://google.com/search', 'google.com')).toBe(true);
    expect(matchCondition(cond, 'https://mail.google.com/', 'mail.google.com')).toBe(true);
    expect(matchCondition(cond, 'https://google.cn/', 'google.cn')).toBe(false);
    expect(matchCondition(cond, 'https://fakegoogle.com/', 'fakegoogle.com')).toBe(false);

    // Exact host
    const exact = {
      conditionType: 'HostWildcardCondition' as const,
      pattern: 'example.com',
    };
    expect(matchCondition(exact, 'http://example.com/', 'example.com')).toBe(true);
    expect(matchCondition(exact, 'http://sub.example.com/', 'sub.example.com')).toBe(false);
  });

  it('matches IpCondition with CIDR', () => {
    const cond = {
      conditionType: 'IpCondition' as const,
      pattern: '192.168.0.0/16',
    };
    expect(matchCondition(cond, 'http://192.168.1.100/', '192.168.1.100')).toBe(true);
    expect(matchCondition(cond, 'http://10.0.0.1/', '10.0.0.1')).toBe(false);
  });

  it('matches BypassCondition (<local> and domains)', () => {
    const localCond = {
      conditionType: 'BypassCondition' as const,
      pattern: '<local>',
    };
    expect(matchCondition(localCond, 'http://intranet/', 'intranet')).toBe(true);
    expect(matchCondition(localCond, 'http://127.0.0.1:8080/', '127.0.0.1')).toBe(true);
    expect(matchCondition(localCond, 'http://google.com/', 'google.com')).toBe(false);
  });
});

describe('PAC Generator', () => {
  it('formats proxy directives for all protocols', () => {
    expect(formatProxyDirective({ scheme: 'http', host: '127.0.0.1', port: 7890 }))
      .toBe('PROXY 127.0.0.1:7890');
    expect(formatProxyDirective({ scheme: 'https', host: 'proxy.com', port: 8443 }))
      .toBe('HTTPS proxy.com:8443');
    expect(formatProxyDirective({ scheme: 'socks5', host: '127.0.0.1', port: 1080 }))
      .toBe('SOCKS5 127.0.0.1:1080; SOCKS 127.0.0.1:1080');
    expect(formatProxyDirective({ scheme: 'socks4', host: '127.0.0.1', port: 1080 }))
      .toBe('SOCKS 127.0.0.1:1080');
    expect(formatProxyDirective(undefined)).toBe('DIRECT');
  });

  it('resolves virtual profile pointers with cycle detection', () => {
    const profiles: Record<string, Profile> = {
      fixed: {
        id: 'fixed',
        name: 'Fixed SOCKS5',
        profileType: 'FixedProfile',
        fallbackProxy: { scheme: 'socks5', host: '127.0.0.1', port: 1080 },
        bypassList: [],
      },
      v1: {
        id: 'v1',
        name: 'V1',
        profileType: 'VirtualProfile',
        targetProfileId: 'fixed',
      },
      loopA: {
        id: 'loopA',
        name: 'Loop A',
        profileType: 'VirtualProfile',
        targetProfileId: 'loopB',
      },
      loopB: {
        id: 'loopB',
        name: 'Loop B',
        profileType: 'VirtualProfile',
        targetProfileId: 'loopA',
      },
    };

    expect(resolveProfile('v1', profiles)?.id).toBe('fixed');
    expect(resolveProfile('loopA', profiles)).toBeUndefined();
  });

  it('generates valid executable PAC for SwitchProfile', () => {
    const fixedProxy: FixedProfile = {
      id: 'proxy1',
      name: 'Local Proxy',
      profileType: 'FixedProfile',
      fallbackProxy: { scheme: 'http', host: '127.0.0.1', port: 7890 },
      bypassList: [{ conditionType: 'BypassCondition', pattern: '<local>' }],
    };

    const direct: Profile = {
      id: 'direct',
      name: 'Direct',
      profileType: 'DirectProfile',
    };

    const switchProfile: SwitchProfile = {
      id: 'autoSwitch',
      name: 'Auto Switch',
      profileType: 'SwitchProfile',
      defaultProfileId: 'direct',
      rules: [
        {
          id: 'rule1',
          enabled: true,
          condition: { conditionType: 'HostWildcardCondition', pattern: '*.google.com' },
          profileId: 'proxy1',
        },
        {
          id: 'rule2',
          enabled: true,
          condition: { conditionType: 'HostWildcardCondition', pattern: '*.github.com' },
          profileId: 'proxy1',
        },
      ],
    };

    const profiles: Record<string, Profile> = {
      proxy1: fixedProxy,
      direct: direct,
      autoSwitch: switchProfile,
    };

    const pac = generatePacScript(switchProfile, profiles);

    // Evaluate generated PAC function in JS sandbox
    const sandbox = new Function(`${pac}\nreturn FindProxyForURL;`)();

    expect(sandbox('https://www.google.com/search', 'www.google.com')).toBe('PROXY 127.0.0.1:7890');
    expect(sandbox('https://github.com/zero-peak', 'github.com')).toBe('PROXY 127.0.0.1:7890');
    expect(sandbox('https://baidu.com/', 'baidu.com')).toBe('DIRECT');
  });

  it('generates executable PAC for SwitchProfile with ruleList', () => {
    const fixedProxy: FixedProfile = {
      id: 'proxy1',
      name: 'Local Proxy',
      profileType: 'FixedProfile',
      fallbackProxy: { scheme: 'http', host: '127.0.0.1', port: 7890 },
      bypassList: [],
    };

    const switchProfile: SwitchProfile = {
      id: 'autoSwitch',
      name: 'Auto Switch',
      profileType: 'SwitchProfile',
      defaultProfileId: 'direct',
      rules: [
        {
          id: 'custom',
          enabled: true,
          condition: { conditionType: 'HostWildcardCondition', pattern: '*.custom.com' },
          profileId: 'proxy1',
        },
      ],
      ruleList: {
        id: 'rl1',
        url: 'https://example.com/rules.txt',
        format: 'autoproxy',
        matchProfileId: 'proxy1',
        defaultProfileId: 'direct',
        enabled: true,
        rulesCache: ['||gfw.org', '@@||whitelist.gfw.org'],
      },
    };

    const profiles: Record<string, Profile> = {
      proxy1: fixedProxy,
      direct: { id: 'direct', name: 'Direct', profileType: 'DirectProfile' },
      autoSwitch: switchProfile,
    };

    const pac = generatePacScript(switchProfile, profiles);
    const sandbox = new Function(`${pac}\nreturn FindProxyForURL;`)();

    expect(sandbox('https://sub.custom.com/', 'sub.custom.com')).toBe('PROXY 127.0.0.1:7890');
    expect(sandbox('https://gfw.org/test', 'gfw.org')).toBe('PROXY 127.0.0.1:7890');
    expect(sandbox('https://whitelist.gfw.org/', 'whitelist.gfw.org')).toBe('DIRECT');
    expect(sandbox('https://unmatched.com/', 'unmatched.com')).toBe('DIRECT');
  });

  it('generates test PAC script routing only target host to test proxy', () => {
    const testProxy: ProxyServer = { scheme: 'socks5', host: '192.168.1.10', port: 1080 };
    const targetHost = 'cp.cloudflare.com';
    const pac = generateTestPacScript(testProxy, targetHost);
    const sandbox = new Function(`${pac}\nreturn FindProxyForURL;`)();

    expect(sandbox('http://cp.cloudflare.com/generate_204', 'cp.cloudflare.com')).toBe('SOCKS5 192.168.1.10:1080; SOCKS 192.168.1.10:1080; DIRECT');
    expect(sandbox('https://google.com/', 'google.com')).toBe('DIRECT');
  });
});
