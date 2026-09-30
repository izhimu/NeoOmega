/**
 * NeoOmega Rule Condition Matcher & Code Generator
 */

import type { RuleCondition } from '../types';

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
  if (!pattern && conditionType !== 'TrueCondition' && conditionType !== 'FalseCondition') {
    return false;
  }

  switch (conditionType) {
    case 'TrueCondition':
      return true;
    case 'FalseCondition':
      return false;

    case 'HostWildcardCondition': {
      const regexStr = hostWildcardToRegExpString(pattern);
      return new RegExp(regexStr, 'i').test(host);
    }

    case 'HostRegexCondition': {
      try {
        return new RegExp(pattern, 'i').test(host);
      } catch {
        return false;
      }
    }

    case 'UrlWildcardCondition': {
      const regexStr = `^${wildcardToRegExpString(pattern)}$`;
      return new RegExp(regexStr, 'i').test(url);
    }

    case 'UrlRegexCondition': {
      try {
        return new RegExp(pattern, 'i').test(url);
      } catch {
        return false;
      }
    }

    case 'KeywordCondition': {
      return url.toLowerCase().includes(pattern.toLowerCase());
    }

    case 'IpCondition': {
      return isInSubnetV4(host, pattern);
    }

    case 'BypassCondition': {
      // Handles Chrome bypass list conventions
      // 1. <local>
      if (pattern === '<local>') {
        return !host.includes('.') || host === 'localhost' || host === '127.0.0.1' || host === '::1';
      }
      // 2. CIDR
      if (pattern.includes('/')) {
        return isInSubnetV4(host, pattern);
      }
      // 3. Domain or Wildcard (e.g. .example.com or *.example.com)
      if (pattern.startsWith('.')) {
        return host.endsWith(pattern) || host === pattern.slice(1);
      }
      if (pattern.startsWith('*.')) {
        return host.endsWith(pattern.slice(1)) || host === pattern.slice(2);
      }
      return host.toLowerCase() === pattern.toLowerCase();
    }

    default:
      return false;
  }
}

/**
 * Convert condition to JavaScript expression string for embedding into PAC script
 */
export function conditionToPacCode(condition: RuleCondition): string {
  const { conditionType, pattern } = condition;

  switch (conditionType) {
    case 'TrueCondition':
      return 'true';
    case 'FalseCondition':
      return 'false';

    case 'HostWildcardCondition': {
      const reg = hostWildcardToRegExpString(pattern);
      return `/${reg}/i.test(host)`;
    }

    case 'HostRegexCondition':
      return `/${pattern.replace(/(?<!\\)\//g, '\\/')}/i.test(host)`;

    case 'UrlWildcardCondition': {
      const reg = `^${wildcardToRegExpString(pattern)}$`;
      return `/${reg}/i.test(url)`;
    }

    case 'UrlRegexCondition':
      return `/${pattern.replace(/(?<!\\)\//g, '\\/')}/i.test(url)`;

    case 'KeywordCondition':
      // Case-insensitive to match matchCondition() semantics
      return `url.toLowerCase().indexOf(${JSON.stringify(pattern.toLowerCase())}) !== -1`;

    case 'IpCondition': {
      const [ip, bitsStr] = pattern.split('/');
      const bits = bitsStr ? parseInt(bitsStr, 10) : 32;
      const mask = cidrBitsToMask(bits);
      return `isInNet(host, ${JSON.stringify(ip)}, ${JSON.stringify(mask)})`;
    }

    case 'BypassCondition': {
      if (pattern === '<local>') {
        return `(isPlainHostName(host) || host === "127.0.0.1" || host === "::1" || host === "localhost")`;
      }
      if (pattern.includes('/')) {
        const [ip, bitsStr] = pattern.split('/');
        const bits = bitsStr ? parseInt(bitsStr, 10) : 32;
        const mask = cidrBitsToMask(bits);
        return `isInNet(host, ${JSON.stringify(ip)}, ${JSON.stringify(mask)})`;
      }
      if (pattern.startsWith('.')) {
        const domain = pattern.slice(1);
        return `(dnsDomainIs(host, ${JSON.stringify('.' + domain)}) || host === ${JSON.stringify(domain)})`;
      }
      if (pattern.startsWith('*.')) {
        const domain = pattern.slice(2);
        return `(dnsDomainIs(host, ${JSON.stringify('.' + domain)}) || host === ${JSON.stringify(domain)})`;
      }
      return `host === ${JSON.stringify(pattern)}`;
    }

    default:
      return 'false';
  }
}

function cidrBitsToMask(bits: number): string {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return [
    (mask >>> 24) & 255,
    (mask >>> 16) & 255,
    (mask >>> 8) & 255,
    mask & 255,
  ].join('.');
}
