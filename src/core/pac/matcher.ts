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
      // ponytail: no DNS here — hostnames never match, while PAC isInNet resolves them; preview may under-report
      return isInSubnetV4(host, pattern);
    }

    case 'BypassCondition': {
      // Handles Chrome bypass list conventions
      const h = host.toLowerCase();
      const p = pattern.toLowerCase();
      // 1. <local>
      if (p === '<local>') {
        return !h.includes('.') || h === 'localhost' || h === '127.0.0.1' || h === '::1';
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
      if (/[\r\n]/.test(reg)) return 'false'; // literal would break single-line PAC
      return `/${reg}/i.test(host)`;
    }

    case 'HostRegexCondition': {
      try {
        const escaped = pattern.replace(/(?<!\\)\//g, '\\/');
        if (/[\r\n]/.test(escaped)) return 'false'; // literal would break single-line PAC
        new RegExp(escaped, 'i');
        return `/${escaped}/i.test(host)`;
      } catch {
        return 'false';
      }
    }
    case 'UrlWildcardCondition': {
      const reg = `^${wildcardToRegExpString(pattern)}$`;
      if (/[\r\n]/.test(reg)) return 'false'; // literal would break single-line PAC
      return `/${reg}/i.test(url)`;
    }

    case 'UrlRegexCondition': {
      try {
        const escaped = pattern.replace(/(?<!\\)\//g, '\\/');
        if (/[\r\n]/.test(escaped)) return 'false';
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
      return `isInNet(host, ${JSON.stringify(ip)}, ${JSON.stringify(mask)})`;
    }

    case 'BypassCondition': {
      const p = pattern.toLowerCase();
      if (p === '<local>') {
        return `(isPlainHostName(host) || host === "127.0.0.1" || host === "::1" || host.toLowerCase() === "localhost")`;
      }
      if (p.includes('/')) {
        const [ip, bitsStr] = pattern.split('/');
        const bits = bitsStr ? parseInt(bitsStr, 10) : 32;
        const mask = cidrBitsToMask(bits);
        return `isInNet(host, ${JSON.stringify(ip)}, ${JSON.stringify(mask)})`;
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
