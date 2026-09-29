import { fetchAndParseRuleList } from '../src/core/parsers/autoproxy';
import { initAuthManager } from '../src/core/proxy/auth-manager';
import { ProxyManager } from '../src/core/proxy/proxy-manager';
import { getSettings, saveSettings, setActiveProfileId } from '../src/core/storage/storage';
import type { SwitchProfile, TabNetworkError, TabRequestLog } from '../src/core/types';

export default defineBackground(() => {
  initAuthManager();
  // Store failed requests and traffic per tab ID
  const tabErrors = new Map<number, TabNetworkError[]>();
  const tabRequests = new Map<number, TabRequestLog[]>();

  const init = async () => {
    try {
      await ProxyManager.applyCurrentActive();
    } catch (err) {
      console.error('[NeoOmega] Failed to apply proxy on startup:', err);
    }
  };

  chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('[NeoOmega] Extension installed/updated:', details.reason);
    await init();
  });

  chrome.runtime.onStartup.addListener(async () => {
    console.log('[NeoOmega] Browser startup detected');
    await init();
  });

  // Setup periodic rule list update alarm (every 2 hours)
  if (chrome.alarms) {
    chrome.alarms.create('neo_omega_update_rules', { periodInMinutes: 120 });
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === 'neo_omega_update_rules') {
        await updateAllRuleLists();
      }
    });
  }

  const updateSingleRuleList = async (profileId: string) => {
    const settings = await getSettings();
    const profile = settings.profiles[profileId];
    if (!profile || profile.profileType !== 'SwitchProfile' || !profile.ruleList?.url) {
      throw new Error('Profile does not have a configured rule list URL');
    }
    const { text, rules } = await fetchAndParseRuleList(
      profile.ruleList.url,
      profile.ruleList.matchProfileId,
      profile.ruleList.defaultProfileId || profile.defaultProfileId
    );
    profile.ruleList.rulesCache = text.split(/\r?\n/);
    profile.ruleList.lastUpdate = Date.now();
    await saveSettings(settings);
    if (settings.activeProfileId === profileId) {
      await ProxyManager.applyProfile(profile, settings.profiles);
    }
    return rules.length;
  };

  const updateAllRuleLists = async () => {
    const settings = await getSettings();
    let changed = false;
    for (const profile of Object.values(settings.profiles)) {
      if (profile.profileType === 'SwitchProfile' && profile.ruleList?.enabled && profile.ruleList.url) {
        try {
          const { text } = await fetchAndParseRuleList(
            profile.ruleList.url,
            profile.ruleList.matchProfileId,
            profile.ruleList.defaultProfileId || profile.defaultProfileId
          );
          profile.ruleList.rulesCache = text.split(/\r?\n/);
          profile.ruleList.lastUpdate = Date.now();
          changed = true;
        } catch (err) {
          console.error(`[NeoOmega] Failed to update rule list for ${profile.name}:`, err);
        }
      }
    }
    if (changed) {
      await saveSettings(settings);
      const active = settings.profiles[settings.activeProfileId];
      if (active) {
        await ProxyManager.applyProfile(active, settings.profiles);
      }
    }
  };
  // Track network requests and errors for Side Panel & quick rule adding
  if (chrome.webRequest?.onCompleted) {
    chrome.webRequest.onCompleted.addListener(
      (details) => {
        if (details.tabId <= 0) return;
        try {
          const urlObj = new URL(details.url);
          const reqs = tabRequests.get(details.tabId) || [];
          reqs.unshift({
            id: details.requestId,
            url: details.url,
            host: urlObj.hostname,
            method: details.method,
            type: details.type,
            statusCode: details.statusCode,
            timestamp: Date.now(),
          });
          if (reqs.length > 80) reqs.length = 80;
          tabRequests.set(details.tabId, reqs);
        } catch {
          // ignore invalid URLs
        }
      },
      { urls: ['<all_urls>'] }
    );
  }

  if (chrome.webRequest?.onErrorOccurred) {
    chrome.webRequest.onErrorOccurred.addListener(
      (details) => {
        if (details.tabId <= 0 || details.error === 'net::ERR_ABORTED') {
          return;
        }

        try {
          const urlObj = new URL(details.url);
          const errors = tabErrors.get(details.tabId) || [];
          if (!errors.some((e) => e.host === urlObj.hostname)) {
            errors.push({
              url: details.url,
              host: urlObj.hostname,
              error: details.error,
              timestamp: Date.now(),
            });
            tabErrors.set(details.tabId, errors);
          }

          const reqs = tabRequests.get(details.tabId) || [];
          reqs.unshift({
            id: details.requestId,
            url: details.url,
            host: urlObj.hostname,
            method: details.method,
            type: details.type,
            error: details.error,
            timestamp: Date.now(),
          });
          if (reqs.length > 80) reqs.length = 80;
          tabRequests.set(details.tabId, reqs);
        } catch {
          // ignore invalid URLs
        }
      },
      { urls: ['<all_urls>'] }
    );
  }

  // Clean up tab error and request cache on tab close
  chrome.tabs?.onRemoved.addListener((tabId) => {
    tabErrors.delete(tabId);
    tabRequests.delete(tabId);
  });
  // Handle messages from Popup and Options
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'SWITCH_PROFILE') {
      (async () => {
        try {
          const settings = await setActiveProfileId(message.profileId);
          const profile = settings.profiles[message.profileId];
          if (profile) {
            await ProxyManager.applyProfile(profile, settings.profiles);
          }
          sendResponse({ success: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sendResponse({ success: false, error: msg });
        }
      })();
      return true;
    }

    if (message.type === 'GET_TAB_ERRORS') {
      const errors = tabErrors.get(message.tabId) || [];
      sendResponse({ errors });
      return false;
    }

    if (message.type === 'GET_TAB_REQUESTS') {
      const requests = tabRequests.get(message.tabId) || [];
      sendResponse({ requests });
      return false;
    }
    if (message.type === 'ADD_HOST_RULE') {
      (async () => {
        try {
          const { pattern, profileId } = message;
          const settings = await getSettings();
          const active = settings.profiles[settings.activeProfileId];

          if (!active || active.profileType !== 'SwitchProfile') {
            sendResponse({ success: false, error: '当前情景模式不是自动切换模式 (Current profile is not an Auto Switch profile)' });
            return;
          }

          const switchProfile = active as SwitchProfile;
          // Add rule to top
          switchProfile.rules.unshift({
            id: `r_user_${Date.now()}`,
            enabled: true,
            condition: {
              conditionType: 'HostWildcardCondition',
              pattern: `*.${pattern}`,
            },
            profileId: profileId || 'proxy',
            note: 'Added from popup error monitor',
          });

          await saveSettings(settings);
          await ProxyManager.applyProfile(switchProfile, settings.profiles);
          sendResponse({ success: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sendResponse({ success: false, error: msg });
        }
      })();
      return true;
    }

    if (message.type === 'UPDATE_RULE_LIST') {
      (async () => {
        try {
          const count = await updateSingleRuleList(message.profileId);
          sendResponse({ success: true, count });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sendResponse({ success: false, error: msg });
        }
      })();
      return true;
    }
  });
});
