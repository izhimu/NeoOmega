/**
 * NeoOmega PAC Script Generator
 * Compiles Profiles and Rules into high-performance Chromium PAC scripts
 */

import type { FixedProfile, Profile, ProxyServer, SwitchProfile } from '../types';
import { parseRuleListCache } from '../parsers/autoproxy';
import { conditionToPacCode } from './matcher';
/**
 * Format ProxyServer into standard PAC return directive
 */
export function formatProxyDirective(server?: ProxyServer): string {
  if (!server) return 'DIRECT';
  const { scheme, host, port } = server;
  const formattedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  switch (scheme) {
    case 'https':
      return `HTTPS ${formattedHost}:${port}`;
    case 'http':
      return `PROXY ${formattedHost}:${port}`;
    case 'socks5':
      return `SOCKS5 ${formattedHost}:${port}; SOCKS ${formattedHost}:${port}`;
    case 'socks4':
      return `SOCKS ${formattedHost}:${port}`;
    case 'direct':
    default:
      return 'DIRECT';
  }
}

function formatServerChain(primary?: ProxyServer, fallbacks: ProxyServer[] = []): string {
  const chain = [primary, ...fallbacks]
    .filter((s): s is ProxyServer => !!s?.host)
    .map(formatProxyDirective);
  return chain.length ? chain.join('; ') : 'DIRECT';
}

/**
 * Format FixedProfile proxy chain: primary + failover servers joined with ';'
 * Chromium tries each in order on connection failure.
 */
export function formatFixedChain(profile: FixedProfile): string {
  const primary = profile.fallbackProxy || profile.proxyForHttps || profile.proxyForHttp;
  return formatServerChain(primary, profile.fallbackServers);
}
/**
 * Resolve target profile for virtual profiles and aliases
 */
export function resolveProfile(
  profileId: string,
  profiles: Record<string, Profile>,
  visited: Set<string> = new Set()
): Profile | undefined {
  if (visited.has(profileId)) return undefined; // circular reference guard
  visited.add(profileId);

  const profile = profiles[profileId];
  if (!profile) return undefined;
  if (profile.profileType === 'VirtualProfile') {
    return resolveProfile(profile.targetProfileId, profiles, visited);
  }
  return profile;
}

/**
 * Generate directive for a resolved profile
 */
function getProfileDirective(
  profileId: string,
  profiles: Record<string, Profile>,
  urlExpr = 'url'
): string {
  const resolved = resolveProfile(profileId, profiles);
  if (!resolved) return 'DIRECT';

  switch (resolved.profileType) {
    case 'DirectProfile':
    case 'SystemProfile':
      return 'DIRECT';

    case 'FixedProfile': {
      const fixed = resolved as FixedProfile;
      return formatFixedChain(fixed);
    }

    default:
      return 'DIRECT';
  }
}

/**
 * Generate full PAC script for a FixedProfile
 */
export function generateFixedPacScript(profile: FixedProfile): string {
  const lines: string[] = [
    'function FindProxyForURL(url, host) {',
    '  "use strict";',
    '  if (host.charCodeAt(host.length - 1) === 46) host = host.substring(0, host.length - 1);', // FQDN trailing root dot
  ];

  // 1. Bypass rules
  if (Array.isArray(profile.bypassList) && profile.bypassList.length > 0) {
    const bypassChecks = profile.bypassList.map(conditionToPacCode).join(' || ');
    lines.push(`  if (${bypassChecks}) return "DIRECT";`);
  }

  // 2. Protocol specific proxies
  const hasHttp = !!profile.proxyForHttp;
  const hasHttps = !!profile.proxyForHttps;
  const hasFtp = !!profile.proxyForFtp;
  const fallbacks = profile.fallbackServers ?? [];

  if (hasHttps) {
    lines.push(`  if (url.substring(0, 6) === "https:") return ${JSON.stringify(formatServerChain(profile.proxyForHttps, fallbacks))};`);
  }
  if (hasHttp) {
    lines.push(`  if (url.substring(0, 5) === "http:") return ${JSON.stringify(formatServerChain(profile.proxyForHttp, fallbacks))};`);
  }
  if (hasFtp) {
    lines.push(`  if (url.substring(0, 4) === "ftp:") return ${JSON.stringify(formatServerChain(profile.proxyForFtp, fallbacks))};`);
  }

  // 3. Fallback
  const fallback = formatFixedChain(profile);
  lines.push(`  return ${JSON.stringify(fallback)};`);
  lines.push('}');

  return lines.join('\n');
}

