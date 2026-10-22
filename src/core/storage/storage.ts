/**
 * NeoOmega Storage Manager
 * Typed persistence layer backed by chrome.storage.local
 */

import type { AppSettings, DirectProfile, FixedProfile, Profile, ProxyServer, RuleCondition, SwitchProfile, SystemProfile } from '../types';

export function normalizeBypassList(raw: unknown): RuleCondition[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    return raw
      .split(/[\r\n,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((pattern, idx) => ({
        id: `bp_${idx}_${pattern}`,
        conditionType: 'BypassCondition',
        pattern,
      }));
  }
  if (Array.isArray(raw)) {
    const list: RuleCondition[] = [];
    for (const item of raw) {
      if (!item) continue;
      if (typeof item === 'string') {
        const pattern = item.trim();
        if (pattern) {
          list.push({
            id: `bp_${list.length}_${pattern}`,
            conditionType: 'BypassCondition',
            pattern,
          });
        }
      } else if (typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const rawPattern = obj.pattern;
        const pattern =
          typeof rawPattern === 'string'
            ? rawPattern.trim()
            : rawPattern != null
              ? String(rawPattern).trim()
              : '';
        if (pattern) {
          const rawId = obj.id;
          const rawConditionType = obj.conditionType;
          list.push({
            id: typeof rawId === 'string' && rawId ? rawId : `bp_${list.length}_${pattern}`,
            conditionType:
              typeof rawConditionType === 'string'
                ? (rawConditionType as RuleCondition['conditionType'])
                : 'BypassCondition',
            pattern,
          });
        }
      }
    }
    return list;
  }
  if (typeof raw === 'object') {
    if ('pattern' in (raw as Record<string, unknown>)) {
      return normalizeBypassList([raw]);
    }
    return normalizeBypassList(Object.values(raw as Record<string, unknown>));
  }
  return [];
}

export function normalizeSettings(settings: AppSettings): AppSettings {
  if (settings?.profiles) {
    for (const p of Object.values(settings.profiles)) {
      if (!p || typeof p !== 'object') continue;
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
      { id: 'bp_3', conditionType: 'BypassCondition', pattern: '127.0.0.0/8' },
      { id: 'bp_4', conditionType: 'BypassCondition', pattern: '10.0.0.0/8' },
      { id: 'bp_5', conditionType: 'BypassCondition', pattern: '172.16.0.0/12' },
      { id: 'bp_6', conditionType: 'BypassCondition', pattern: '192.168.0.0/16' },
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
  enableFailureNotification: false,
  enableSpeedRecommendation: false,
  ruleListUpdateInterval: 120,
  enableCloudSync: false,
  webRtcMode: 'default',
  disableNetworkPrediction: false,
};

const STORAGE_KEY = 'neo_omega_settings';

// Module-level cache of parsed settings. Only enabled when chrome.storage.onChanged
// exists (real extension context); test mocks lack it and get per-call reads.
let settingsCache: AppSettings | null = null;
const cacheEnabled = typeof chrome !== 'undefined' && !!chrome.storage?.onChanged;
if (cacheEnabled) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(STORAGE_KEY in changes)) return;
    const v = changes[STORAGE_KEY].newValue as AppSettings | undefined;
    settingsCache = v?.profiles ? normalizeSettings(v) : null;
  });
}

export async function getSettings(): Promise<AppSettings> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return structuredClone(DEFAULT_SETTINGS);
  }
  // Callers get a private clone; mutate it freely and pass it to saveSettings.
  // The cache itself is never exposed, so failed saves leave no dirty state.
  if (settingsCache) return structuredClone(settingsCache);
  const result = await chrome.storage.local.get(STORAGE_KEY);
  // In-flight race: a concurrent save/onChanged may have populated the cache
  // while we awaited; keep the newer cache instead of overwriting it.
  if (settingsCache) return structuredClone(settingsCache);
  let rawSettings = result[STORAGE_KEY];
  let adoptedFresh = false;
  if (!rawSettings) {
    // Fresh install: adopt cloud-synced settings before stamping defaults,
    // otherwise the defaults' fresh settingsUpdatedAt forever out-dates the remote copy.
    const remote = await readSyncSnapshot();
    if (remote?.profiles) {
      rawSettings = remote;
      adoptedFresh = true;
    } else {
      const defaults = structuredClone(DEFAULT_SETTINGS);
      await saveSettings(defaults);
      return defaults;
    }
  }
  if (
    typeof rawSettings !== 'object' ||
    rawSettings === null ||
    Array.isArray(rawSettings) ||
    !('profiles' in rawSettings) ||
    typeof rawSettings.profiles !== 'object' ||
    rawSettings.profiles === null ||
    Array.isArray(rawSettings.profiles)
  ) {
    return structuredClone(DEFAULT_SETTINGS);
  }
  const settings = normalizeSettings(rawSettings as AppSettings);
  if (adoptedFresh) {
    await saveSettings(settings);
    return settings;
  }
  if (cacheEnabled) {
    settingsCache = settings;
    return structuredClone(settings);
  }
  return settings;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }
  // Clone to detach Vue reactivity before persisting; callers never hold the cache object.
  const plain = JSON.parse(JSON.stringify(settings)) as AppSettings;
  plain.settingsUpdatedAt = Date.now();
  await chrome.storage.local.set({ [STORAGE_KEY]: plain });
  if (cacheEnabled) settingsCache = plain;
  void pushSettingsToSync(plain);
}

