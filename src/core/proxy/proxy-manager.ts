/**
 * NeoOmega Proxy Manager
 * Coordinates chrome.proxy.settings and active profile state
 */

import { generatePacScript, resolveProfile } from '../pac/generator';
import { getActiveProfile, getSettings } from '../storage/storage';
import type { Profile } from '../types';
let lastAppliedKey: string | null = null;
let proxyQueue: Promise<void> = Promise.resolve();

const setProxy = (value: chrome.proxy.ProxyConfig, key: string): Promise<void> => {
  const p = proxyQueue.then(async () => {
    if (lastAppliedKey === key) return;
    await chrome.proxy.settings.set({ value, scope: 'regular' });
    lastAppliedKey = key;
  });
  proxyQueue = p.catch(() => {});
  return p;
};

const clearProxy = (): Promise<void> => {
  const p = proxyQueue.then(async () => {
    if (lastAppliedKey === 'system') return;
    await chrome.proxy.settings.clear({ scope: 'regular' });
    lastAppliedKey = 'system';
  });
  proxyQueue = p.catch(() => {});
  return p;
};

export class ProxyManager {
  /** Drop cached proxy state; required after any direct chrome.proxy.settings write (e.g. proxy test) */
  static invalidateCache(): void {
    lastAppliedKey = null;
  }

  /**
   * Apply a profile to Chromium proxy settings
   */
  static async applyProfile(profile: Profile, profiles: Record<string, Profile>): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.proxy?.settings) {
      return;
    }

    // Resolve virtual profiles
    let target = profile;
    if (target.profileType === 'VirtualProfile') {
      const resolved = resolveProfile(target.targetProfileId, profiles);
      target = resolved || profiles['direct'] || { id: 'direct', name: 'Direct', profileType: 'DirectProfile', color: '#6b7280' };
    }

    switch (target.profileType) {
      case 'SystemProfile': {
        // Return proxy control to Chromium/OS
        await clearProxy();
        break;
      }

      case 'DirectProfile': {
        await setProxy({ mode: 'direct' }, 'direct');
        break;
      }

      case 'PacProfile': {
        if (target.pacUrl) {
          await setProxy(
            { mode: 'pac_script', pacScript: { url: target.pacUrl, mandatory: true } },
            `pacurl:${target.pacUrl}`
          );
        } else if (target.pacScript) {
          await setProxy(
            { mode: 'pac_script', pacScript: { data: target.pacScript, mandatory: true } },
            `pacdata:${target.pacScript}`
          );
        } else {
          await setProxy({ mode: 'direct' }, 'direct');
        }
        break;
      }

      case 'FixedProfile':
      case 'SwitchProfile': {
        // Compile to clean Chromium PAC script data
        const pacData = generatePacScript(target, profiles);
        await setProxy(
          { mode: 'pac_script', pacScript: { data: pacData, mandatory: true } },
          `pacdata:${pacData}`
        );
        break;
      }

      default: {
        await setProxy({ mode: 'direct' }, 'direct');
        break;
      }
    }

    await this.updateBadge(target);
  }

  /**
   * Apply current active profile stored in settings
   */
  static async applyCurrentActive(): Promise<void> {
    const settings = await getSettings();
    const active = settings.profiles[settings.activeProfileId];
    if (active) {
      await this.applyProfile(active, settings.profiles);
    }
  }

  /**
   * Update browser action badge reflecting active profile
   */
  static async updateBadge(profile: Profile): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.action) return;

    // Use first 2 chars of profile name
    const text = profile.name.slice(0, 2).toUpperCase();
    await chrome.action.setBadgeText({ text });

    if (profile.color) {
      await chrome.action.setBadgeBackgroundColor({ color: profile.color });
    }
  }
}
