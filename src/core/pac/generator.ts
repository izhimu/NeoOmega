/**
 * NeoOmega PAC Script Generator
 * Compiles Profiles and Rules into high-performance Chromium PAC scripts
 */

import type { FixedProfile, Profile, ProxyServer, SwitchProfile } from '../types';
import { parseAutoProxyLine } from '../parsers/autoproxy';
import { conditionToPacCode } from './matcher';
/**
 * Format ProxyServer into standard PAC return directive
 */
export function formatProxyDirective(server?: ProxyServer): string {
  if (!server) return 'DIRECT';
  const { scheme, host, port } = server;
  switch (scheme) {
    case 'https':
      return `HTTPS ${host}:${port}`;
    case 'http':
      return `PROXY ${host}:${port}`;
    case 'socks5':
      return `SOCKS5 ${host}:${port}; SOCKS ${host}:${port}`;
    case 'socks4':
      return `SOCKS ${host}:${port}`;
    case 'direct':
    default:
      return 'DIRECT';
  }
}

/**
 * Format FixedProfile proxy chain: primary + failover servers joined with ';'
 * Chromium tries each in order on connection failure.
 */
export function formatFixedChain(profile: FixedProfile): string {
  const primary = profile.fallbackProxy || profile.proxyForHttps || profile.proxyForHttp;
  const chain = [primary, ...(profile.fallbackServers ?? [])]
    .filter((s): s is ProxyServer => !!s?.host)
    .map(formatProxyDirective);
  return chain.length ? chain.join('; ') : 'DIRECT';
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

  if (hasHttps) {
    lines.push(`  if (url.substring(0, 6) === "https:") return ${JSON.stringify(formatProxyDirective(profile.proxyForHttps))};`);
  }
  if (hasHttp) {
    lines.push(`  if (url.substring(0, 5) === "http:") return ${JSON.stringify(formatProxyDirective(profile.proxyForHttp))};`);
  }
  if (hasFtp) {
    lines.push(`  if (url.substring(0, 4) === "ftp:") return ${JSON.stringify(formatProxyDirective(profile.proxyForFtp))};`);
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
  const lines: string[] = [
    'function FindProxyForURL(url, host) {',
    '  "use strict";',
  ];

  // Evaluate each switch rule in sequence
  for (const rule of profile.rules) {
    if (!rule.enabled) continue;
    const testCode = conditionToPacCode(rule.condition);
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
    // Note: a suffix-map hit returns before linear whitelist regexes — overlapping
    // url-regex whitelist vs host-suffix proxy conflicts resolve in favor of the map.
    const seen = new Set<string>();
    const suffixMap = new Map<string, string>();
    const whitelistLines: string[] = [];
    const proxyLines: string[] = [];
    const SUFFIX_RE = /^\*\.([A-Za-z0-9.-]+)$/;
    for (let i = 0; i < cache.length; i++) {
      const line = cache[i];
      if (!line) continue;
      const rule = parseAutoProxyLine(line, i, rl.matchProfileId, rl.defaultProfileId || profile.defaultProfileId);
      if (!rule) continue;
      const key = `${rule.condition.conditionType}:${rule.condition.pattern}:${rule.profileId}`;
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
      const lineCode = `  if (${conditionToPacCode(rule.condition)}) return ${JSON.stringify(directive)};`;
      if (isWhitelist) {
        whitelistLines.push(lineCode);
      } else {
        proxyLines.push(lineCode);
      }
    }
    if (suffixMap.size > 0) {
      const entries = [...suffixMap.entries()]
        .map(([suffix, d]) => `${JSON.stringify(suffix)}:${JSON.stringify(d)}`)
        .join(',');
      lines.push(`  var hostRules = {${entries}};`);
      lines.push('  var hostParts = host.split(".");');
      lines.push('  for (var i = 0; i < hostParts.length; i++) {');
      lines.push('    var hit = hostRules[hostParts.slice(i).join(".")];');
      lines.push('    if (hit) return hit;');
      lines.push('  }');
    }
    lines.push(...whitelistLines, ...proxyLines);
  }

  // Fallback to default profile
  const defaultDirective = getProfileDirective(profile.defaultProfileId, profiles);
  lines.push(`  return ${JSON.stringify(defaultDirective)};`);
  lines.push('}');

  return lines.join('\n');
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
 * Generate a temporary PAC script for testing a specific proxy server against a target host
 */
export function generateTestPacScript(
  targetProxy: ProxyServer,
  targetHost: string,
  currentProfile?: Profile,
  profiles: Record<string, Profile> = {}
): string {
  const directive = formatProxyDirective(targetProxy);
  const probeCondition = `if (host === ${JSON.stringify(targetHost)}) return ${JSON.stringify(directive + '; DIRECT')};`;

  if (!currentProfile) {
    return `function FindProxyForURL(url, host) {\n  ${probeCondition}\n  return "DIRECT";\n}`;
  }

  const baseScript = generatePacScript(currentProfile, profiles);
  const needle = 'function FindProxyForURL(url, host) {';
  const idx = baseScript.indexOf(needle);
  if (idx !== -1) {
    const insertPos = idx + needle.length;
    return baseScript.slice(0, insertPos) + `\n  ${probeCondition}` + baseScript.slice(insertPos);
  }

  return `function FindProxyForURL(url, host) {\n  ${probeCondition}\n  return "DIRECT";\n}`;
}
