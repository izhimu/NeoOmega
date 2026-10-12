import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeRuleListText, fetchAndParseRuleList, parseAutoProxyLine, parseAutoProxyRules, parseRuleListCache } from '../src/core/parsers/autoproxy';
import { matchCondition, matchSwitchProfileFull } from '../src/core/pac/matcher';
import type { SwitchProfile } from '../src/core/types';
describe('AutoProxy Parser', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });
  it('decodes base64 autoproxy format', () => {
    const plain = '[AutoProxy 0.2.9]\n! Comment\n||google.com\n@@||apple.com';
    const base64 = Buffer.from(plain).toString('base64');
    expect(decodeRuleListText(base64)).toBe(plain);
    expect(decodeRuleListText(plain)).toBe(plain);
  });

  it('parses domain, whitelist, and regex rules', () => {
    const raw = `
! Title: GFWList
[AutoProxy 0.2.9]
||google.com
@@||apple.com
|^https?://.*wikipedia\\.org/
|http://unencrypted.com/path
twitter.com
`;

    const rules = parseAutoProxyRules(raw, 'proxy', 'direct');
    expect(rules).toHaveLength(5);

    // Rule 0 (prioritized whitelist): @@||apple.com -> direct
    expect(rules[0]?.profileId).toBe('direct');
    expect(rules[0]?.condition.conditionType).toBe('HostWildcardCondition');
    expect(matchCondition(rules[0]!.condition, 'https://apple.com/', 'apple.com')).toBe(true);

    // Rule 1: ||google.com -> proxy
    expect(rules[1]?.profileId).toBe('proxy');
    expect(rules[1]?.condition.conditionType).toBe('HostWildcardCondition');
    expect(matchCondition(rules[1]!.condition, 'https://www.google.com/search', 'www.google.com')).toBe(true);
    expect(matchCondition(rules[1]!.condition, 'https://google.com/', 'google.com')).toBe(true);
    // Rule 2: |^https?://... -> UrlRegexCondition
    expect(rules[2]?.profileId).toBe('proxy');
    expect(rules[2]?.condition.conditionType).toBe('UrlRegexCondition');
    expect(matchCondition(rules[2]!.condition, 'https://en.wikipedia.org/wiki/Main_Page', 'en.wikipedia.org')).toBe(true);
    expect(matchCondition(rules[2]!.condition, 'http://wikipedia.org/', 'wikipedia.org')).toBe(true);
    expect(matchCondition(rules[2]!.condition, 'https://example.com/', 'example.com')).toBe(false);
    // Rule 4: |http://unencrypted.com/path
    expect(rules[3]?.condition.conditionType).toBe('UrlWildcardCondition');
    expect(matchCondition(rules[3]!.condition, 'http://unencrypted.com/path/123', 'unencrypted.com')).toBe(true);
    expect(matchCondition(rules[3]!.condition, 'https://unencrypted.com/path', 'unencrypted.com')).toBe(false);

    // Rule 5: twitter.com -> HostWildcardCondition
    expect(rules[4]?.condition.conditionType).toBe('HostWildcardCondition');
    expect(matchCondition(rules[4]!.condition, 'https://twitter.com/', 'twitter.com')).toBe(true);
    expect(matchCondition(rules[4]!.condition, 'https://mobile.twitter.com/', 'mobile.twitter.com')).toBe(true);
  });

  it('fetches and decodes base64 rule list', async () => {
    const plain = '[AutoProxy 0.2.9]\n||google.com\n';
    const base64 = Buffer.from(plain).toString('base64');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => base64,
    }) as any;

    const result = await fetchAndParseRuleList('https://example.com/gfwlist.txt', 'proxy', 'direct');
    expect(result.text).toBe(plain);
    expect(result.rules.length).toBe(1);
    expect(result.rules[0]?.profileId).toBe('proxy');
  });

  it('parses ||domain/path as UrlRegexCondition covering apex and subdomains', () => {
    const rule = parseAutoProxyLine('||example.com/path', 0, 'proxy', 'direct');
    expect(rule).not.toBeNull();
    expect(rule?.condition.conditionType).toBe('UrlRegexCondition');
    expect(matchCondition(rule!.condition, 'https://sub.example.com/path', 'sub.example.com')).toBe(true);
    expect(matchCondition(rule!.condition, 'https://example.com/path', 'example.com')).toBe(true);
    expect(matchCondition(rule!.condition, 'https://example.com/other', 'example.com')).toBe(false);
  });

  it('does not classify lines starting with | containing ? as UrlRegexCondition', () => {
    const rule = parseAutoProxyLine('|http://example.com/search?q=1', 0, 'proxy', 'direct');
    expect(rule).not.toBeNull();
    expect(rule?.condition.conditionType).toBe('UrlWildcardCondition');
    expect(rule?.condition.pattern).toBe('http://example.com/search?q=1*');
  });

  it('does not decode plaintext lists whose chars happen to be valid base64', () => {
    const plaintext = 'facebook\nbilibili';
    expect(decodeRuleListText(plaintext)).toBe(plaintext);
  });

  it('prioritizes whitelist exceptions in parseRuleListCache and matchSwitchProfileFull', () => {
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
        matchProfileId: 'proxy',
        defaultProfileId: 'direct',
        enabled: true,
        rulesCache: ['||gfw.org', '@@||whitelist.gfw.org'],
      },
    };
    expect(matchSwitchProfileFull(sw, 'https://whitelist.gfw.org/', 'whitelist.gfw.org')).toBe('direct');
    expect(matchSwitchProfileFull(sw, 'https://other.gfw.org/', 'other.gfw.org')).toBe('proxy');
  });

  it('recomputes cached rules when same array identity is parsed for different profiles', () => {
    const lines = ['||domain.com', '@@||whitelist.com'];
    const p1Rules = parseRuleListCache(lines, 'proxy1', 'direct1');
    expect(p1Rules.find((r) => r.condition.pattern === '*.domain.com')?.profileId).toBe('proxy1');
    expect(p1Rules.find((r) => r.condition.pattern === '*.whitelist.com')?.profileId).toBe('direct1');

    const p2Rules = parseRuleListCache(lines, 'proxy2', 'direct2');
    expect(p2Rules.find((r) => r.condition.pattern === '*.domain.com')?.profileId).toBe('proxy2');
    expect(p2Rules.find((r) => r.condition.pattern === '*.whitelist.com')?.profileId).toBe('direct2');
  });

  it('converts IDN domain in || rules to punycode HostWildcard pattern', () => {
    const rule = parseAutoProxyLine('||中文.com', 0, 'proxy', 'direct');
    expect(rule).not.toBeNull();
    expect(rule?.condition.conditionType).toBe('HostWildcardCondition');
    expect(rule?.condition.pattern).toBe('*.xn--fiq228c.com');
  });
});
