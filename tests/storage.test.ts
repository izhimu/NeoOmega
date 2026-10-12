import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProxyManager } from '../src/core/proxy/proxy-manager';
import {
  DEFAULT_SETTINGS,
  adoptSyncSettings,
  getSettings,
  normalizeBypassList,
  pushSettingsToSync,
  saveSettings,
} from '../src/core/storage/storage';
import type { AppSettings, FixedProfile, SwitchProfile } from '../src/core/types';

describe('Storage Manager Guards', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('getSettings fallbacks and corruption handling', () => {
    it('returns a fresh clone of DEFAULT_SETTINGS when storage is unavailable', async () => {
      Object.assign(globalThis, { chrome: undefined });
      const s1 = await getSettings();
      s1.theme = 'dark';
      expect(DEFAULT_SETTINGS.theme).toBe('auto');

      const s2 = await getSettings();
      expect(s2.theme).toBe('auto');
    });

    it('returns default settings clone when stored object is missing profiles (corrupted)', async () => {
      const mockStorage: Record<string, unknown> = {
        neo_omega_settings: {
          activeProfileId: 'custom',
          // profiles missing
        },
      };
      const mockChrome = {
        storage: {
          local: {
            get: vi.fn().mockImplementation(async (key: string) => ({ [key]: mockStorage[key] })),
            set: vi.fn(),
          },
        },
      };
      Object.assign(globalThis, { chrome: mockChrome });

      const settings = await getSettings();
      expect(settings.profiles).toBeDefined();
      expect(settings.profiles['direct']).toBeDefined();
      expect(settings.activeProfileId).toBe('system');
    });
  });

  describe('normalizeBypassList', () => {
    it('splits strings on semicolons, newlines, and commas, trimming and dropping empties', () => {
      const result = normalizeBypassList('<local>; 127.0.0.1, \n ; 10.0.0.0/8 ;;; *.lan');
      expect(result).toHaveLength(4);
      expect(result.map((r) => r.pattern)).toEqual(['<local>', '127.0.0.1', '10.0.0.0/8', '*.lan']);
    });

    it('trims string items in array and drops empties', () => {
      const result = normalizeBypassList(['  <local>  ', '', '   ', '10.0.0.0/8']);
      expect(result).toHaveLength(2);
      expect(result[0]?.pattern).toBe('<local>');
      expect(result[1]?.pattern).toBe('10.0.0.0/8');
    });

    it('wraps single condition object as [raw] instead of decomposing into garbage rules', () => {
      const singleCondition = {
        id: 'bp_single',
        pattern: '192.168.1.0/24',
        conditionType: 'BypassCondition' as const,
      };
      const result = normalizeBypassList(singleCondition);
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('bp_single');
      expect(result[0]?.pattern).toBe('192.168.1.0/24');
      expect(result[0]?.conditionType).toBe('BypassCondition');
    });
  });

  describe('adoptSyncSettings', () => {
    it('preserves local auth credentials on adopted profile servers matching profileId, host, and port', async () => {
      const localFixed: FixedProfile = {
        id: 'proxy',
        name: 'Proxy',
        profileType: 'FixedProfile',
        fallbackProxy: {
          scheme: 'http',
          host: '1.2.3.4',
          port: 8080,
          auth: { username: 'local_user', password: 'local_password' },
        },
        bypassList: [],
      };

      const localSettings: AppSettings = {
        activeProfileId: 'proxy',
        profiles: { proxy: localFixed },
        order: ['proxy'],
        theme: 'auto',
        enableCloudSync: true,
        enableErrorMonitoring: false,
        settingsUpdatedAt: 100,
      };

      // Remote has stripped auth
      const remoteFixed: FixedProfile = {
        id: 'proxy',
        name: 'Proxy (Remote Renamed)',
        profileType: 'FixedProfile',
        fallbackProxy: {
          scheme: 'http',
          host: '1.2.3.4',
          port: 8080,
        },
        bypassList: [],
      };

      const remoteSettings: AppSettings = {
        activeProfileId: 'proxy',
        profiles: { proxy: remoteFixed },
        order: ['proxy'],
        theme: 'light',
        enableCloudSync: true,
        enableErrorMonitoring: false,
        settingsUpdatedAt: 200,
      };

      const localStore: Record<string, unknown> = {
        neo_omega_settings: localSettings,
      };
      let savedLocal: AppSettings | null = null;

      const mockChrome = {
        storage: {
          local: {
            get: vi.fn().mockImplementation(async (key: string) => ({ [key]: localStore[key] })),
            set: vi.fn().mockImplementation(async (items: Record<string, unknown>) => {
              if (items['neo_omega_settings']) {
                savedLocal = items['neo_omega_settings'] as AppSettings;
              }
            }),
          },
          sync: {
            get: vi.fn().mockImplementation(async (keys: string | string[]) => {
              if (keys === 'neo_omega_sync_meta') {
                return { neo_omega_sync_meta: { chunks: 1, updatedAt: 200 } };
              }
              return { neo_omega_sync_0: JSON.stringify(remoteSettings) };
            }),
          },
        },
      };
      Object.assign(globalThis, { chrome: mockChrome });

      const adopted = await adoptSyncSettings();
      expect(adopted).toBe(true);
      expect(savedLocal).not.toBeNull();
      const savedProfile = savedLocal!.profiles['proxy'] as FixedProfile;
      expect(savedProfile.name).toBe('Proxy (Remote Renamed)');
      expect(savedProfile.fallbackProxy?.auth).toEqual({
        username: 'local_user',
        password: 'local_password',
      });
    });

    it('copies rulesCache and lastUpdate only when ruleList URL is unchanged', async () => {
      const localSwitchSameUrl: SwitchProfile = {
        id: 'sw_same',
        name: 'Auto 1',
        profileType: 'SwitchProfile',
        defaultProfileId: 'direct',
        rules: [],
        ruleList: {
          id: 'rl1',
          url: 'https://example.com/rules.txt',
          format: 'autoproxy',
          matchProfileId: 'proxy',
          enabled: true,
          rulesCache: ['||cached.domain'],
          lastUpdate: 12345,
        },
      };

      const localSwitchDiffUrl: SwitchProfile = {
        id: 'sw_diff',
        name: 'Auto 2',
        profileType: 'SwitchProfile',
        defaultProfileId: 'direct',
        rules: [],
        ruleList: {
          id: 'rl2',
          url: 'https://example.com/old_rules.txt',
          format: 'autoproxy',
          matchProfileId: 'proxy',
          enabled: true,
          rulesCache: ['||old.domain'],
          lastUpdate: 11111,
        },
      };

      const remoteSwitchSameUrl: SwitchProfile = {
        ...localSwitchSameUrl,
        ruleList: {
          ...localSwitchSameUrl.ruleList!,
          rulesCache: undefined,
          lastUpdate: undefined,
        },
      };

      const remoteSwitchDiffUrl: SwitchProfile = {
        ...localSwitchDiffUrl,
        ruleList: {
          ...localSwitchDiffUrl.ruleList!,
          url: 'https://example.com/new_rules.txt',
          rulesCache: undefined,
          lastUpdate: undefined,
        },
      };

      const localSettings: AppSettings = {
        activeProfileId: 'direct',
        profiles: { sw_same: localSwitchSameUrl, sw_diff: localSwitchDiffUrl },
        order: ['sw_same', 'sw_diff'],
        theme: 'auto',
        enableCloudSync: true,
        enableErrorMonitoring: false,
        settingsUpdatedAt: 100,
      };

      const remoteSettings: AppSettings = {
        activeProfileId: 'direct',
        profiles: { sw_same: remoteSwitchSameUrl, sw_diff: remoteSwitchDiffUrl },
        order: ['sw_same', 'sw_diff'],
        theme: 'auto',
        enableCloudSync: true,
        enableErrorMonitoring: false,
        settingsUpdatedAt: 200,
      };

      let savedLocal: AppSettings | null = null;
      const mockChrome = {
        storage: {
          local: {
            get: vi.fn().mockImplementation(async (key: string) => ({ [key]: localSettings })),
            set: vi.fn().mockImplementation(async (items: Record<string, unknown>) => {
              if (items['neo_omega_settings']) {
                savedLocal = items['neo_omega_settings'] as AppSettings;
              }
            }),
          },
          sync: {
            get: vi.fn().mockImplementation(async (keys: string | string[]) => {
              if (keys === 'neo_omega_sync_meta') {
                return { neo_omega_sync_meta: { chunks: 1, updatedAt: 200 } };
              }
              return { neo_omega_sync_0: JSON.stringify(remoteSettings) };
            }),
          },
        },
      };
      Object.assign(globalThis, { chrome: mockChrome });

      await adoptSyncSettings();
      expect(savedLocal).not.toBeNull();
      const adoptedSame = savedLocal!.profiles['sw_same'] as SwitchProfile;
      expect(adoptedSame.ruleList?.rulesCache).toEqual(['||cached.domain']);
      expect(adoptedSame.ruleList?.lastUpdate).toBe(12345);

      const adoptedDiff = savedLocal!.profiles['sw_diff'] as SwitchProfile;
      expect(adoptedDiff.ruleList?.rulesCache).toBeUndefined();
      expect(adoptedDiff.ruleList?.lastUpdate).toBeUndefined();
    });
  });

  describe('pushSettingsToSync serialization', () => {
    it('serializes concurrent pushes through syncQueue without chunk corruption', async () => {
      const recordedSetCalls: Record<string, unknown>[] = [];
      const mockChrome = {
        storage: {
          sync: {
            get: vi.fn().mockResolvedValue({}),
            set: vi.fn().mockImplementation(async (items: Record<string, unknown>) => {
              await Promise.resolve();
              recordedSetCalls.push(items);
            }),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        },
      };
      Object.assign(globalThis, { chrome: mockChrome });

      const settings1: AppSettings = {
        activeProfileId: 'direct',
        profiles: {},
        order: [],
        theme: 'light',
        enableCloudSync: true,
        enableErrorMonitoring: false,
        settingsUpdatedAt: 1,
      };
      const settings2: AppSettings = {
        ...settings1,
        theme: 'dark',
        settingsUpdatedAt: 2,
      };

      await Promise.all([pushSettingsToSync(settings1), pushSettingsToSync(settings2)]);
      expect(recordedSetCalls).toHaveLength(2);
      expect((recordedSetCalls[0]?.['neo_omega_sync_meta'] as { updatedAt: number }).updatedAt).toBe(1);
      expect((recordedSetCalls[1]?.['neo_omega_sync_meta'] as { updatedAt: number }).updatedAt).toBe(2);
    });
  });

  describe('ProxyManager applyCurrentActive fallback', () => {
    it('falls back to direct profile when activeProfileId was deleted', async () => {
      const clearSpy = vi.fn().mockResolvedValue(undefined);
      const setSpy = vi.fn().mockResolvedValue(undefined);
      const mockChrome = {
        proxy: {
          settings: {
            set: setSpy,
            clear: clearSpy,
          },
        },
        action: {
          setBadgeText: vi.fn().mockResolvedValue(undefined),
          setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
        },
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({
              neo_omega_settings: {
                activeProfileId: 'deleted_profile_id',
                profiles: {
                  direct: { id: 'direct', name: 'Direct', profileType: 'DirectProfile' },
                },
                order: ['direct'],
              },
            }),
          },
        },
      };
      Object.assign(globalThis, { chrome: mockChrome });

      ProxyManager.invalidateCache();
      await ProxyManager.applyCurrentActive();

      expect(setSpy).toHaveBeenCalledWith(
        expect.objectContaining({ value: { mode: 'direct' }, scope: 'regular' })
      );
    });

    it('clears proxy when both activeProfileId and direct profile are missing', async () => {
      const clearSpy = vi.fn().mockResolvedValue(undefined);
      const mockChrome = {
        proxy: {
          settings: {
            set: vi.fn().mockResolvedValue(undefined),
            clear: clearSpy,
          },
        },
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({
              neo_omega_settings: {
                activeProfileId: 'deleted_profile_id',
                profiles: {},
                order: [],
              },
            }),
          },
        },
      };
      Object.assign(globalThis, { chrome: mockChrome });

      ProxyManager.invalidateCache();
      await ProxyManager.applyCurrentActive();

      expect(clearSpy).toHaveBeenCalledWith({ scope: 'regular' });
    });
  });
});
