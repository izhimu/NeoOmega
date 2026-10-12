import { describe, expect, it } from 'vitest';
import { formatProxyDirective, generatePacScript, generateTestPacScript, generateProbePacScript, generateBatchProbePacScript, resolveProfile } from '../src/core/pac/generator';
import { conditionToPacCode, matchCondition, matchSwitchProfile, matchSwitchProfileFull } from '../src/core/pac/matcher';
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

  it('keeps PAC valid when ruleList contains URL rules with slashes (gfwlist |http://...)', () => {
    const fixedProxy: FixedProfile = {
      id: 'proxy1',
      name: 'Local Proxy',
      profileType: 'FixedProfile',
      fallbackProxy: { scheme: 'socks5', host: '192.168.31.221', port: 1080 },
      bypassList: [],
    };
    const switchProfile: SwitchProfile = {
      id: 'autoSwitch',
      name: 'Auto Switch',
      profileType: 'SwitchProfile',
      defaultProfileId: 'direct',
      rules: [],
      ruleList: {
        id: 'rl1',
        url: 'https://example.com/rules.txt',
        format: 'autoproxy',
        matchProfileId: 'proxy1',
        defaultProfileId: 'direct',
        enabled: true,
        rulesCache: ['|http://blocked.example/path', '@@|http://ok.example/', '/^https?:\\/\\/[^\\/]+blogspot\\.(.*)/'],
      },
    };
    const profiles: Record<string, Profile> = {
      proxy1: fixedProxy,
      direct: { id: 'direct', name: 'Direct', profileType: 'DirectProfile' },
      autoSwitch: switchProfile,
    };

    const pac = generatePacScript(switchProfile, profiles);
    // SyntaxError here = mandatory PAC breaks ALL traffic in Chrome
    const sandbox = new Function(`${pac}\nreturn FindProxyForURL;`)();
    expect(sandbox('http://blocked.example/path', 'blocked.example')).toContain('SOCKS5 192.168.31.221:1080');
    expect(sandbox('http://ok.example/', 'ok.example')).toBe('DIRECT');
    expect(sandbox('https://news.blogspot.com/', 'news.blogspot.com')).toContain('SOCKS5 192.168.31.221:1080');
  });

  it('generates test PAC script routing only target host to test proxy', () => {
    const testProxy: ProxyServer = { scheme: 'socks5', host: '192.168.1.10', port: 1080 };
    const targetHost = 'cp.cloudflare.com';
    const pac = generateTestPacScript(testProxy, targetHost);
    const sandbox = new Function(`${pac}\nreturn FindProxyForURL;`)();

    expect(sandbox('http://cp.cloudflare.com/generate_204', 'cp.cloudflare.com')).toBe('SOCKS5 192.168.1.10:1080; SOCKS 192.168.1.10:1080');
    expect(sandbox('https://google.com/', 'google.com')).toBe('DIRECT');
  });
});