/**
 * Generate full PAC script for a SwitchProfile
 */
export function generateSwitchPacScript(
  profile: SwitchProfile,
  profiles: Record<string, Profile>
): string {
  // PAC JS context persists across FindProxyForURL calls: top-level statements
  // run once at script eval, function-body statements run per request URL.
  // Hoist everything invariant (regex literals, suffix map) to top scope —
  // a regex literal inside the body still allocates a RegExp object per call.
  const topLevel: string[] = [];
  let regexCount = 0;
  let needsLurl = false;
  const hoist = (code: string): string => {
    const m = /^\/(.+)\/(i*)\.test\((host|url)\)$/.exec(code);
    if (m) {
      const name = `__re${regexCount++}`;
      topLevel.push(`var ${name} = /${m[1]}/${m[2]};`);
      return `${name}.test(${m[3]})`;
    }
    if (code.includes('url.toLowerCase().indexOf(')) {
      needsLurl = true;
      return code.replace(/url\.toLowerCase\(\)\.indexOf\(/g, '__lurl.indexOf(');
    }
    return code;
  };

  const lines: string[] = [
    'function FindProxyForURL(url, host) {',
    '  "use strict";',
    '  if (host.charCodeAt(host.length - 1) === 46) host = host.substring(0, host.length - 1);', // FQDN trailing root dot
  ];

  // Evaluate each switch rule in sequence
  for (const rule of profile.rules) {
    if (!rule.enabled) continue;
    const testCode = hoist(conditionToPacCode(rule.condition));
    const directive = getProfileDirective(rule.profileId, profiles);
    lines.push(`  if (${testCode}) return ${JSON.stringify(directive)};`);
  }
  // Evaluate rule list if enabled and cache exists
  const cache = profile.ruleList?.rulesCache;
  if (profile.ruleList?.enabled && cache && cache.length > 0) {
    const rl = profile.ruleList;
    const matchDirective = getProfileDirective(rl.matchProfileId, profiles);
    const defaultDirective = getProfileDirective(rl.defaultProfileId || profile.defaultProfileId, profiles);
    // Dedupe + split: plain host-suffix rules ('*.example.com') go into an O(labels)
    // map lookup (longest suffix wins, whitelist wins ties); regex/url rules stay linear.
    // Linear whitelist rules (e.g. @@ URL/regex) evaluate before suffixMap so specific
    // exceptions take precedence over broad domain proxy rules.
    const seen = new Set<string>();
    const suffixMap = new Map<string, string>();
    const whitelistLines: string[] = [];
    const proxyLines: string[] = [];
    const SUFFIX_RE = /^\*\.([A-Za-z0-9.-]+)$/;
    // Memoized parse: applyProfile runs on every switch/startup/rule add —
    // without the cache each one re-parses the full (4000+) line list.
    const parsed = parseRuleListCache(cache, rl.matchProfileId, rl.defaultProfileId || profile.defaultProfileId);
    for (const rule of parsed) {
      const key = `${rule.condition.conditionType}\x03${rule.condition.pattern}\x03${rule.profileId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const isWhitelist = rule.profileId !== rl.matchProfileId;
      const directive = isWhitelist ? defaultDirective : matchDirective;
      if (rule.condition.conditionType === 'HostWildcardCondition') {
        const m = SUFFIX_RE.exec(rule.condition.pattern);
        if (m?.[1]) {
          const suffix = m[1].toLowerCase();
          if (!suffixMap.has(suffix) || isWhitelist) suffixMap.set(suffix, directive);
          continue;
        }
      }
      const lineCode = `  if (${hoist(conditionToPacCode(rule.condition))}) return ${JSON.stringify(directive)};`;
      if (isWhitelist) {
        whitelistLines.push(lineCode);
      } else {
        proxyLines.push(lineCode);
      }
    }
    lines.push(...whitelistLines);
    if (suffixMap.size > 0) {
      const entries = [...suffixMap.entries()]
        .map(([suffix, d]) => `${JSON.stringify(suffix)}:${JSON.stringify(d)}`)
        .join(',');
      // Top scope: built once per script eval, not per request. SUFFIX_RE's
      // [A-Za-z0-9.-] charset keeps __proto__ out, plain literal is safe.
      topLevel.push(`var hostRules = Object.assign(Object.create(null), {${entries}});`);
      // Allocation-free suffix walk: check full host, then each post-dot
      // substring — same set as split(".").slice(i).join(".") with no arrays.
      lines.push('  var __lh = host.toLowerCase();');
      lines.push('  for (var i = 0; i <= __lh.length; i++) {');
      lines.push('    if (i === 0 || __lh.charCodeAt(i - 1) === 46) {');
      lines.push('      var hit = hostRules[__lh.substring(i)];');
      lines.push('      if (hit) return hit;');
      lines.push('    }');
      lines.push('  }');
    }
    lines.push(...proxyLines);
  }
  // Fallback to default profile
  const defaultDirective = getProfileDirective(profile.defaultProfileId, profiles);
  lines.push(`  return ${JSON.stringify(defaultDirective)};`);
  lines.push('}');

  if (needsLurl) lines.splice(3, 0, '  var __lurl = url.toLowerCase();');
  return [...topLevel, ...lines].join('\n');
}

/**
 * Main PAC compiler entrypoint
 */
export function generatePacScript(
  profile: Profile,
  profiles: Record<string, Profile>
): string {
  switch (profile.profileType) {
    case 'DirectProfile':
      return 'function FindProxyForURL(url, host) { return "DIRECT"; }';

    case 'SystemProfile':
      return 'function FindProxyForURL(url, host) { return "DIRECT"; }';

    case 'FixedProfile':
      return generateFixedPacScript(profile);

    case 'SwitchProfile':
      return generateSwitchPacScript(profile, profiles);

    case 'PacProfile':
      return profile.pacScript || 'function FindProxyForURL(url, host) { return "DIRECT"; }';

    case 'VirtualProfile': {
      const resolved = resolveProfile(profile.targetProfileId, profiles);
      if (!resolved) return 'function FindProxyForURL(url, host) { return "DIRECT"; }';
      return generatePacScript(resolved, profiles);
    }

    default:
      return 'function FindProxyForURL(url, host) { return "DIRECT"; }';
  }
}

/**
 * Generate a probe PAC script routing targetHost through one proxy directive.
 * Host-only match: Chrome strips path+query of HTTPS URLs before PAC
 * evaluation (PacHttpsUrlStrippingEnabled), so URL markers cannot select
 * candidates — callers probing multiple candidates write this PAC per
 * candidate sequentially.
 *
 * No `; DIRECT` fallback: a probe measuring a dead proxy must fail, not
 * silently pass via a direct connection (false-positive latency).
 */
export function generateProbePacScript(
  directive: string,
  targetHost: string,
  currentProfile?: Profile,
  profiles: Record<string, Profile> = {}
): string {
  const block = `  if (host === ${JSON.stringify(targetHost.toLowerCase().replace(/^\[|\]$/g, ''))}) return ${JSON.stringify(directive)};`;

  if (!currentProfile) {
    return `function FindProxyForURL(url, host) {\n${block}\n  return "DIRECT";\n}`;
  }

  const baseScript = generatePacScript(currentProfile, profiles);
  // Insert after the directive prologue + host normalization: splicing right
  // after the function header would push "use strict" out of the prologue
  // (sloppy mode) and compare against the un-normalized host.
  const needle = 'function FindProxyForURL(url, host) {';
  const anchors = ['  if (host.charCodeAt(host.length - 1) === 46) host = host.substring(0, host.length - 1);', '  "use strict";', needle];
  for (const anchor of anchors) {
    const idx = baseScript.indexOf(anchor);
    if (idx !== -1) {
      const insertPos = idx + anchor.length;
      return baseScript.slice(0, insertPos) + `\n${block}` + baseScript.slice(insertPos);
    }
  }

  return `function FindProxyForURL(url, host) {\n${block}\n  return "DIRECT";\n}`;
}

/**
 * Generate a temporary PAC script for testing a specific proxy server against a target host
 */
export function generateTestPacScript(
  targetProxy: ProxyServer,
  targetHost: string,
  currentProfile?: Profile,
  profiles: Record<string, Profile> = {}
): string {
  return generateProbePacScript(formatProxyDirective(targetProxy), targetHost, currentProfile, profiles);
}
