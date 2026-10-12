/**
 * SwitchyOmega / ZeroOmega .bak Backup File Parser & Converter
 */

import type { AppSettings, FixedProfile, PacProfile, Profile, ProxyServer, SwitchProfile, VirtualProfile } from '../types';
import { normalizeBypassList, normalizeSettings } from '../storage/storage';
import { isSafeRuleRegex } from './autoproxy';

interface RawProxyServer {
  scheme?: 'http' | 'https' | 'socks4' | 'socks5';
  host?: string;
  port?: number;
  auth?: { username?: string; password?: string };
}

interface RawCondition {
  conditionType?: 'HostWildcardCondition' | 'HostRegexCondition' | 'UrlWildcardCondition' | 'UrlRegexCondition' | 'KeywordCondition' | 'IpCondition' | 'BypassCondition';
  pattern?: string;
}

interface RawSwitchRule {
  condition?: RawCondition;
  profileName?: string;
  note?: string;
}

interface RawProfileObject {
  name?: string;
  profileType?: string;
  color?: string;
  fallbackProxy?: RawProxyServer;
  proxyForHttp?: RawProxyServer;
  proxyForHttps?: RawProxyServer;
  proxyForFtp?: RawProxyServer;
  bypassList?: RawCondition[] | string;
  rules?: RawSwitchRule[];
  defaultProfileName?: string;
  pacUrl?: string;
  pacScript?: string;
  ruleList?: {
    url?: string;
    format?: string;
    enabled?: boolean;
    matchProfileName?: string;
    defaultProfileName?: string;
    rules?: string[];
  };
}