describe('PAC performance codegen', () => {
  const fixedProxy: FixedProfile = {
    id: 'proxy1',
    name: 'Local Proxy',
    profileType: 'FixedProfile',
    fallbackProxy: { scheme: 'http', host: '127.0.0.1', port: 7890 },
    bypassList: [],
  };
  const direct: Profile = { id: 'direct', name: 'Direct', profileType: 'DirectProfile' };

  const makeSwitch = (rulesCache: string[]): SwitchProfile => ({
    id: 'autoSwitch',
    name: 'Auto Switch',
    profileType: 'SwitchProfile',
    defaultProfileId: 'direct',
    rules: [],
    ruleList: {
      id: 'rl1',
      url: 'https://example.com/rules.txt',
      format: 'autoproxy',
      matchProfileId: 'proxy1',
      defaultProfileId: 'direct',
      enabled: true,
      rulesCache,
    },
  });

  const profiles: Record<string, Profile> = { proxy1: fixedProxy, direct };

  it('compiles host-suffix rules into a map lookup instead of linear regexes', () => {
    const pac = generatePacScript(makeSwitch(['||a.com', '@@||b.a.com', '||c.net']), profiles);
    expect(() => new Function(`${pac}\nreturn FindProxyForURL;`)).not.toThrow();
    const sandbox = new Function(`${pac}\nreturn FindProxyForURL;`)();
    expect(sandbox('https://a.com/', 'a.com')).toBe('PROXY 127.0.0.1:7890');
    expect(sandbox('https://x.a.com/', 'x.a.com')).toBe('PROXY 127.0.0.1:7890');
    // longest suffix wins: whitelist subdomain beats proxy parent
    expect(sandbox('https://b.a.com/', 'b.a.com')).toBe('DIRECT');
    expect(sandbox('https://www.c.net/', 'www.c.net')).toBe('PROXY 127.0.0.1:7890');
    expect(sandbox('https://other.org/', 'other.org')).toBe('DIRECT');
  });

  it('dedupes repeated rule list entries', () => {
    const pac = generatePacScript(makeSwitch(['||dup.com', '||dup.com', '|http://x.example/a', '|http://x.example/a']), profiles);
    const count = (sub: string) => pac.split(sub).length - 1;
    expect(count('dup.com')).toBe(1);
    expect(count('x\\.example')).toBe(1);
  });

  it('whitelist wins over proxy on identical suffix', () => {
    const pac = generatePacScript(makeSwitch(['||same.com', '@@||same.com']), profiles);
    const sandbox = new Function(`${pac}\nreturn FindProxyForURL;`)();
    expect(sandbox('https://same.com/', 'same.com')).toBe('DIRECT');
  });

  it('keyword rules are case-insensitive in generated PAC', () => {
    const pac = generatePacScript(makeSwitch(['KeywordABC']), profiles);
    const sandbox = new Function(`${pac}\nreturn FindProxyForURL;`)();
    expect(sandbox('http://x.com/KEYWORDabc', 'x.com')).toBe('PROXY 127.0.0.1:7890');
    expect(sandbox('http://x.com/nothing', 'x.com')).toBe('DIRECT');
  });

  it('prevents Object.prototype pollution in hostRules suffix map', () => {
    const pac = generatePacScript(makeSwitch(['||constructor.com', '||other.net']), profiles);
    const sandbox = new Function(`${pac}\nreturn FindProxyForURL;`)();
    expect(sandbox('http://constructor/', 'constructor')).toBe('DIRECT');
  });

  it('dedupes without collision when patterns contain colons', () => {
    const pac = generatePacScript(makeSwitch(['|http://a:80', '|http://a:80', '|http://a']), profiles);
    const countA80 = pac.split('http:\\/\\/a:80').length - 1;
    const countA = pac.split('http:\\/\\/a.*').length - 1;
    expect(countA80).toBe(1);
    expect(countA).toBe(1);
  });
});

describe('FixedProfile failover chain', () => {
  it('appends fallbackServers after the primary proxy', () => {
    const fixed: FixedProfile = {
      id: 'p1',
      name: 'P1',
      profileType: 'FixedProfile',
      fallbackProxy: { scheme: 'http', host: '127.0.0.1', port: 7890 },
      fallbackServers: [
        { scheme: 'socks5', host: '10.0.0.2', port: 1080 },
        { scheme: 'https', host: '10.0.0.3', port: 443 },
      ],
      bypassList: [],
    };
    const pac = generatePacScript(fixed, { p1: fixed });
    const sandbox = new Function(`${pac}\nreturn FindProxyForURL;`)();
    expect(sandbox('https://x.com/', 'x.com'))
      .toBe('PROXY 127.0.0.1:7890; SOCKS5 10.0.0.2:1080; SOCKS 10.0.0.2:1080; HTTPS 10.0.0.3:443');
  });

  it('omits empty fallback servers and falls back to DIRECT when no proxy', () => {
    const fixed: FixedProfile = {
      id: 'p1',
      name: 'P1',
      profileType: 'FixedProfile',
      bypassList: [],
      fallbackServers: [{ scheme: 'http', host: '', port: 0 }],
    };
    const pac = generatePacScript(fixed, { p1: fixed });
    const sandbox = new Function(`${pac}\nreturn FindProxyForURL;`)();
    expect(sandbox('https://x.com/', 'x.com')).toBe('DIRECT');
  });
});

