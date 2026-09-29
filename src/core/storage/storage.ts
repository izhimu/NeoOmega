/**
 * NeoOmega Storage Manager
 * Typed persistence layer backed by chrome.storage.local
 */

import type { AppSettings, DirectProfile, FixedProfile, Profile, RuleCondition, SwitchProfile, SystemProfile } from '../types';

export function normalizeBypassList(raw: unknown): RuleCondition[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item, idx) => {
      if (typeof item === 'string') {
        return {
          id: `bp_${idx}_${item}`,
          conditionType: 'BypassCondition',
          pattern: item,
        };
      }
      return {
        id: item?.id || `bp_${idx}_${item?.pattern || ''}`,
        conditionType: item?.conditionType || 'BypassCondition',
        pattern: String(item?.pattern || ''),
      };
    });
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[\r\n,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((pattern, idx) => ({
        id: `bp_${idx}_${pattern}`,
        conditionType: 'BypassCondition',
        pattern,
      }));
  }
  if (typeof raw === 'object') {
    return normalizeBypassList(Object.values(raw as Record<string, unknown>));
  }
  return [];
}

export const DEFAULT_PROFILES: Record<string, Profile> = {
  direct: {
    id: 'direct',
    name: 'Direct',
    profileType: 'DirectProfile',
    color: '#22c55e',
  } as DirectProfile,
  system: {
    id: 'system',
    name: 'System Proxy',
    profileType: 'SystemProfile',
    color: '#3b82f6',
  } as SystemProfile,
  proxy: {
    id: 'proxy',
    name: 'Proxy Server',
    profileType: 'FixedProfile',
    color: '#f97316',
    fallbackProxy: {
      scheme: 'http',
      host: '127.0.0.1',
      port: 7890,
    },
    bypassList: [
      { id: 'bp_1', conditionType: 'BypassCondition', pattern: '<local>' },
      { id: 'bp_2', conditionType: 'BypassCondition', pattern: '127.0.0.1/32' },
    ],
  } as FixedProfile,
  autoSwitch: {
    id: 'autoSwitch',
    name: 'Auto Switch',
    profileType: 'SwitchProfile',
    color: '#a855f7',
    defaultProfileId: 'direct',
    rules: [
      {
        id: 'r_google',
        enabled: true,
        condition: { conditionType: 'HostWildcardCondition', pattern: '*.google.com' },
        profileId: 'proxy',
        note: 'Google domains',
      },
      {
        id: 'r_github',
        enabled: true,
        condition: { conditionType: 'HostWildcardCondition', pattern: '*.github.com' },
        profileId: 'proxy',
        note: 'GitHub domains',
      },
    ],
    ruleList: {
      id: 'rulelist_default',
      url: 'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt',
      format: 'autoproxy',
      matchProfileId: 'proxy',
      defaultProfileId: 'direct',
      updateIntervalMinutes: 1440,
      enabled: false,
    },
  } as SwitchProfile,
};

export const DEFAULT_SETTINGS: AppSettings = {
  activeProfileId: 'system',
  profiles: DEFAULT_PROFILES,
  order: ['direct', 'system', 'proxy', 'autoSwitch'],
  theme: 'auto',
  language: 'auto',
  enableErrorMonitoring: true,
};

const STORAGE_KEY = 'neo_omega_settings';

export async function getSettings(): Promise<AppSettings> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return DEFAULT_SETTINGS;
  }
  const result = await chrome.storage.local.get(STORAGE_KEY);
  if (!result[STORAGE_KEY]) {
    await saveSettings(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }
  const settings = result[STORAGE_KEY] as AppSettings;
  if (settings?.profiles) {
    for (const p of Object.values(settings.profiles)) {
      if (p.profileType === 'FixedProfile') {
        const fp = p as FixedProfile;
        fp.bypassList = normalizeBypassList(fp.bypassList);
        if (!fp.fallbackProxy) {
          fp.fallbackProxy = { host: '127.0.0.1', port: 7890, scheme: 'http' };
        }
      } else if (p.profileType === 'SwitchProfile') {
        const sp = p as SwitchProfile;
        if (!Array.isArray(sp.rules)) sp.rules = [];
      }
    }
  }
  if (!Array.isArray(settings.order)) {
    if (settings.order && typeof settings.order === 'object') {
      settings.order = Object.values(settings.order);
    } else {
      settings.order = Object.keys(settings.profiles || {});
    }
  }
  return settings;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }
  const plain = JSON.parse(JSON.stringify(settings));
  await chrome.storage.local.set({ [STORAGE_KEY]: plain });
}

export async function getActiveProfile(): Promise<Profile> {
  const settings = await getSettings();
  const profile = settings.profiles[settings.activeProfileId];
  return profile || settings.profiles['direct'] || (DEFAULT_PROFILES['direct'] as Profile);
}

export async function setActiveProfileId(profileId: string): Promise<AppSettings> {
  const settings = await getSettings();
  if (!settings.profiles[profileId]) {
    throw new Error(`Profile not found: ${profileId}`);
  }
  settings.activeProfileId = profileId;
  await saveSettings(settings);
  return settings;
}