const SYNC_META = 'neo_omega_sync_meta';
const SYNC_CHUNK = 'neo_omega_sync_';
const SYNC_CHUNK_SIZE = 2500; // sync quota: 8192 B/item; CJK chars are 3 B in UTF-8

/** Strip bulky rule caches and credentials; sync quota is 100KB total */
function stripForSync(settings: AppSettings): AppSettings {
  // Shallow-copy only what we strip — a full deep clone copies multi-MB
  // ruleList caches and every server object just to delete keys afterwards.
  const stripServer = <S extends ProxyServer | undefined>(s: S): S => {
    if (!s?.auth) return s;
    const c = { ...s };
    delete c.auth;
    return c as S; // cast: c is s minus an optional key
  };
  const profiles: Record<string, Profile> = { ...settings.profiles };
  for (const [id, p] of Object.entries(profiles)) {
    if (p.profileType === 'SwitchProfile' && p.ruleList) {
      const ruleList = { ...p.ruleList };
      delete ruleList.rulesCache;
      profiles[id] = { ...p, ruleList };
    } else if (p.profileType === 'FixedProfile') {
      const fp = p as FixedProfile;
      profiles[id] = {
        ...fp,
        proxyForHttp: stripServer(fp.proxyForHttp),
        proxyForHttps: stripServer(fp.proxyForHttps),
        proxyForFtp: stripServer(fp.proxyForFtp),
        fallbackProxy: stripServer(fp.fallbackProxy),
        fallbackServers: fp.fallbackServers?.map(stripServer),
      };
    }
  }
  return { ...settings, profiles };
}

let syncQueue: Promise<void> = Promise.resolve();

/** Push settings to chrome.storage.sync (chunked). Best-effort: logs, never throws. */
export async function pushSettingsToSync(settings: AppSettings): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.sync || !settings.enableCloudSync) return;
  const doPush = async (): Promise<void> => {
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
  };
  syncQueue = syncQueue.then(doPush, doPush);
  return syncQueue;
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

  const localAuthMap = new Map<string, Array<{ host: string; port: number; auth: { username?: string; password?: string } }>>();
  for (const [id, profile] of Object.entries(local.profiles || {})) {
    if (profile.profileType === 'FixedProfile') {
      const fp = profile as FixedProfile;
      const servers = [
        fp.fallbackProxy,
        fp.proxyForHttp,
        fp.proxyForHttps,
        fp.proxyForFtp,
        ...(fp.fallbackServers ?? []),
      ];
      const authList: Array<{ host: string; port: number; auth: { username?: string; password?: string } }> = [];
      for (const s of servers) {
        if (s?.host && s?.port && s.auth) {
          authList.push({ host: s.host, port: s.port, auth: s.auth });
        }
      }
      if (authList.length > 0) {
        localAuthMap.set(id, authList);
      }
    }
  }

  for (const [id, remoteProfile] of Object.entries(remote.profiles)) {
    if (remoteProfile.profileType === 'FixedProfile') {
      const authList = localAuthMap.get(id);
      if (authList) {
        const fp = remoteProfile as FixedProfile;
        const servers = [
          fp.fallbackProxy,
          fp.proxyForHttp,
          fp.proxyForHttps,
          fp.proxyForFtp,
          ...(fp.fallbackServers ?? []),
        ];
        for (const s of servers) {
          if (s?.host && s?.port && !s.auth) {
            const match = authList.find(
              (a) => a.host.toLowerCase() === s.host.toLowerCase() && a.port === s.port
            );
            if (match) {
              s.auth = match.auth;
            }
          }
        }
      }
    } else if (remoteProfile.profileType === 'SwitchProfile' && remoteProfile.ruleList) {
      const localProfile = local.profiles[id];
      if (
        localProfile?.profileType === 'SwitchProfile' &&
        localProfile.ruleList?.url === remoteProfile.ruleList.url
      ) {
        if (localProfile.ruleList.rulesCache && !remoteProfile.ruleList.rulesCache) {
          remoteProfile.ruleList.rulesCache = localProfile.ruleList.rulesCache;
        }
        if (localProfile.ruleList.lastUpdate && !remoteProfile.ruleList.lastUpdate) {
          remoteProfile.ruleList.lastUpdate = localProfile.ruleList.lastUpdate;
        }
      }
    }
  }

  normalizeSettings(remote);
  await chrome.storage.local.set({ [STORAGE_KEY]: remote });
  if (cacheEnabled) settingsCache = remote;
  return true;
}

export async function getActiveProfile(): Promise<Profile> {
  const settings = await getSettings();
  const profile = settings.profiles[settings.activeProfileId];
  return profile || settings.profiles['direct'] || structuredClone(DEFAULT_PROFILES['direct'] as Profile);
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