describe('PAC injection & edge regressions', () => {
  const fixedProxy: FixedProfile = {
    id: 'proxy1',
    name: 'Local Proxy',
    profileType: 'FixedProfile',
    fallbackProxy: { scheme: 'http', host: '127.0.0.1', port: 7890 },
    bypassList: [],
  };

  function switchWith(condition: SwitchProfile['rules'][number]['condition']): [SwitchProfile, Record<string, Profile>] {
    const sw: SwitchProfile = {
      id: 'autoSwitch',
      name: 'Auto Switch',
      profileType: 'SwitchProfile',
      defaultProfileId: 'direct',
      rules: [{ id: 'r1', enabled: true, condition, profileId: 'proxy1' }],
    };
    return [sw, { proxy1: fixedProxy, direct: { id: 'direct', name: 'Direct', profileType: 'DirectProfile' } as unknown as Profile, autoSwitch: sw }];
  }

  it('newline in HostWildcard pattern does not break the whole PAC', () => {
    const [sw, profiles] = switchWith({ conditionType: 'HostWildcardCondition', pattern: 'evil.com\nalert(1)//' });
    const pac = generatePacScript(sw, profiles);
    expect(() => new Function(`${pac}\nreturn FindProxyForURL;`)).not.toThrow();
    const sandbox = new Function(`${pac}\nreturn FindProxyForURL;`)();
    expect(sandbox('https://evil.com/', 'evil.com')).toBe('DIRECT'); // rule disabled, default applies
  });

  it('newline in UrlWildcard pattern does not break the whole PAC', () => {
    const [sw, profiles] = switchWith({ conditionType: 'UrlWildcardCondition', pattern: 'https://x.com/*\nalert(1)//' });
    const pac = generatePacScript(sw, profiles);
    expect(() => new Function(`${pac}\nreturn FindProxyForURL;`)).not.toThrow();
  });

  it('rejects out-of-range CIDR bits instead of wrapping the shift', () => {
    expect(matchCondition({ conditionType: 'IpCondition', pattern: '192.168.0.0/33' }, 'http://192.168.1.5/', '192.168.1.5')).toBe(false);
    expect(matchCondition({ conditionType: 'IpCondition', pattern: '192.168.0.0/-1' }, 'http://192.168.1.5/', '192.168.1.5')).toBe(false);
    expect(matchCondition({ conditionType: 'IpCondition', pattern: '192.168.0.0/24' }, 'http://192.168.0.5/', '192.168.0.5')).toBe(true);
  });

  it('suffix-map rules match FQDN hosts with trailing dot', () => {
    const [sw, profiles] = switchWith({ conditionType: 'HostWildcardCondition', pattern: '*.github.com' });
    const pac = generatePacScript(sw, profiles);
    const sandbox = new Function(`${pac}\nreturn FindProxyForURL;`)();
    expect(sandbox('https://github.com./', 'github.com.')).toBe('PROXY 127.0.0.1:7890');
  });
});

