/**
 * NeoOmega Proxy Authentication Manager
 * Handles chrome.webRequest.onAuthRequired to automatically supply credentials for configured proxies
 */

import { getSettings } from '../storage/storage';
import type { AppSettings, FixedProfile, Profile } from '../types';

// Chrome's challenger.host reports IPv6 without brackets; users may enter either form.
const normHost = (h: string) => h.toLowerCase().replace(/^\[|\]$/g, '');

export interface AuthCredentials {
  username: string;
  password: string;
}

let tempProxyAuth: { host: string; port: number; auth: AuthCredentials } | null = null;

export function setTempProxyCredentials(host: string, port: number, auth?: { username?: string; password?: string }): void {
  if (auth?.username) {
    tempProxyAuth = { host: normHost(host), port, auth: { username: auth.username, password: auth.password || '' } };
  } else {
    tempProxyAuth = null;
  }
}

export function clearTempProxyCredentials(): void {
  tempProxyAuth = null;
}

let credsCache: Map<string, AuthCredentials> | null = null;

function addServersToMap(fixed: FixedProfile, map: Map<string, AuthCredentials>): void {
  const servers = [
    fixed.fallbackProxy,
    fixed.proxyForHttp,
    fixed.proxyForHttps,
    fixed.proxyForFtp,
    ...(fixed.fallbackServers ?? []),
  ];
  for (const server of servers) {
    if (server?.host && server.auth?.username) {
      map.set(`${normHost(server.host)}:${server.port}`, {
        username: server.auth.username,
        password: server.auth.password || '',
      });
    }
  }
}

export function rebuildCache(settings: AppSettings): void {
  const map = new Map<string, AuthCredentials>();
  const profiles = settings.profiles || {};
  for (const profile of Object.values(profiles)) {
    if (profile.profileType === 'FixedProfile') {
      addServersToMap(profile as FixedProfile, map);
    }
  }

  // Active profile creds win if multiple profiles share host:port
  const active = profiles[settings.activeProfileId];
  if (active?.profileType === 'FixedProfile') {
    addServersToMap(active as FixedProfile, map);
  } else if (active?.profileType === 'VirtualProfile') {
    const target = profiles[active.targetProfileId];
    if (target?.profileType === 'FixedProfile') {
      addServersToMap(target as FixedProfile, map);
    }
  } else if (active?.profileType === 'SwitchProfile') {
    // Rule targets + default actually carry traffic under a switch profile —
    // their creds must win host:port collisions over unrelated profiles.
    // Default first: specific rule targets override it.
    const def = profiles[active.defaultProfileId];
    if (def?.profileType === 'FixedProfile') addServersToMap(def as FixedProfile, map);
    for (const rule of active.rules ?? []) {
      const target = profiles[rule.profileId];
      if (target?.profileType === 'FixedProfile') addServersToMap(target as FixedProfile, map);
    }
  }

  credsCache = map;
  // Credentials may have changed: lift any loop block so a fixed password
  // takes effect immediately instead of after the 60s cooldown.
  resetChallengeTracker();
}

export function getCredsCache(): Map<string, AuthCredentials> | null {
  return credsCache;
}

interface ChallengeState {
  count: number;
  firstTime: number;
}

// Retries counted per requestId: a re-auth loop is ONE request re-challenged
// repeatedly. Counting per host:port false-positives on parallel connections
// (Chrome opens ~6 sockets on page load) and locks out valid auth for 60s.
const challengeTracker = new Map<string, ChallengeState>();
const blockedProxies = new Map<string, number>(); // host:port -> blockedUntil
let nextSweep = 0; // throttle for stale-entry sweeps

