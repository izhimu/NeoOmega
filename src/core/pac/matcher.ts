/**
 * NeoOmega Rule Condition Matcher & Code Generator
 */

import type { RuleCondition } from '../types';
import type { SwitchProfile } from '../types';
import { parseRuleListCache } from '../parsers/autoproxy';

// Compiled-regex cache: matchCondition ran `new RegExp` on every evaluation.
// ponytail: unbounded-keyed LRU-ish cap at 2000; on overflow the map clears
// wholesale — a full LRU (delete+set churn) buys little at this size.
const regexCache = new Map<string, RegExp | null>();
function getCachedRegExp(pattern: string): RegExp | null {
  let re = regexCache.get(pattern);
  if (re === undefined) {
    try {
      re = new RegExp(pattern, 'i');
    } catch {
      re = null;
    }
    if (regexCache.size >= 2000) regexCache.clear();
    regexCache.set(pattern, re);
  }
  return re;
}

/**
 * Convert a wildcard pattern (*, ?) to a regular expression string
 */
export function wildcardToRegExpString(pattern: string): string {
  return pattern
    .replace(/[.+^${}()|[\]\\/]/g, '\\$&') // escape regex chars except * and ? (incl. / for PAC literals)
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
}

/**
 * Convert HostWildcard pattern to RegExp string
 * Follows SwitchyOmega semantics:
 * - '*.google.com' or '.google.com' matches 'google.com' AND 'abc.google.com'
 * - '**.google.com' requires a subdomain
 */
export function hostWildcardToRegExpString(pattern: string): string {
  let p = pattern.trim();
  if (p.startsWith('.')) {
    p = '*' + p;
  }
  if (p.startsWith('**.')) {
    const domain = p.slice(3);
    return `.*\\.${wildcardToRegExpString(domain)}$`;
  }
  if (p.startsWith('*.')) {
    const domain = p.slice(2);
    // (?:^|\.)domain$
    return `(?:^|\\.)${wildcardToRegExpString(domain)}$`;
  }
  // No wildcard at start
  if (!p.includes('*') && !p.includes('?')) {
    // Exact domain match
    return `^${wildcardToRegExpString(p)}$`;
  }
  return `^${wildcardToRegExpString(p)}$`;
}

/**
 * Check if an IPv4 address is in a CIDR subnet
 */
export function isInSubnetV4(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  if (!range) return false;
  const bits = bitsStr ? parseInt(bitsStr, 10) : 32;
  const ipNum = ipv4ToNumber(ip);
  const rangeNum = ipv4ToNumber(range);
  if (ipNum === null || rangeNum === null) return false;

  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  const [p0, p1, p2, p3] = parts;
  if (parts.length !== 4 || p0 === undefined || p1 === undefined || p2 === undefined || p3 === undefined || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return null;
  }
  return (((p0 << 24) | (p1 << 16) | (p2 << 8) | p3) >>> 0);
}

/**
 * Match condition in memory (used for rule evaluation and inspection)
 */
export function matchCondition(condition: RuleCondition, url: string, host: string): boolean {
  const { conditionType, pattern } = condition;
  if ((!pattern || !pattern.trim()) && conditionType !== 'TrueCondition' && conditionType !== 'FalseCondition') {
    return false;
  }

  switch (conditionType) {
    case 'TrueCondition':
      return true;
    case 'FalseCondition':
      return false;

    case 'HostWildcardCondition': {
      return (getCachedRegExp(hostWildcardToRegExpString(pattern))?.test(host)) ?? false;
    }

    case 'HostRegexCondition': {
      return (getCachedRegExp(pattern)?.test(host)) ?? false;
    }

    case 'UrlWildcardCondition': {
      return (getCachedRegExp(`^${wildcardToRegExpString(pattern)}$`)?.test(url)) ?? false;
    }

    case 'UrlRegexCondition': {
      return (getCachedRegExp(pattern)?.test(url)) ?? false;
    }

    case 'KeywordCondition': {
      return url.toLowerCase().includes(pattern.toLowerCase());
    }

    case 'IpCondition': {
      // ponytail: no DNS here — hostnames never match, while PAC isInNet resolves them; preview may under-report
      return isInSubnetV4(host, pattern);
    }

    case 'BypassCondition': {
      // Handles Chrome bypass list conventions
      const h = host.toLowerCase();
      const p = pattern.toLowerCase();
      // 1. <local>
      if (p === '<local>') {
        return (!h.includes('.') && !h.includes(':')) || h === 'localhost' || h === '127.0.0.1' || h === '::1';
      }
      // 2. CIDR
      if (p.includes('/')) {
        return isInSubnetV4(h, pattern);
      }
      // 3. Domain or Wildcard (e.g. .example.com or *.example.com)
      if (p.startsWith('.')) {
        return h.endsWith(p) || h === p.slice(1);
      }
      if (p.startsWith('*.')) {
        return h.endsWith(p.slice(1)) || h === p.slice(2);
      }
      // Chrome bypass convention: bare domain also matches subdomains
      return h === p || h.endsWith('.' + p);
    }

    default:
      return false;
  }
}

/**
 * Match a SwitchProfile against a URL and host and return the matched profileId
 */
export function matchSwitchProfile(
  profile: SwitchProfile,
  url: string,
  host: string
): string {
  for (const rule of profile.rules) {
    if (rule.enabled && matchCondition(rule.condition, url, host)) {
      return rule.profileId;
    }
  }
  return profile.defaultProfileId;
}