describe('Speed Recommendation Probes', () => {
  it('generates probe PAC routing target host to directive and others to base script', () => {
    const directProfile: Profile = { id: 'direct', name: 'Direct', profileType: 'DirectProfile' };
    const probePac = generateProbePacScript('PROXY 10.0.0.1:8080', 'slow.com', directProfile);
    const sandbox = new Function(`${probePac}\nreturn FindProxyForURL;`)();
    expect(sandbox('https://slow.com/', 'slow.com')).toBe('PROXY 10.0.0.1:8080');
    expect(sandbox('https://other.com/', 'other.com')).toBe('DIRECT');
  });

  it('matches SwitchProfile rules correctly', () => {
    const sw: SwitchProfile = {
      id: 'sw',
      name: 'Switch',
      profileType: 'SwitchProfile',
      defaultProfileId: 'direct',
      rules: [
        {
          id: 'r1',
          enabled: true,
          condition: { conditionType: 'HostWildcardCondition', pattern: '*.fast.com' },
          profileId: 'proxy1',
        },
      ],
    };
    expect(matchSwitchProfile(sw, 'https://sub.fast.com/', 'sub.fast.com')).toBe('proxy1');
    expect(matchSwitchProfile(sw, 'https://slow.com/', 'slow.com')).toBe('direct');
  });

  it('matchSwitchProfileFull resolves ruleList cache like PAC routing does', () => {
    const sw: SwitchProfile = {
      id: 'sw',
      name: 'Switch',
      profileType: 'SwitchProfile',
      defaultProfileId: 'direct',
      rules: [],
      ruleList: {
        id: 'rl',
        url: 'https://example.com/list.txt',
        format: 'autoproxy',
        matchProfileId: 'proxy1',
        defaultProfileId: 'direct',
        enabled: true,
        rulesCache: ['||gfw-blocked.com', '@@||whitelisted.com'],
      },
    };
    // proxied via rule list — matchSwitchProfile alone would wrongly say 'direct'
    expect(matchSwitchProfile(sw, 'https://gfw-blocked.com/', 'gfw-blocked.com')).toBe('direct');
    expect(matchSwitchProfileFull(sw, 'https://gfw-blocked.com/', 'gfw-blocked.com')).toBe('proxy1');
    expect(matchSwitchProfileFull(sw, 'https://www.gfw-blocked.com/', 'www.gfw-blocked.com')).toBe('proxy1');
    // whitelist entry → default route
    expect(matchSwitchProfileFull(sw, 'https://whitelisted.com/', 'whitelisted.com')).toBe('direct');
    // no hit anywhere → default
    expect(matchSwitchProfileFull(sw, 'https://other.com/', 'other.com')).toBe('direct');
  });

  it('batch probe PAC routes only marked probe URLs, user traffic unchanged', () => {
    const directProfile: Profile = { id: 'direct', name: 'Direct', profileType: 'DirectProfile' };
    const pac = generateBatchProbePacScript(
      [
        { marker: '0', directive: 'DIRECT' },
        { marker: '1', directive: 'PROXY 10.0.0.1:8080' },
        { marker: '2', directive: 'SOCKS5 10.0.0.2:1080' },
      ],
      'slow.com',
      directProfile
    );
    const sandbox = new Function(`${pac}\nreturn FindProxyForURL;`)();
    // marked probe URLs → per-candidate directives
    expect(sandbox('https://slow.com/?__neo_probe=0&_t=1', 'slow.com')).toBe('DIRECT');
    expect(sandbox('https://slow.com/?__neo_probe=1&_t=1', 'slow.com')).toBe('PROXY 10.0.0.1:8080');
    expect(sandbox('http://slow.com/?__neo_probe=2&_t=1', 'slow.com')).toBe('SOCKS5 10.0.0.2:1080');
    // unmarked user traffic to same host → base routing (hijack impossible)
    expect(sandbox('https://slow.com/', 'slow.com')).toBe('DIRECT');
    expect(sandbox('https://slow.com/path', 'slow.com')).toBe('DIRECT');
    expect(sandbox('https://other.com/__neo_probe_1', 'other.com')).toBe('DIRECT');
  });

  it('generates test/probe PAC script with lowercase target host comparison', () => {
    const probePac = generateProbePacScript('PROXY 10.0.0.1:8080', 'SlowHost.COM');
    expect(probePac).toContain('host === "slowhost.com"');
    const sandbox = new Function(`${probePac}\nreturn FindProxyForURL;`)();
    expect(sandbox('https://slowhost.com/', 'slowhost.com')).toBe('PROXY 10.0.0.1:8080');
  });

  it('handles empty or whitespace pattern in conditionToPacCode and matchCondition', () => {
    const emptyRegex = { conditionType: 'HostRegexCondition' as const, pattern: '' };
    const blankRegex = { conditionType: 'UrlRegexCondition' as const, pattern: '   ' };
    const emptyKw = { conditionType: 'KeywordCondition' as const, pattern: '' };
    expect(conditionToPacCode(emptyRegex)).toBe('false');
    expect(conditionToPacCode(blankRegex)).toBe('false');
    expect(conditionToPacCode(emptyKw)).toBe('false');
    expect(matchCondition(emptyRegex, 'http://test.com', 'test.com')).toBe(false);
    expect(matchCondition(blankRegex, 'http://test.com', 'test.com')).toBe(false);
    expect(matchCondition(emptyKw, 'http://test.com', 'test.com')).toBe(false);
  });

  it('escapes regex slashes parity-aware', () => {
    const c1 = { conditionType: 'HostRegexCondition' as const, pattern: 'a/b' };
    expect(conditionToPacCode(c1)).toBe('/a\\/b/i.test(host)');

    const c2 = { conditionType: 'HostRegexCondition' as const, pattern: 'a\\/b' };
    expect(conditionToPacCode(c2)).toBe('/a\\/b/i.test(host)');

    const c3 = { conditionType: 'HostRegexCondition' as const, pattern: 'a\\\\/b' };
    expect(conditionToPacCode(c3)).toBe('/a\\\\\\/b/i.test(host)');
  });

  it('guards IPv6 literals in <local> bypass condition', () => {
    const cond = { conditionType: 'BypassCondition' as const, pattern: '<local>' };
    expect(matchCondition(cond, 'http://[2001:db8::1]/', '2001:db8::1')).toBe(false);
    expect(matchCondition(cond, 'http://[::1]/', '::1')).toBe(true);
    expect(matchCondition(cond, 'http://localhost/', 'localhost')).toBe(true);
    expect(matchCondition(cond, 'http://intranet/', 'intranet')).toBe(true);

    const pac = conditionToPacCode(cond);
    expect(pac).toContain("host.indexOf(':') === -1");
    const checkPac = new Function('host', 'isPlainHostName', `return (${pac});`);
    const isPlain = (h: string) => h.indexOf('.') === -1;
    expect(checkPac('2001:db8::1', isPlain)).toBe(false);
    expect(checkPac('::1', isPlain)).toBe(true);
    expect(checkPac('intranet', isPlain)).toBe(true);
  });
});
