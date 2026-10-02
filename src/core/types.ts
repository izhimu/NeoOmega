/**
 * NeoOmega Core Type Definitions
 * Clean, modern Manifest V3 proxy data models
 */

export type ProxyScheme = 'http' | 'https' | 'socks4' | 'socks5' | 'direct';

export interface ProxyServer {
  scheme: ProxyScheme;
  host: string;
  port: number;
  auth?: {
    username?: string;
    password?: string;
  };
}

export type ConditionType =
  | 'HostWildcardCondition'
  | 'HostRegexCondition'
  | 'UrlWildcardCondition'
  | 'UrlRegexCondition'
  | 'KeywordCondition'
  | 'IpCondition'
  | 'BypassCondition'
  | 'TrueCondition'
  | 'FalseCondition';

export interface RuleCondition {
  id?: string;
  conditionType: ConditionType;
  pattern: string;
}

export interface SwitchRule {
  id: string;
  condition: RuleCondition;
  profileId: string; // target profile id
  enabled: boolean;
  note?: string;
}

export interface RuleListConfig {
  id: string;
  url: string;
  format: 'autoproxy' | 'switchy';
  matchProfileId: string;
  defaultProfileId?: string;
  lastUpdate?: number;
  updateIntervalMinutes?: number;
  enabled: boolean;
  rulesCache?: string[]; // cached parsed rules
}

export type ProfileType =
  | 'DirectProfile'
  | 'SystemProfile'
  | 'FixedProfile'
  | 'PacProfile'
  | 'SwitchProfile'
  | 'VirtualProfile';

export interface BaseProfile {
  id: string;
  name: string;
  profileType: ProfileType;
  color?: string;
  revision?: string;
}

export interface DirectProfile extends BaseProfile {
  profileType: 'DirectProfile';
}

export interface SystemProfile extends BaseProfile {
  profileType: 'SystemProfile';
}

export interface FixedProfile extends BaseProfile {
  profileType: 'FixedProfile';
  // Specific protocol proxies
  proxyForHttp?: ProxyServer;
  proxyForHttps?: ProxyServer;
  proxyForFtp?: ProxyServer;
  // Fallback / Single proxy
  fallbackProxy?: ProxyServer;
  // Additional failover proxies, tried in order after primary (PAC ';' chain)
  fallbackServers?: ProxyServer[];
  // Bypass conditions (e.g. <local>, 127.0.0.1, *.lan)
  bypassList: RuleCondition[];
}

export interface PacProfile extends BaseProfile {
  profileType: 'PacProfile';
  pacUrl?: string;
  pacScript?: string;
}

export interface SwitchProfile extends BaseProfile {
  profileType: 'SwitchProfile';
  rules: SwitchRule[];
  defaultProfileId: string;
  ruleList?: RuleListConfig;
}

export interface VirtualProfile extends BaseProfile {
  profileType: 'VirtualProfile';
  targetProfileId: string;
}

export type Profile =
  | DirectProfile
  | SystemProfile
  | FixedProfile
  | PacProfile
  | SwitchProfile
  | VirtualProfile;

export type WebRtcMode = 'default' | 'default_public_interface_only' | 'disable_non_proxied_udp';

export interface AppSettings {
  activeProfileId: string;
  profiles: Record<string, Profile>;
  order: string[]; // profile order in UI
  theme: 'auto' | 'light' | 'dark';
  language?: 'auto' | 'zh_CN' | 'en';
  enableErrorMonitoring: boolean;
  ruleListUpdateInterval?: number; // minutes, default 120
  enableCloudSync?: boolean; // mirror profiles into chrome.storage.sync
  webRtcMode?: WebRtcMode; // chrome.privacy IP handling policy, default 'default'
  disableNetworkPrediction?: boolean; // kill DNS prefetch/prerender (local-resolve leaks)
  settingsUpdatedAt?: number; // ms epoch, last-write-wins for sync
  syncConfig?: {
    type: 'none' | 'webdav' | 'gist';
    url?: string;
    token?: string;
    username?: string;
    password?: string;
    autoSync: boolean;
  };
}

export interface TabNetworkError {
  url: string;
  host: string;
  error: string;
  timestamp: number;
}

export interface TabRequestLog {
  id: string;
  url: string;
  host: string;
  method: string;
  type: string;
  statusCode?: number;
  error?: string;
  timestamp: number;
}
