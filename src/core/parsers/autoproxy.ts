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
      return new TextDecoder().decode(Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0)));
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
    const domain = raw.slice(2).replace(/^\*+\.?/, '').replace(/\^.*$/, '');
    conditionType = 'HostWildcardCondition';
    pattern = `*.${domain}`;
  } else if (raw.startsWith('/') && raw.endsWith('/') && raw.length > 2) {
    // Regex rule: /pattern/
    conditionType = 'UrlRegexCondition';
    pattern = raw.slice(1, -1);
  } else if (raw.startsWith('|')) {
    let rem = raw.slice(1);
    const hasTrailing = rem.endsWith('|');
    if (hasTrailing) rem = rem.slice(0, -1);
    // Heuristic: treat rules with regex metachars (excluding * wildcards) as anchored regex
    if (/[\^$\\()[\]?+]/.test(rem.replace(/\*/g, ''))) {
      conditionType = 'UrlRegexCondition';
      pattern = (rem.startsWith('^') ? rem : `^${rem}`) + (hasTrailing && !rem.endsWith('$') ? '$' : '');
    } else {
      conditionType = 'UrlWildcardCondition';
      pattern = hasTrailing ? rem : `${rem}*`;
    }
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
  if (conditionType === 'UrlRegexCondition') {
    // ponytail: ReDoS heuristic rejects >300 chars or nested quantifiers; upgrade to safe-regex engine if legit rules trip
    if (pattern.length > 300 || /\(([^)]*[+*][^)]*)\)[+*{]/.test(pattern)) {
      return null;
    }
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
  const MAX_BYTES = 8 * 1024 * 1024; // 8 MiB
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`网络请求失败 (${errorMsg})。若无法直连此规则地址，请开启代理或更换镜像 URL。`);
    }
    if (!res.ok) {
      throw new Error(`下载规则列表失败: HTTP ${res.status} ${res.statusText}`);
    }
    let rawText: string;
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          receivedBytes += value.byteLength;
          if (receivedBytes > MAX_BYTES) {
            controller.abort();
            throw new Error('规则列表体积过大，超出 8 MiB 限制');
          }
          chunks.push(value);
        }
      }
      const combined = new Uint8Array(receivedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      rawText = new TextDecoder().decode(combined);
    } else {
      rawText = await res.text();
      if (rawText.length > MAX_BYTES) {
        controller.abort();
        throw new Error('规则列表体积过大，超出 8 MiB 限制');
      }
    }
    const text = decodeRuleListText(rawText);
    const rules = parseAutoProxyRules(text, matchProfileId, defaultProfileId);
    return { text, rules };
  } finally {
    clearTimeout(timer);
  }
}
