/**
 * NeoOmega Proxy Authentication Manager
 * Handles chrome.webRequest.onAuthRequired to automatically supply credentials for configured proxies
 */

import { getSettings } from '../storage/storage';
import type { FixedProfile, Profile } from '../types';

export interface AuthCredentials {
  username: string;
  password: string;
}

let tempProxyAuth: { host: string; port: number; auth: AuthCredentials } | null = null;

export function setTempProxyCredentials(host: string, port: number, auth?: { username?: string; password?: string }): void {
  if (auth?.username) {
    tempProxyAuth = { host, port, auth: { username: auth.username, password: auth.password || '' } };
  } else {
    tempProxyAuth = null;
  }
}

export function clearTempProxyCredentials(): void {
  tempProxyAuth = null;
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
          server &&
          server.host.toLowerCase() === host.toLowerCase() &&
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

  // Use asyncBlocking spec when webRequestAuthProvider is declared
  chrome.webRequest.onAuthRequired.addListener(
    (details, callback): chrome.webRequest.BlockingResponse | undefined => {
      if (!details.isProxy) {
        if (callback) callback({});
        return undefined;
      }

      const host = details.challenger.host;
      const port = details.challenger.port;

      if (
        tempProxyAuth &&
        tempProxyAuth.host.toLowerCase() === host.toLowerCase() &&
        tempProxyAuth.port === port
      ) {
        if (callback) callback({ authCredentials: tempProxyAuth.auth });
        return undefined;
      }

      getSettings()
        .then((settings) => {
          const creds = findProxyCredentials(host, port, settings.profiles);
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
