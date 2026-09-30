import { fetchAndParseRuleList } from '../src/core/parsers/autoproxy';
import { initAuthManager, setTempProxyCredentials, clearTempProxyCredentials } from '../src/core/proxy/auth-manager';
import { generateTestPacScript } from '../src/core/pac/generator';
import { ProxyManager } from '../src/core/proxy/proxy-manager';
import { getSettings, saveSettings, setActiveProfileId, adoptSyncSettings } from '../src/core/storage/storage';
import type { AppSettings, ProxyServer, SwitchProfile, TabNetworkError, TabRequestLog } from '../src/core/types';

export default defineBackground(() => {
  initAuthManager();
  // Store failed requests and traffic per tab ID
  const tabErrors = new Map<number, TabNetworkError[]>();
  const tabRequests = new Map<number, TabRequestLog[]>();

  const init = async () => {
    try {
      // Newer settings on another device? Adopt before applying proxy.
      const adopted = await adoptSyncSettings();
      if (adopted) console.log('[NeoOmega] Adopted settings from cloud sync');
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
    getSettings().then((s) => {
      chrome.alarms.create('neo_omega_update_rules', { periodInMinutes: Math.max(15, s.ruleListUpdateInterval ?? 120) });
    });
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === 'neo_omega_update_rules') {
        await updateAllRuleLists();
      }
    });
  }

  const updateSingleRuleList = async (profileId: string, ruleListOverride?: any) => {
    const settings = await getSettings();
    const profile = settings.profiles[profileId];
    if (!profile || profile.profileType !== 'SwitchProfile') {
      throw new Error('未找到指定的自动切换情景模式');
    }
    if (ruleListOverride) {
      profile.ruleList = { ...profile.ruleList, ...ruleListOverride };
    }
    const ruleList = profile.ruleList;
    if (!ruleList || !ruleList.url?.trim()) {
      throw new Error('情景模式未配置在线规则列表 URL');
    }
    const { text, rules } = await fetchAndParseRuleList(
      ruleList.url.trim(),
      ruleList.matchProfileId || 'proxy',
      ruleList.defaultProfileId || profile.defaultProfileId || 'direct'
    );
    ruleList.rulesCache = text.split(/\r?\n/);
    ruleList.lastUpdate = Date.now();
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

  let proxyTestRunning = false;

  const testProxyServer = async (
    proxy: ProxyServer,
    testUrl?: string,
    mode: 'latency' | 'bandwidth' = 'latency'
  ) => {
    if (typeof chrome === 'undefined' || !chrome.proxy?.settings) {
      throw new Error('Chrome proxy API not available');
    }
    if (proxyTestRunning) {
      throw new Error('已有代理测试进行中，请稍候 (Another proxy test is running)');
    }
    proxyTestRunning = true;

    const defaultUrl = mode === 'bandwidth'
      ? 'https://speed.cloudflare.com/__down?bytes=5000000'
      : 'http://cp.cloudflare.com/generate_204';
    const effectiveTestUrl = testUrl?.trim() || defaultUrl;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(effectiveTestUrl);
    } catch {
      throw new Error('无效的测试目标 URL');
    }

    const targetHost = parsedUrl.hostname;
    const settings = await getSettings();
    const activeProfile = settings.profiles[settings.activeProfileId];

    if (proxy.auth?.username) {
      setTempProxyCredentials(proxy.host, proxy.port, proxy.auth);
    }

    const testPac = generateTestPacScript(proxy, targetHost, activeProfile, settings.profiles);

    const { promise: setPromise, resolve: setResolve, reject: setReject } = Promise.withResolvers<void>();
    chrome.proxy.settings.set(
      {
        value: {
          mode: 'pac_script',
          pacScript: { data: testPac, mandatory: true },
        },
        scope: 'regular',
      },
      () => {
        if (chrome.runtime.lastError) {
          setReject(new Error(chrome.runtime.lastError.message));
        } else {
          setResolve();
        }
      }
    );
    await setPromise;

    const { promise: delayPromise, resolve: delayResolve } = Promise.withResolvers<void>();
    setTimeout(delayResolve, 60);
    await delayPromise;

    const urlWithBuster = new URL(effectiveTestUrl);
    urlWithBuster.searchParams.set('_t', Date.now().toString());

    const controller = new AbortController();
    const timeoutMs = mode === 'bandwidth' ? 18000 : 8000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startTime = performance.now();

    try {
      const res = await fetch(urlWithBuster.toString(), {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      let speedMBps: number | undefined;
      let speedMbps: number | undefined;
      let totalBytes: number | undefined;

      if (mode === 'bandwidth') {
        const reader = res.body?.getReader();
        let bytesCount = 0;
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) bytesCount += value.byteLength;
          }
        } else {
          const blob = await res.blob();
          bytesCount = blob.size;
        }
        totalBytes = bytesCount;
        const totalDurationSec = (performance.now() - startTime) / 1000;
        if (totalDurationSec > 0 && bytesCount > 0) {
          const bytesPerSec = bytesCount / totalDurationSec;
          speedMBps = Number((bytesPerSec / (1024 * 1024)).toFixed(2));
          speedMbps = Number(((bytesPerSec * 8) / 1000000).toFixed(2));
        }
      }

      const latency = Math.round(performance.now() - startTime);
      const durationSec = Number(((performance.now() - startTime) / 1000).toFixed(2));
      return {
        success: true,
        latency,
        speedMBps,
        speedMbps,
        totalBytes,
        durationSec,
        mode,
        status: res.status,
        statusText: res.statusText,
        testUrl: effectiveTestUrl,
      };
    } catch (err: unknown) {
      const latency = Math.round(performance.now() - startTime);
      let errMsg = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && err.name === 'AbortError') {
        errMsg = '连接超时 (Timeout)';
      }
      return {
        success: false,
        latency,
        mode,
        error: errMsg,
        testUrl: effectiveTestUrl,
      };
    } finally {
      clearTimeout(timeoutId);
      proxyTestRunning = false;
      ProxyManager.invalidateCache(); // test wrote proxy settings directly; force re-apply
      try {
        // Re-read settings: user may have switched profiles while the test ran.
        // Restoring the stale snapshot would clobber the new active profile.
        const fresh = await getSettings();
        const current = fresh.profiles[fresh.activeProfileId];
        if (current) {
          await ProxyManager.applyProfile(current, fresh.profiles);
        } else {
          const { promise: clearPromise, resolve: clearResolve } = Promise.withResolvers<void>();
          chrome.proxy.settings.clear({ scope: 'regular' }, () => clearResolve());
          await clearPromise;
        }
      } catch (cleanupErr) {
        console.error('[NeoOmega] Failed to restore proxy after test:', cleanupErr);
      }
    }
  };
  // Track network requests and errors for Side Panel & quick rule adding.
  // Listeners registered on demand only: error tracking while
  // enableErrorMonitoring is set (Popup), request log while Side Panel is open.
  let errorTrackingOn = false;
  let requestLogOn = false;

  const onCompletedListener = (details: chrome.webRequest.OnCompletedDetails) => {
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
      broadcastTab(details.tabId);
    } catch {
      // ignore invalid URLs
    }
  };

  const onErrorListener = (details: chrome.webRequest.OnErrorOccurredDetails) => {
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
      broadcastTab(details.tabId);
    } catch {
      // ignore invalid URLs
    }
  };

  // Side Panel push channel: one long-lived port per open panel. Port open =
  // monitoring on; disconnect (panel close or SW restart) = off. The panel
  // reconnects after SW restart, replacing the old 2s heartbeat poll.
  const portTab = new Map<chrome.runtime.Port, number>();
  const pushTabData = (port: chrome.runtime.Port, tabId: number) => {
    try {
      port.postMessage({
        type: 'TAB_DATA',
        requests: tabRequests.get(tabId) || [],
        errors: tabErrors.get(tabId) || [],
      });
    } catch {
      // port already dying
    }
  };
  const broadcastTab = (tabId: number) => {
    for (const [port, id] of portTab) {
      if (id === tabId) pushTabData(port, tabId);
    }
  };

  const syncWebRequestListeners = () => {
    if (!chrome.webRequest?.onCompleted) return;
    const hasCompleted = chrome.webRequest.onCompleted.hasListener(onCompletedListener);
    if (requestLogOn && !hasCompleted) {
      chrome.webRequest.onCompleted.addListener(onCompletedListener, { urls: ['<all_urls>'] });
    } else if (!requestLogOn && hasCompleted) {
      chrome.webRequest.onCompleted.removeListener(onCompletedListener);
    }
    const wantError = requestLogOn || errorTrackingOn;
    const hasError = chrome.webRequest.onErrorOccurred.hasListener(onErrorListener);
    if (wantError && !hasError) {
      chrome.webRequest.onErrorOccurred.addListener(onErrorListener, { urls: ['<all_urls>'] });
    } else if (!wantError && hasError) {
      chrome.webRequest.onErrorOccurred.removeListener(onErrorListener);
    }
  };

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'sidepanel') return;
    portTab.set(port, 0);
    requestLogOn = true;
    syncWebRequestListeners();
    port.onMessage.addListener((msg: { type?: string; tabId?: number }) => {
      if (msg?.type !== 'SUBSCRIBE_TAB' || typeof msg.tabId !== 'number') return;
      portTab.set(port, msg.tabId);
      pushTabData(port, msg.tabId);
    });
    port.onDisconnect.addListener(() => {
      portTab.delete(port);
      if (portTab.size === 0) {
        requestLogOn = false;
        tabRequests.clear();
        syncWebRequestListeners();
      }
    });
  });

  getSettings()
    .then((s) => {
      errorTrackingOn = !!s.enableErrorMonitoring;
      syncWebRequestListeners();
    })
    .catch(() => {});
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes['neo_omega_settings'];
    if (!change) return;
    errorTrackingOn = !!(change.newValue as AppSettings | undefined)?.enableErrorMonitoring;
    const oldIv = (change.oldValue as AppSettings | undefined)?.ruleListUpdateInterval ?? 120;
    const newIv = (change.newValue as AppSettings | undefined)?.ruleListUpdateInterval ?? 120;
    if (chrome.alarms && oldIv !== newIv) {
      chrome.alarms.create('neo_omega_update_rules', { periodInMinutes: Math.max(15, newIv) });
    }
    syncWebRequestListeners();
  });

  // Cloud sync: remote settings changed on another device → adopt if newer
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'sync' || !changes['neo_omega_sync_meta']) return;
    adoptSyncSettings()
      .then(async (adopted) => {
        if (adopted) await ProxyManager.applyCurrentActive();
      })
      .catch((err) => console.warn('[NeoOmega] sync adopt failed:', err));
  });

  // Clean up tab error and request cache on tab close
  chrome.tabs?.onRemoved.addListener((tabId) => {
    tabErrors.delete(tabId);
    tabRequests.delete(tabId);
  });
  // Handle messages from Popup and Options
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'GET_TAB_ERRORS') {
      const errors = tabErrors.get(message.tabId) || [];
      sendResponse({ errors });
      return false;
    }


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
          const count = await updateSingleRuleList(message.profileId, message.ruleList);
          sendResponse({ success: true, count });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sendResponse({ success: false, error: msg });
        }
      })();
      return true;
    }

    if (message.type === 'TEST_PROXY') {
      testProxyServer(message.proxy, message.testUrl, message.mode || 'latency')
        .then((result) => {
          sendResponse(result);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          sendResponse({ success: false, error: msg });
        });
      return true;
    }

    return false;
  });
});
