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
  ruleListUpdateInterval: 120,
  enableCloudSync: false,
  webRtcMode: 'default',
  disableNetworkPrediction: false,
};

const STORAGE_KEY = 'neo_omega_settings';

export async function getSettings(): Promise<AppSettings> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return DEFAULT_SETTINGS;
  }
  const result = await chrome.storage.local.get(STORAGE_KEY);
  if (!result[STORAGE_KEY]) {
    // Fresh install: adopt cloud-synced settings before stamping defaults,
    // otherwise the defaults' fresh settingsUpdatedAt forever out-dates the remote copy.
    const remote = await readSyncSnapshot();
    if (remote?.profiles) {
      await saveSettings(remote);
      return remote;
    }
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
  const plain = JSON.parse(JSON.stringify(settings)) as AppSettings;
  plain.settingsUpdatedAt = Date.now();
  await chrome.storage.local.set({ [STORAGE_KEY]: plain });
  void pushSettingsToSync(plain);
}

const SYNC_META = 'neo_omega_sync_meta';
const SYNC_CHUNK = 'neo_omega_sync_';
const SYNC_CHUNK_SIZE = 2500; // sync quota: 8192 B/item; CJK chars are 3 B in UTF-8

/** Strip bulky rule caches; sync quota is 100KB total */
function stripForSync(settings: AppSettings): AppSettings {
  const plain = JSON.parse(JSON.stringify(settings)) as AppSettings;
  for (const p of Object.values(plain.profiles ?? {})) {
    if (p.profileType === 'SwitchProfile' && p.ruleList) {
      delete p.ruleList.rulesCache;
    }
  }
  return plain;
}

/** Push settings to chrome.storage.sync (chunked). Best-effort: logs, never throws. */
export async function pushSettingsToSync(settings: AppSettings): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.sync || !settings.enableCloudSync) return;
  try {
    const text = JSON.stringify(stripForSync(settings));
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += SYNC_CHUNK_SIZE) {
      chunks.push(text.slice(i, i + SYNC_CHUNK_SIZE));
    }
    const metaRes = await chrome.storage.sync.get(SYNC_META);
    const oldChunks = (metaRes[SYNC_META] as { chunks?: number } | undefined)?.chunks ?? 0;

    const items: Record<string, unknown> = {
      [SYNC_META]: { chunks: chunks.length, updatedAt: settings.settingsUpdatedAt ?? 0 },
    };
    chunks.forEach((c, i) => { items[`${SYNC_CHUNK}${i}`] = c; });
    await chrome.storage.sync.set(items);

    if (oldChunks > chunks.length) {
      const orphans = Array.from(
        { length: oldChunks - chunks.length },
        (_, i) => `${SYNC_CHUNK}${chunks.length + i}`
      );
      await chrome.storage.sync.remove(orphans);
    }
  } catch (err) {
    console.warn('[NeoOmega] sync push failed:', err);
  }
}

/** Read and assemble the sync snapshot; null when absent or corrupt. No staleness check. */
async function readSyncSnapshot(): Promise<AppSettings | null> {
  if (typeof chrome === 'undefined' || !chrome.storage?.sync) return null;
  const metaRes = await chrome.storage.sync.get(SYNC_META);
  const meta = metaRes[SYNC_META] as { chunks: number; updatedAt: number } | undefined;
  if (!meta || meta.chunks <= 0) return null;
  const keys = Array.from({ length: meta.chunks }, (_, i) => `${SYNC_CHUNK}${i}`);
  const chunkRes = await chrome.storage.sync.get(keys);
  const text = keys.map((k) => (chunkRes[k] as string | undefined) ?? '').join('');
  try {
    return JSON.parse(text) as AppSettings;
  } catch {
    return null;
  }
}

/** Pull settings from chrome.storage.sync; null when absent or stale. */
export async function pullSettingsFromSync(): Promise<AppSettings | null> {
  if (typeof chrome === 'undefined' || !chrome.storage?.sync) return null;
  const metaRes = await chrome.storage.sync.get(SYNC_META);
  const meta = metaRes[SYNC_META] as { chunks: number; updatedAt: number } | undefined;
  if (!meta || meta.chunks <= 0) return null;
  const local = await getSettings();
  if ((local.settingsUpdatedAt ?? 0) >= meta.updatedAt) return null;
  return readSyncSnapshot();
}

/** Adopt remote sync settings into local storage (no sync re-push). Returns true when adopted. */
export async function adoptSyncSettings(): Promise<boolean> {
  const remote = await pullSettingsFromSync();
  if (!remote?.profiles) return false;
  const local = await getSettings();
  if (!local.enableCloudSync) return false; // user disabled sync locally; don't overwrite
  for (const [id, remoteProfile] of Object.entries(remote.profiles)) {
    if (remoteProfile.profileType === 'SwitchProfile' && remoteProfile.ruleList) {
      const localProfile = local.profiles[id];
      if (
        localProfile?.profileType === 'SwitchProfile' &&
        localProfile.ruleList?.rulesCache &&
        !remoteProfile.ruleList.rulesCache
      ) {
        remoteProfile.ruleList.rulesCache = localProfile.ruleList.rulesCache;
      }
    }
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: remote });
  return true;
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
