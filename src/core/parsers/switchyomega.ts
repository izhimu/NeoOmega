/**
 * SwitchyOmega / ZeroOmega .bak Backup File Parser & Converter
 */

import type { AppSettings, FixedProfile, PacProfile, Profile, SwitchProfile, VirtualProfile } from '../types';

interface RawProxyServer {
  scheme?: 'http' | 'https' | 'socks4' | 'socks5';
  host?: string;
  port?: number;
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
  bypassList?: RawCondition[];
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

  // NeoOmega native backup: plain AppSettings JSON
  if (raw['profiles'] && typeof raw['activeProfileId'] === 'string') {
    return raw as unknown as AppSettings;
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

  // Process all keys starting with '+'
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('+') || typeof value !== 'object' || !value) {
      continue;
    }

    const item = value as RawProfileObject;
    const rawName = item.name || key.slice(1);
    const profileId = rawName.toLowerCase().replace(/\s+/g, '_');

    switch (item.profileType) {
      case 'FixedProfile': {
        const fixed: FixedProfile = {
          id: profileId,
          name: rawName,
          profileType: 'FixedProfile',
          color: item.color || '#f97316',
          fallbackProxy: item.fallbackProxy?.host ? {
            scheme: item.fallbackProxy.scheme || 'http',
            host: item.fallbackProxy.host,
            port: item.fallbackProxy.port || 7890,
          } : undefined,
          proxyForHttp: item.proxyForHttp?.host ? {
            scheme: 'http',
            host: item.proxyForHttp.host,
            port: item.proxyForHttp.port || 80,
          } : undefined,
          proxyForHttps: item.proxyForHttps?.host ? {
            scheme: 'https',
            host: item.proxyForHttps.host,
            port: item.proxyForHttps.port || 443,
          } : undefined,
          bypassList: Array.isArray(item.bypassList)
            ? item.bypassList.map((b) => ({
                conditionType: b.conditionType || 'BypassCondition',
                pattern: b.pattern || '',
              }))
            : [],
        };
        profiles[profileId] = fixed;
        order.push(profileId);
        break;
      }

      case 'SwitchProfile': {
        const defaultProfileName = item.defaultProfileName || 'direct';
        const defaultId = defaultProfileName.toLowerCase().replace(/\s+/g, '_');

        const sw: SwitchProfile = {
          id: profileId,
          name: rawName,
          profileType: 'SwitchProfile',
          color: item.color || '#a855f7',
          defaultProfileId: defaultId,
          rules: Array.isArray(item.rules)
            ? item.rules.map((r, idx) => ({
                id: `r_${idx}_${Date.now()}`,
                enabled: true,
                condition: {
                  conditionType: r.condition?.conditionType || 'HostWildcardCondition',
                  pattern: r.condition?.pattern || '',
                },
                profileId: (r.profileName || 'direct').toLowerCase().replace(/\s+/g, '_'),
                note: r.note,
              }))
            : [],
        };
        if (item.ruleList?.url) {
          sw.ruleList = {
            id: `rl_${Date.now()}`,
            url: item.ruleList.url,
            format: item.ruleList.format?.toLowerCase() === 'switchy' ? 'switchy' : 'autoproxy',
            matchProfileId: (item.ruleList.matchProfileName || 'proxy').toLowerCase().replace(/\s+/g, '_'),
            defaultProfileId: (item.ruleList.defaultProfileName || defaultProfileName).toLowerCase().replace(/\s+/g, '_'),
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
        const targetId = targetName.toLowerCase().replace(/\s+/g, '_');
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
    ? startupName.toLowerCase().replace(/\s+/g, '_')
    : (order[2] || 'system');

  return {
    activeProfileId: profiles[activeProfileId] ? activeProfileId : 'system',
    profiles,
    order,
    theme: 'auto',
    enableErrorMonitoring: true,
  };
}