export function isChallengeLooping(host: string, port: number, requestId: string, now = Date.now()): boolean {
  const proxyKey = `${normHost(host)}:${port}`;
  const blockedUntil = blockedProxies.get(proxyKey) || 0;
  if (blockedUntil) {
    if (now < blockedUntil) return true;
    blockedProxies.delete(proxyKey);
  }

  const state = challengeTracker.get(requestId);
  if (!state || now - state.firstTime > 10_000) {
    challengeTracker.set(requestId, { count: 1, firstTime: now });
  } else {
    state.count += 1;
    if (state.count > 3) {
      challengeTracker.delete(requestId);
      blockedProxies.set(proxyKey, now + 60_000);
      return true;
    }
  }
  // ponytail: requestIds get no completion event — sweep stale entries, bounded map.
  // nextSweep throttles the full-map scan to once per 5s; otherwise with 500+
  // fresh ids every auth challenge scanned all entries.
  if (challengeTracker.size > 500 && now >= nextSweep) {
    nextSweep = now + 5_000;
    for (const [id, s] of challengeTracker) {
      if (now - s.firstTime > 60_000) challengeTracker.delete(id);
    }
  }
  return false;
}

export function resetChallengeTracker(): void {
  challengeTracker.clear();
  nextSweep = 0;
  blockedProxies.clear();
}
/**
 * Search profiles for configured credentials matching target host and port
 */
export function findProxyCredentials(
  host: string,
  port: number,
  profiles: Record<string, Profile>
): AuthCredentials | null {
  for (const profile of Object.values(profiles)) {
    if (profile.profileType === 'FixedProfile') {
      const fixed = profile as FixedProfile;
      const servers = [
        fixed.fallbackProxy,
        fixed.proxyForHttp,
        fixed.proxyForHttps,
        fixed.proxyForFtp,
        ...(fixed.fallbackServers ?? []),
      ];

      for (const server of servers) {
        if (
          server?.host &&
          normHost(server.host) === normHost(host) &&
          server.port === port &&
          server.auth?.username
        ) {
          return {
            username: server.auth.username,
            password: server.auth.password || '',
          };
        }
      }
    }
  }

  return null;
}

/**
 * Initialize WebRequest Auth Required listener
 */
export function initAuthManager(): void {
  if (
    typeof chrome === 'undefined' ||
    !chrome.webRequest?.onAuthRequired
  ) {
    return;
  }

  // In-memory credential cache: onAuthRequired is asyncBlocking (the request
  // waits on us), so a chrome.storage.local.get of the full settings doc —
  // including a multi-MB ruleList cache — per 407 challenge is not acceptable.
  // Rebuilt on startup and on any settings write.
  getSettings().then((s) => rebuildCache(s)).catch(() => {});
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !changes['neo_omega_settings']) return;
    const newSettings = changes['neo_omega_settings'].newValue as AppSettings | undefined;
    if (newSettings?.profiles) rebuildCache(newSettings);
  });

  // Use asyncBlocking spec when webRequestAuthProvider is declared
  chrome.webRequest.onAuthRequired.addListener(
    (details, callback): chrome.webRequest.BlockingResponse | undefined => {
      if (!details.isProxy) {
        if (callback) callback({});
        return undefined;
      }

      const host = details.challenger.host;
      const port = details.challenger.port;

      if (isChallengeLooping(host, port, details.requestId)) {
        if (callback) callback({});
        return undefined;
      }

      if (
        details.tabId === -1 &&
        tempProxyAuth &&
        tempProxyAuth.host === normHost(host) &&
        tempProxyAuth.port === port
      ) {
        if (callback) callback({ authCredentials: tempProxyAuth.auth });
        return undefined;
      }

      const cached = credsCache?.get(`${normHost(host)}:${port}`);
      if (cached !== undefined || credsCache) {
        // Cache warm: hit or definitive miss, answer synchronously
        if (callback) callback(cached ? { authCredentials: cached } : {});
        return undefined;
       }

      // Cold-start race: settings not loaded yet, fall back to one async read
      getSettings()
        .then((settings) => {
          rebuildCache(settings);
          const creds = credsCache!.get(`${normHost(host)}:${port}`);
          if (creds && callback) {
            callback({ authCredentials: creds });
          } else if (callback) {
            callback({});
          }
        })
        .catch(() => {
          if (callback) callback({});
        });
      return undefined;
    },
    { urls: ['<all_urls>'] },
    ['asyncBlocking']
  );
}