export function parseSwitchyOmegaBackup(jsonStr: string): AppSettings {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse SwitchyOmega JSON backup: ${message}`);
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid backup file');
  }

  // NeoOmega native backup: plain AppSettings JSON — normalize so malformed
  // files (missing order/rules/bypassList) can't crash the caller.
  if (raw['profiles'] && typeof raw['profiles'] === 'object' && !Array.isArray(raw['profiles']) && typeof raw['activeProfileId'] === 'string') {
    return normalizeSettings(raw as unknown as AppSettings);
  }

  const profiles: Record<string, Profile> = {
    direct: {
      id: 'direct',
      name: 'Direct',
      profileType: 'DirectProfile',
      color: '#22c55e',
    },
    system: {
      id: 'system',
      name: 'System Proxy',
      profileType: 'SystemProfile',
      color: '#3b82f6',
    },
  };

  const order: string[] = ['direct', 'system'];
  const usedIds = new Set<string>(['direct', 'system']);
  const nameToId = new Map<string, string>([
    ['direct', 'direct'],
    ['Direct', 'direct'],
    ['system', 'system'],
    ['System', 'system'],
    ['System Proxy', 'system'],
  ]);

  const SUPPORTED_PROFILE_TYPES: Record<string, true> = {
    FixedProfile: true,
    SwitchProfile: true,
    PacProfile: true,
    VirtualProfile: true,
  };
  const BUILTIN_NAMES: Record<string, true> = {
    direct: true,
    system: true,
    'system proxy': true,
  };

  const rawEntries: Array<{ item: RawProfileObject; rawName: string; profileId: string }> = [];
  let hasPlusEntry = false;

  // Pass 1: compute unique profile IDs and map names to final IDs
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('+') || typeof value !== 'object' || !value || Array.isArray(value)) {
      continue;
    }
    const item = value as RawProfileObject;
    if (!item.profileType || !SUPPORTED_PROFILE_TYPES[item.profileType]) {
      continue;
    }
    hasPlusEntry = true;
    const rawName = item.name || key.slice(1);
    const baseId = rawName.toLowerCase().replace(/\s+/g, '_');
    let profileId = baseId;
    let suffix = 2;
    while (usedIds.has(profileId)) {
      profileId = `${baseId}_${suffix}`;
      suffix++;
    }
    usedIds.add(profileId);
    for (const candidate of [rawName, rawName.toLowerCase(), key.slice(1), key.slice(1).toLowerCase()]) {
      if (!BUILTIN_NAMES[candidate.toLowerCase()]) {
        nameToId.set(candidate, profileId);
      }
    }

    rawEntries.push({ item, rawName, profileId });
  }

  if (!hasPlusEntry) {
    throw new Error('Not a SwitchyOmega backup');
  }

  function resolveProfileId(name: string | undefined, fallback: string): string {
    if (!name) return fallback;
    return nameToId.get(name) || nameToId.get(name.toLowerCase()) || fallback;
  }

  // Pass 2: construct profiles with resolved references
  for (const { item, rawName, profileId } of rawEntries) {
    switch (item.profileType) {
      case 'FixedProfile': {
        // Cascade mirrors formatFixedChain precedence: explicit fallbackProxy,
        // then the NORMALIZED proxyForHttps, then proxyForHttp.
        const mapServer = (s: RawProxyServer | undefined, defaultPort: number, defaultScheme: ProxyServer['scheme'] = 'http'): ProxyServer | undefined =>
          s?.host ? { scheme: s.scheme ?? defaultScheme, host: s.host, port: s.port || defaultPort, ...(s.auth ? { auth: s.auth } : {}) } : undefined;
        const proxyForHttp = mapServer(item.proxyForHttp, 80);
        const proxyForHttps = mapServer(item.proxyForHttps, 443, 'https');
        const proxyForFtp = mapServer(item.proxyForFtp, 80);
        const fallbackProxy = mapServer(item.fallbackProxy, 7890) ?? proxyForHttps ?? proxyForHttp;
        const fixed: FixedProfile = {
          id: profileId,
          name: rawName,
          profileType: 'FixedProfile',
          color: item.color || '#f97316',
          fallbackProxy,
          proxyForHttp,
          proxyForHttps,
          proxyForFtp,
          bypassList: normalizeBypassList(item.bypassList),
        };
        profiles[profileId] = fixed;
        order.push(profileId);
        break;
      }

      case 'SwitchProfile': {
        const defaultProfileName = item.defaultProfileName || 'direct';
        const defaultId = resolveProfileId(defaultProfileName, 'direct');

        const sw: SwitchProfile = {
          id: profileId,
          name: rawName,
          profileType: 'SwitchProfile',
          color: item.color || '#a855f7',
          defaultProfileId: defaultId,
          rules: Array.isArray(item.rules)
            ? item.rules
                .filter(
                  (r) =>
                    (r.condition?.conditionType !== 'UrlRegexCondition' && r.condition?.conditionType !== 'HostRegexCondition') ||
                    isSafeRuleRegex(r.condition?.pattern || '')
                )
                .map((r, idx) => ({
                  id: `r_${idx}_${Date.now()}`,
                  enabled: true,
                  condition: {
                    conditionType: r.condition?.conditionType || 'HostWildcardCondition',
                    pattern: r.condition?.pattern || '',
                  },
                  profileId: resolveProfileId(r.profileName, 'direct'),
                  note: r.note,
                }))
            : [],
        };
        if (item.ruleList?.url) {
          sw.ruleList = {
            id: `rl_${Date.now()}`,
            url: item.ruleList.url,
            format: item.ruleList.format?.toLowerCase() === 'switchy' ? 'switchy' : 'autoproxy',
            matchProfileId: resolveProfileId(item.ruleList.matchProfileName, 'proxy'),
            defaultProfileId: resolveProfileId(item.ruleList.defaultProfileName || defaultProfileName, defaultId),
            enabled: item.ruleList.enabled ?? true,
            rulesCache: Array.isArray(item.ruleList.rules) ? item.ruleList.rules : undefined,
          };
        }
        profiles[profileId] = sw;
        order.push(profileId);
        break;
      }

      case 'PacProfile': {
        const pac: PacProfile = {
          id: profileId,
          name: rawName,
          profileType: 'PacProfile',
          color: item.color || '#eab308',
          pacUrl: item.pacUrl,
          pacScript: item.pacScript,
        };
        profiles[profileId] = pac;
        order.push(profileId);
        break;
      }

      case 'VirtualProfile': {
        const targetName = item.defaultProfileName || 'direct';
        const targetId = resolveProfileId(targetName, 'direct');
        const v: VirtualProfile = {
          id: profileId,
          name: rawName,
          profileType: 'VirtualProfile',
          color: item.color || '#64748b',
          targetProfileId: targetId,
        };
        profiles[profileId] = v;
        order.push(profileId);
        break;
      }
    }
  }

  const startupName = typeof raw['-startupProfileName'] === 'string' ? raw['-startupProfileName'] : '';
  const activeProfileId = startupName
    ? resolveProfileId(startupName, 'system')
    : (order[2] || 'system');
  return {
    activeProfileId: profiles[activeProfileId] ? activeProfileId : 'system',
    profiles,
    order,
    theme: 'auto',
    enableErrorMonitoring: true,
  };
}