/**
 * Full route resolution: manual rules first, then ruleList cache (GFWList etc).
 * matchSwitchProfile alone ignores ruleList — PAC routing does not.
 */
export function matchSwitchProfileFull(
  profile: SwitchProfile,
  url: string,
  host: string
): string {
  // Manual rules first — a manual hit wins even when it targets the default
  // profile (PAC compiler semantics: rules evaluate before the rule list).
  for (const rule of profile.rules) {
    if (!rule.enabled) continue;
    if (matchCondition(rule.condition, url, host)) {
      return rule.profileId;
    }
  }
  const rl = profile.ruleList;
  if (rl?.enabled && Array.isArray(rl.rulesCache)) {
    const defaultId = rl.defaultProfileId || profile.defaultProfileId;
    const parsed = parseRuleListCache(rl.rulesCache, rl.matchProfileId, defaultId);
    for (const rule of parsed) {
      if (matchCondition(rule.condition, url, host)) {
        return rule.profileId;
      }
    }
  }
  return profile.defaultProfileId;
}

/**
 * Convert condition to JavaScript expression string for embedding into PAC script
 */
export function conditionToPacCode(condition: RuleCondition): string {
  const { conditionType, pattern } = condition;
  if ((!pattern || !pattern.trim()) && conditionType !== 'TrueCondition' && conditionType !== 'FalseCondition') {
    return 'false';
  }
  switch (conditionType) {
    case 'TrueCondition':
      return 'true';
    case 'FalseCondition':
      return 'false';

    case 'HostWildcardCondition': {
      const reg = hostWildcardToRegExpString(pattern);
      if (/[\r\n\u2028\u2029]/.test(reg)) return 'false'; // literal would break single-line PAC
      return `/${reg}/i.test(host)`;
    }

    case 'HostRegexCondition': {
      try {
        const escaped = pattern.replace(/(\\*)\//g, (m, bs) => (bs.length % 2 ? m : bs + '\\/'));
        if (/[\r\n\u2028\u2029]/.test(escaped)) return 'false'; // literal would break single-line PAC
        new RegExp(escaped, 'i');
        return `/${escaped}/i.test(host)`;
      } catch {
        return 'false';
      }
    }
    case 'UrlWildcardCondition': {
      const reg = `^${wildcardToRegExpString(pattern)}$`;
      if (/[\r\n\u2028\u2029]/.test(reg)) return 'false'; // literal would break single-line PAC
      return `/${reg}/i.test(url)`;
    }

    case 'UrlRegexCondition': {
      try {
        const escaped = pattern.replace(/(\\*)\//g, (m, bs) => (bs.length % 2 ? m : bs + '\\/'));
        if (/[\r\n\u2028\u2029]/.test(escaped)) return 'false';
        new RegExp(escaped, 'i');
        return `/${escaped}/i.test(url)`;
      } catch {
        return 'false';
      }
    }
    case 'KeywordCondition':
      // Case-insensitive to match matchCondition() semantics
      return `url.toLowerCase().indexOf(${JSON.stringify(pattern.toLowerCase())}) !== -1`;

    case 'IpCondition': {
      const [ip, bitsStr] = pattern.split('/');
      const bits = bitsStr ? parseInt(bitsStr, 10) : 32;
      const mask = cidrBitsToMask(bits);
      return `(/^\\d{1,3}(\\.\\d{1,3}){3}$/.test(host) && isInNet(host, ${JSON.stringify(ip)}, ${JSON.stringify(mask)}))`;
    }

    case 'BypassCondition': {
      const p = pattern.toLowerCase();
      if (p === '<local>') {
        return `((host.indexOf(':') === -1 && isPlainHostName(host)) || host === "127.0.0.1" || host === "::1" || host.toLowerCase() === "localhost")`;
      }
      if (p.includes('/')) {
        const [ip, bitsStr] = pattern.split('/');
        const bits = bitsStr ? parseInt(bitsStr, 10) : 32;
        const mask = cidrBitsToMask(bits);
        return `(/^\\d{1,3}(\\.\\d{1,3}){3}$/.test(host) && isInNet(host, ${JSON.stringify(ip)}, ${JSON.stringify(mask)}))`;
      }
      if (p.startsWith('.')) {
        const domain = p.slice(1);
        return `(dnsDomainIs(host, ${JSON.stringify('.' + domain)}) || host.toLowerCase() === ${JSON.stringify(domain)})`;
      }
      if (p.startsWith('*.')) {
        const domain = p.slice(2);
        return `(dnsDomainIs(host, ${JSON.stringify('.' + domain)}) || host.toLowerCase() === ${JSON.stringify(domain)})`;
      }
      return `(host.toLowerCase() === ${JSON.stringify(p)} || dnsDomainIs(host, ${JSON.stringify('.' + p)}))`;
    }

    default:
      return 'false';
  }
}

function cidrBitsToMask(bits: number): string {
  const clamped = Number.isInteger(bits) ? Math.min(32, Math.max(0, bits)) : 32;
  const mask = clamped === 0 ? 0 : (~0 << (32 - clamped)) >>> 0;
  return [
    (mask >>> 24) & 255,
    (mask >>> 16) & 255,
    (mask >>> 8) & 255,
    mask & 255,
  ].join('.');
}
