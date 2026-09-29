/**
 * NeoOmega AutoProxy / GFWList Format Parser
 * High-performance, lightweight rule list compiler
 */

import type { ConditionType, RuleCondition, SwitchRule } from '../types';

/**
 * Decode Base64 or plain text AutoProxy rule list
 */
export function decodeRuleListText(content: string): string {
  const trimmed = content.trim();
  // If already plaintext autoproxy or comment, do not base64 decode
  if (
    trimmed.startsWith('[AutoProxy') ||
    trimmed.startsWith('!') ||
    trimmed.includes('\n[') ||
    trimmed.includes('\n!')
  ) {
    return content;
  }

  try {
    const cleaned = trimmed.replace(/\s+/g, '');
    if (typeof atob === 'function') {
      return atob(cleaned);
    }
    // Node.js fallback for tests
    return Buffer.from(cleaned, 'base64').toString('utf-8');
  } catch {
    return content;
  }
}

/**
 * Parse a single AutoProxy rule line into a SwitchRule
 */
export function parseAutoProxyLine(
  line: string,
  index: number,
  matchProfileId: string,
  defaultProfileId: string = 'direct'
): SwitchRule | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('[')) {
    return null;
  }

  let raw = trimmed;
  let targetProfileId = matchProfileId;

  // Whitelist / Exception rule (e.g. @@||example.com)
  if (raw.startsWith('@@')) {
    targetProfileId = defaultProfileId;
    raw = raw.slice(2).trim();
  }

  let conditionType: ConditionType = 'KeywordCondition';
  let pattern = raw;

  if (raw.startsWith('||')) {
    // Domain match: ||example.com matches example.com and *.example.com
    const domain = raw.slice(2).replace(/^\*+\.?/, '');
    conditionType = 'HostWildcardCondition';
    pattern = `*.${domain}`;
  } else if (raw.startsWith('/') && raw.endsWith('/') && raw.length > 2) {
    // Regex rule: /pattern/
    conditionType = 'UrlRegexCondition';
    pattern = raw.slice(1, -1);
  } else if (raw.startsWith('|')) {
    // URL prefix match: |http://...
    conditionType = 'UrlWildcardCondition';
    pattern = `${raw.slice(1)}*`;
  } else if (raw.endsWith('|')) {
    // URL suffix match: .mp4|
    conditionType = 'UrlWildcardCondition';
    pattern = `*${raw.slice(0, -1)}`;
  } else if (raw.includes('*') || raw.includes('?')) {
    if (raw.includes('/') || raw.includes(':')) {
      conditionType = 'UrlWildcardCondition';
      pattern = raw;
    } else {
      conditionType = 'HostWildcardCondition';
      pattern = raw;
    }
  } else if (raw.includes('.')) {
    // Looks like a domain: google.com
    if (raw.includes('/') || raw.includes(':')) {
      conditionType = 'UrlWildcardCondition';
      pattern = `*${raw}*`;
    } else {
      conditionType = 'HostWildcardCondition';
      pattern = `*.${raw}`;
    }
  } else {
    // Generic keyword
    conditionType = 'KeywordCondition';
    pattern = raw;
  }

  const condition: RuleCondition = {
    conditionType,
    pattern,
  };

  return {
    id: `rl_rule_${index}`,
    enabled: true,
    condition,
    profileId: targetProfileId,
    note: `AutoProxy rule: ${trimmed}`,
  };
}

/**
 * Parse an entire AutoProxy / GFWList content string
 */
export function parseAutoProxyRules(
  content: string,
  matchProfileId: string,
  defaultProfileId: string = 'direct'
): SwitchRule[] {
  const decoded = decodeRuleListText(content);
  const lines = decoded.split(/\r?\n/);
  const whitelistRules: SwitchRule[] = [];
  const proxyRules: SwitchRule[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const rule = parseAutoProxyLine(line, i, matchProfileId, defaultProfileId);
    if (rule) {
      if (rule.profileId === defaultProfileId) {
        whitelistRules.push(rule);
      } else {
        proxyRules.push(rule);
      }
    }
  }

  return [...whitelistRules, ...proxyRules];
}

/**
 * Fetch and parse a remote rule list from a URL
 */
export async function fetchAndParseRuleList(
  url: string,
  matchProfileId: string,
  defaultProfileId: string = 'direct'
): Promise<{ text: string; rules: SwitchRule[] }> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`网络请求失败 (${errorMsg})。若无法直连此规则地址，请开启代理或更换镜像 URL。`);
  }
  if (!res.ok) {
    throw new Error(`下载规则列表失败: HTTP ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  const rules = parseAutoProxyRules(text, matchProfileId, defaultProfileId);
  return { text, rules };
}
