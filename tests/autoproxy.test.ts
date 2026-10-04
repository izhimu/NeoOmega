import { describe, expect, it, vi } from 'vitest';
import { decodeRuleListText, parseAutoProxyRules, fetchAndParseRuleList } from '../src/core/parsers/autoproxy';
import { matchCondition } from '../src/core/pac/matcher';

describe('AutoProxy Parser', () => {
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
});
