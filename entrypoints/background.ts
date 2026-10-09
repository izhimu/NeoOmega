import { fetchAndParseRuleList } from '../src/core/parsers/autoproxy';
import { initAuthManager, setTempProxyCredentials, clearTempProxyCredentials } from '../src/core/proxy/auth-manager';
import { generateTestPacScript, generateProbePacScript, formatFixedChain } from '../src/core/pac/generator';
import { matchSwitchProfile } from '../src/core/pac/matcher';
import { ProxyManager } from '../src/core/proxy/proxy-manager';
import { getSettings, saveSettings, setActiveProfileId, adoptSyncSettings } from '../src/core/storage/storage';
import type { AppSettings, FixedProfile, Profile, ProxyAuth, ProxyServer, RuleListConfig, SwitchProfile, SwitchRule, TabNetworkError, TabRequestLog } from '../src/core/types';

type TimeoutHandle = ReturnType<typeof setTimeout>;

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
    if (details.reason === 'install') {
      chrome.runtime.openOptionsPage();
    }
  });

  chrome.runtime.onStartup.addListener(async () => {
    console.log('[NeoOmega] Browser startup detected');
    await init();
  });

  // Setup periodic rule list update alarm (every 2 hours)
  if (chrome.alarms) {
    getSettings().then((s) => {
      const period = Math.max(15, s.ruleListUpdateInterval ?? 120);
      // create() with an existing name resets the schedule; SW cold-starts are
      // frequent (webRequest wakes), which would postpone the alarm forever.
      chrome.alarms.get('neo_omega_update_rules', (existing) => {
        if (!existing || existing.periodInMinutes !== period) {
          chrome.alarms.create('neo_omega_update_rules', { periodInMinutes: period });
        }
      });
    });
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === 'neo_omega_update_rules') {
        await updateAllRuleLists();
      }
    });
  }

  const updateSingleRuleList = async (profileId: string, ruleListOverride?: Partial<RuleListConfig>) => {
    const settings = await getSettings();
    const profile = settings.profiles[profileId];
    if (!profile || profile.profileType !== 'SwitchProfile') {
      throw new Error('未找到指定的自动切换情景模式');
    }
    const ruleList = ruleListOverride
      ? { ...profile.ruleList, ...ruleListOverride }
      : profile.ruleList;
    if (!ruleList || !ruleList.url?.trim()) {
      throw new Error('情景模式未配置在线规则列表 URL');
    }
    const { text, rules } = await fetchRuleListWithFallback(
      ruleList.url.trim(),
      ruleList.matchProfileId || 'proxy',
      ruleList.defaultProfileId || profile.defaultProfileId || 'direct',
      settings
    );
    const freshSettings = await getSettings();
    const freshProfile = freshSettings.profiles[profileId];
    if (freshProfile && freshProfile.profileType === 'SwitchProfile' && freshProfile.ruleList) {
      if (ruleListOverride) Object.assign(freshProfile.ruleList, ruleListOverride);
      freshProfile.ruleList.rulesCache = text.split(/\r?\n/);
      freshProfile.ruleList.lastUpdate = Date.now();
      if (freshSettings.activeProfileId === profileId) {
        await ProxyManager.applyProfile(freshProfile, freshSettings.profiles);
      }
      await saveSettings(freshSettings);
    }
    return rules.length;
  };

  const updateAllRuleLists = async () => {
    const settings = await getSettings();
    const updates: Array<{ profileId: string; rulesCache: string[]; lastUpdate: number }> = [];
    for (const profile of Object.values(settings.profiles)) {
      if (profile.profileType === 'SwitchProfile' && profile.ruleList?.enabled && profile.ruleList.url) {
        try {
          const { text } = await fetchRuleListWithFallback(
            profile.ruleList.url,
            profile.ruleList.matchProfileId,
            profile.ruleList.defaultProfileId || profile.defaultProfileId,
            settings
          );
          updates.push({
            profileId: profile.id,
            rulesCache: text.split(/\r?\n/),
            lastUpdate: Date.now(),
          });
        } catch (err) {
          console.error(`[NeoOmega] Failed to update rule list for ${profile.name}:`, err);
        }
      }
    }
    if (updates.length > 0) {
      const freshSettings = await getSettings();
      let changed = false;
      for (const update of updates) {
        const target = freshSettings.profiles[update.profileId];
        if (target && target.profileType === 'SwitchProfile' && target.ruleList) {
          target.ruleList.rulesCache = update.rulesCache;
          target.ruleList.lastUpdate = update.lastUpdate;
          changed = true;
        }
      }
      if (changed) {
        await saveSettings(freshSettings);
        const active = freshSettings.profiles[freshSettings.activeProfileId];
        if (active) {
          await ProxyManager.applyProfile(active, freshSettings.profiles);
        }
      }
    }
  };

  let ruleListFallbackRunning = false;

  // Direct fetch fails (e.g. GFWList unreachable without proxy): retry once,
  // then silently route ONLY the rule-list host through the first configured
  // Fixed proxy via a temporary PAC. Active profile is never switched.
  const fetchRuleListWithFallback = async (
    url: string,
    matchProfileId: string,
    defaultProfileId: string,
    settings: AppSettings
  ): Promise<{ text: string; rules: SwitchRule[] }> => {
    try {
      return await fetchAndParseRuleList(url, matchProfileId, defaultProfileId);
    } catch (directErr) {
      try {
        return await fetchAndParseRuleList(url, matchProfileId, defaultProfileId);
      } catch { /* fall through to proxy fallback */ }

      let proxy: ProxyServer | null = null;
      for (const id of settings.order) {
        const p = settings.profiles[id];
        if (p?.profileType === 'FixedProfile') {
          const server = p.fallbackProxy || p.proxyForHttps || p.proxyForHttp || p.proxyForFtp;
          if (server?.host) { proxy = server; break; }
        }
      }
      if (
        !proxy ||
        typeof chrome === 'undefined' ||
        !chrome.proxy?.settings ||
        userTestRunning ||
        ruleListFallbackRunning
      ) {
        throw directErr;
      }

      ruleListFallbackRunning = true;
      try {
        if (proxy.auth?.username) {
          setTempProxyCredentials(proxy.host, proxy.port, proxy.auth);
        }
        const targetHost = new URL(url).hostname;
        const activeProfile = settings.profiles[settings.activeProfileId];
        const pac = generateTestPacScript(proxy, targetHost, activeProfile, settings.profiles);

        const { promise: setPromise, resolve: setResolve, reject: setReject } = Promise.withResolvers<void>();
        chrome.proxy.settings.set(
          { value: { mode: 'pac_script', pacScript: { data: pac, mandatory: true } }, scope: 'regular' },
          () => (chrome.runtime.lastError ? setReject(new Error(chrome.runtime.lastError.message)) : setResolve())
        );
        await setPromise;
        const { promise: delayPromise, resolve: delayResolve } = Promise.withResolvers<void>();
        setTimeout(delayResolve, 60);
        await delayPromise;

        try {
          return await fetchAndParseRuleList(url, matchProfileId, defaultProfileId);
        } catch {
          throw directErr;
        }
      } finally {
        ruleListFallbackRunning = false;
        clearTempProxyCredentials();
        ProxyManager.invalidateCache(); // temp PAC wrote proxy settings directly; force re-apply
        try {
          // Re-read settings: user may have switched profiles during the fetch.
          const fresh = await getSettings();
          const current = fresh.profiles[fresh.activeProfileId];
          if (current) {
            await ProxyManager.applyProfile(current, fresh.profiles);
          }
        } catch (restoreErr) {
          console.error('[NeoOmega] Failed to restore proxy after rule-list fallback:', restoreErr);
        }
      }
    }
  };

  let userTestQueue = Promise.resolve<any>();
  let userTestRunning = false;
  let speedProbeRunning = false;
  let speedProbeAbort: AbortController | null = null;

  const executeProxyTest = async (
    proxy: ProxyServer,
    testUrl?: string,
    mode: 'latency' | 'bandwidth' = 'latency'
  ) => {
    if (typeof chrome === 'undefined' || !chrome.proxy?.settings) {
      throw new Error('Chrome proxy API not available');
    }
    const defaultUrl = mode === 'bandwidth'
      ? 'https://speed.cloudflare.com/__down?bytes=5000000'
      : 'http://cp.cloudflare.com/generate_204';
    const effectiveTestUrl = testUrl?.trim() || defaultUrl;

    let timeoutId: TimeoutHandle | undefined;
    const startTime = performance.now();

    try {
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
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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
      if (timeoutId) clearTimeout(timeoutId);
      // proxy restored below
      clearTempProxyCredentials();
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

  const testProxyServer = async (
    proxy: ProxyServer,
    testUrl?: string,
    mode: 'latency' | 'bandwidth' = 'latency'
  ) => {
    // Abort active background speed probe immediately to prioritize user test
    if (speedProbeRunning && speedProbeAbort) {
      speedProbeAbort.abort();
      for (let i = 0; i < 6 && speedProbeRunning; i++) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 50);
        await promise;
      }
    }

    const run = async () => {
      userTestRunning = true;
      try {
        return await executeProxyTest(proxy, testUrl, mode);
      } finally {
        userTestRunning = false;
      }
    };

    const next = userTestQueue.then(run, run);
    userTestQueue = next.catch(() => {});
    return await next;
  };
  // Track network requests and errors for Side Panel & quick rule adding.
  // Listeners registered on demand only: error tracking while
  // enableErrorMonitoring is set (Popup), request log while Side Panel is open.
  // MV3 cold-start wake requires sync registration; default true until settings load.
  let errorTrackingOn = true;
  let failureNotificationOn = true;
  let speedRecommendationOn = true;
  let requestLogOn = false;
  const analyzedHostsCache = new Map<string, number>();

  const probeCandidate = async (
    candidate: { id: string; name: string; directive: string; auth?: ProxyAuth },
    host: string,
    activeProfile?: Profile,
    allProfiles: Record<string, Profile> = {}
  ): Promise<number | null> => {
    if (typeof chrome === 'undefined' || !chrome.proxy?.settings || speedProbeAbort?.signal.aborted) return null;
    if (candidate.auth?.username) {
      const rawTarget = candidate.directive.replace(/^[A-Z0-9]+\s+/, '').split(';')[0].trim();
      const [h, p] = rawTarget.split(':');
      if (h && p) setTempProxyCredentials(h, parseInt(p, 10), candidate.auth);
    }
    const probePac = generateProbePacScript(candidate.directive, host, activeProfile, allProfiles);
    const { promise: setPromise, resolve: setResolve, reject: setReject } = Promise.withResolvers<void>();
    chrome.proxy.settings.set(
      {
        value: { mode: 'pac_script', pacScript: { data: probePac, mandatory: true } },
        scope: 'regular',
      },
      () => {
        if (chrome.runtime.lastError) setReject(new Error(chrome.runtime.lastError.message));
        else setResolve();
      }
    );
    try {
      await setPromise;
    } catch {
      return null;
    }
    const { promise: delayPromise, resolve: delayResolve } = Promise.withResolvers<void>();
    setTimeout(delayResolve, 50);
    await delayPromise;
    if (speedProbeAbort?.signal.aborted) return null;

    const start = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const probeSignal = speedProbeAbort
      ? AbortSignal.any([controller.signal, speedProbeAbort.signal])
      : controller.signal;
    try {
      const res = await fetch(`https://${host}/`, {
        method: 'GET',
        signal: probeSignal,
        cache: 'no-store',
      });
      clearTimeout(timer);
      try { await res.body?.cancel(); } catch {}
      return Math.round(performance.now() - start);
    } catch {
      clearTimeout(timer);
      if (speedProbeAbort?.signal.aborted) return null;
      try {
        const httpCtrl = new AbortController();
        const httpTimer = setTimeout(() => httpCtrl.abort(), 1000);
        const httpSignal = speedProbeAbort
          ? AbortSignal.any([httpCtrl.signal, speedProbeAbort.signal])
          : httpCtrl.signal;
        const httpRes = await fetch(`http://${host}/`, {
          method: 'GET',
          signal: httpSignal,
          cache: 'no-store',
        });
        clearTimeout(httpTimer);
        try { await httpRes.body?.cancel(); } catch {}
        return Math.round(performance.now() - start);
      } catch {
        return null;
      }
    }
  };

  const analyzeSlowHosts = async (
    hosts: Array<{ host: string; duration: number }>,
    tabId?: number
  ) => {
    if (!speedRecommendationOn || userTestRunning || speedProbeRunning || ruleListFallbackRunning || !hosts.length || !tabId) return;
    const settings = await getSettings();
    const activeProfile = settings.profiles[settings.activeProfileId];
    if (!activeProfile || activeProfile.profileType !== 'SwitchProfile') return;

    const fixedCandidates = Object.values(settings.profiles).filter(
      (p): p is FixedProfile =>
        p.profileType === 'FixedProfile' &&
        !!(p.fallbackProxy?.host || p.proxyForHttps?.host || p.proxyForHttp?.host)
    );
    if (fixedCandidates.length === 0) return;
    const now = Date.now();
    const target = hosts.find((h) => now - (analyzedHostsCache.get(h.host) || 0) > 600000);
    if (!target) return;
    analyzedHostsCache.set(target.host, now);

    const currentProfileId = matchSwitchProfile(activeProfile as SwitchProfile, `https://${target.host}/`, target.host);

    const candidates: Array<{ id: string; name: string; directive: string; auth?: ProxyAuth }> = [
      { id: 'direct', name: '直连', directive: 'DIRECT' },
      ...fixedCandidates.slice(0, 3).map((p) => ({
        id: p.id,
        name: p.name,
        directive: formatFixedChain(p),
        auth: p.fallbackProxy?.auth,
      })),
    ];

    speedProbeRunning = true;
    speedProbeAbort = new AbortController();
    const probeResults: Array<{ id: string; name: string; latency: number | null }> = [];
    try {
      for (const cand of candidates) {
        if (speedProbeAbort.signal.aborted || userTestRunning) break;
        const lat = await probeCandidate(cand, target.host, activeProfile, settings.profiles);
        probeResults.push({ id: cand.id, name: cand.name, latency: lat });
      }
    } finally {
      speedProbeRunning = false;
      speedProbeAbort = null;
      clearTempProxyCredentials();
      ProxyManager.invalidateCache();
      try {
        const fresh = await getSettings();
        const curr = fresh.profiles[fresh.activeProfileId];
        if (curr) await ProxyManager.applyProfile(curr, fresh.profiles);
      } catch (err) {
        console.warn('[NeoOmega] Restore proxy after speed probe failed:', err);
      }
    }

    const valid = probeResults.filter((r): r is { id: string; name: string; latency: number } => typeof r.latency === 'number' && r.latency > 0);
    if (valid.length === 0) return;
    valid.sort((a, b) => a.latency - b.latency);
    const best = valid[0];

    if (best.id !== currentProfileId) {
      const currentResult = valid.find((r) => r.id === currentProfileId);
      const currentLatency = currentResult ? currentResult.latency : target.duration;
      if (currentLatency - best.latency >= 300 && currentLatency >= best.latency * 1.3) {
        const curProfileObj = settings.profiles[currentProfileId];
        const curName = curProfileObj ? curProfileObj.name : (currentProfileId === 'direct' ? '直连' : currentProfileId);
        chrome.tabs.sendMessage(
          tabId,
          {
            type: 'SPEED_RECOMMENDATION',
            recommendation: {
              host: target.host,
              currentProfileId,
              currentProfileName: curName,
              recommendedProfileId: best.id,
              recommendedProfileName: best.name,
              currentLatency,
              recommendedLatency: best.latency,
            },
          },
          () => void chrome.runtime.lastError
        );
      }
    }
  };

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


  const notifyTabOfError = (tabId: number, host: string, count: number) => {
    if (tabId <= 0 || !errorTrackingOn || !failureNotificationOn || typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) return;
    chrome.tabs.sendMessage(
      tabId,
      {
        type: 'TAB_FAILED_RESOURCES',
        host,
        count,
      },
      () => void chrome.runtime.lastError
    );
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
        if (errors.length > 50) errors.shift();
        tabErrors.set(details.tabId, errors);
        notifyTabOfError(details.tabId, urlObj.hostname, errors.length);
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
  const broadcastTimers = new Map<number, TimeoutHandle>();
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
    clearTimeout(broadcastTimers.get(tabId));
    broadcastTimers.set(
      tabId,
      setTimeout(() => {
        broadcastTimers.delete(tabId);
        for (const [port, id] of portTab) {
          if (id === tabId) pushTabData(port, tabId);
        }
      }, 100)
    );
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
        for (const timer of broadcastTimers.values()) clearTimeout(timer);
        broadcastTimers.clear();
        syncWebRequestListeners();
      }
    });
  });

  // WebRTC IP handling: proxy PAC never covers WebRTC UDP, so this policy
  // is the only lever against real-IP leaks (STUN host/srflx candidates).
  const applyWebRtcPolicy = (mode: AppSettings['webRtcMode']) => {
    chrome.privacy?.network?.webRTCIPHandlingPolicy
      ?.set({ value: mode ?? 'default' })
      ?.catch(() => {});
  };
  // DNS prefetch/prerender resolve hostnames locally, bypassing the proxy's remote DNS
  const applyNetworkPrediction = (disabled: boolean | undefined) => {
    chrome.privacy?.network?.networkPredictionEnabled
      ?.set({ value: !disabled })
      ?.catch(() => {});
  };
  // MV3 cold-start wake: register listeners synchronously before async getSettings
  syncWebRequestListeners();
  getSettings()
    .then((s) => {
      errorTrackingOn = !!s.enableErrorMonitoring;
      failureNotificationOn = s.enableFailureNotification ?? true;
      speedRecommendationOn = s.enableSpeedRecommendation ?? true;
      applyWebRtcPolicy(s.webRtcMode);
      applyNetworkPrediction(s.disableNetworkPrediction);
      syncWebRequestListeners();
    })
    .catch(() => {});
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes['neo_omega_settings'];
    if (!change) return;
    const oldMonitoring = errorTrackingOn;
    errorTrackingOn = !!(change.newValue as AppSettings | undefined)?.enableErrorMonitoring;
    failureNotificationOn = (change.newValue as AppSettings | undefined)?.enableFailureNotification ?? true;
    speedRecommendationOn = (change.newValue as AppSettings | undefined)?.enableSpeedRecommendation ?? true;
    const oldRtc = (change.oldValue as AppSettings | undefined)?.webRtcMode ?? 'default';
    const newRtc = (change.newValue as AppSettings | undefined)?.webRtcMode ?? 'default';
    if (oldRtc !== newRtc) applyWebRtcPolicy(newRtc);
    const oldNp = !!(change.oldValue as AppSettings | undefined)?.disableNetworkPrediction;
    const newNp = !!(change.newValue as AppSettings | undefined)?.disableNetworkPrediction;
    if (oldNp !== newNp) applyNetworkPrediction(newNp);
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

  // Clean up tab error and request cache on tab close or URL navigation
  chrome.tabs?.onRemoved.addListener((tabId) => {
    tabErrors.delete(tabId);
    tabRequests.delete(tabId);
  });
  chrome.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
      tabErrors.delete(tabId);
    }
  });
  // Handle messages from Popup and Options
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    if (message.type === 'GET_TAB_ERRORS') {
      const errors = tabErrors.get(message.tabId) || [];
      sendResponse({ errors });
      return false;
    }
    if (message.type === 'GET_MY_ERRORS') {
      if (!failureNotificationOn) {
        sendResponse({ errors: [] });
        return false;
      }
      const tabId = _sender.tab?.id || message.tabId;
      const errors = tabId ? tabErrors.get(tabId) || [] : [];
      sendResponse({ errors });
      return false;
    }
    if (message.type === 'CLEAR_TAB_LOGS') {
      tabErrors.delete(message.tabId);
      tabRequests.delete(message.tabId);
      broadcastTab(message.tabId);
      sendResponse({ success: true });
      return false;
    }
    if (message.type === 'APPLY_SPEED_RECOMMENDATION') {
      (async () => {
        try {
          const { host, profileId } = message;
          const settings = await getSettings();
          const active = settings.profiles[settings.activeProfileId];
          let targetSwitchProfile: SwitchProfile | undefined;

          if (active && active.profileType === 'SwitchProfile') {
            targetSwitchProfile = active as SwitchProfile;
          } else {
            targetSwitchProfile = Object.values(settings.profiles).find(
              (p): p is SwitchProfile => p.profileType === 'SwitchProfile'
            );
          }

          if (!targetSwitchProfile) {
            sendResponse({ success: false, error: '未找到自动切换情景模式 (No Auto Switch profile found)' });
            return;
          }

          const rawPattern = (host || '').trim();
          const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(rawPattern) || rawPattern.includes(':');
          const rulePattern = isIp || rawPattern.startsWith('*') ? rawPattern : `*.${rawPattern}`;
          const cleanHost = rawPattern.replace(/^\*\./, '');
          const isMatch = (p: string) => p === rulePattern || p === rawPattern || p.replace(/^\*\./, '') === cleanHost;

          const existingRule = targetSwitchProfile.rules.find(
            (r) => r.condition.conditionType === 'HostWildcardCondition' && isMatch(r.condition.pattern)
          );
          targetSwitchProfile.rules = targetSwitchProfile.rules.filter(
            (r) => !(r.condition.conditionType === 'HostWildcardCondition' && isMatch(r.condition.pattern))
          );
          targetSwitchProfile.rules.unshift({
            id: existingRule?.id || `r_speed_${Date.now()}`,
            enabled: true,
            condition: {
              conditionType: 'HostWildcardCondition',
              pattern: rulePattern,
            },
            profileId,
            note: existingRule?.note || `Speed suggestion: ${profileId}`,
          });
          await saveSettings(settings);
          if (active && active.profileType === 'SwitchProfile') {
            await ProxyManager.applyProfile(targetSwitchProfile, settings.profiles);
          }
          const targetProfile = settings.profiles[profileId];
          const targetName = targetProfile ? targetProfile.name : (profileId === 'direct' ? '直连' : profileId);
          sendResponse({ success: true, profileName: targetName });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sendResponse({ success: false, error: msg });
        }
      })();
      return true;
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
          const { pattern, profileId, tabId } = message;
          const settings = await getSettings();
          const active = settings.profiles[settings.activeProfileId];

          if (!active || active.profileType !== 'SwitchProfile') {
            sendResponse({ success: false, error: '当前情景模式不是自动切换模式 (Current profile is not an Auto Switch profile)' });
            return;
          }

          const rawPattern = (pattern || '').trim();
          const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(rawPattern) || rawPattern.includes(':');
          const rulePattern = isIp || rawPattern.startsWith('*') ? rawPattern : `*.${rawPattern}`;
          const cleanHost = rawPattern.replace(/^\*\./, '');
          const isMatch = (p: string) => p === rulePattern || p === rawPattern || p.replace(/^\*\./, '') === cleanHost;

          const switchProfile = active as SwitchProfile;
          const existingRule = switchProfile.rules.find(
            (r) => r.condition.conditionType === 'HostWildcardCondition' && isMatch(r.condition.pattern)
          );

          // Deduplicate: purge previous duplicate rules for this host and update to top
          switchProfile.rules = switchProfile.rules.filter(
            (r) => !(r.condition.conditionType === 'HostWildcardCondition' && isMatch(r.condition.pattern))
          );
          switchProfile.rules.unshift({
            id: existingRule?.id || `r_user_${Date.now()}`,
            enabled: true,
            condition: {
              conditionType: 'HostWildcardCondition',
              pattern: rulePattern,
            },
            profileId: profileId || 'proxy',
            note: existingRule?.note || 'Added from popup',
          });
          await saveSettings(settings);
          await ProxyManager.applyProfile(switchProfile, settings.profiles);
          const targetTabId = typeof tabId === 'number' && tabId > 0 ? tabId : _sender.tab?.id;
          if (typeof targetTabId === 'number' && targetTabId > 0 && tabErrors.has(targetTabId)) {
            const cur = tabErrors.get(targetTabId)!;
            const next = cur.filter((e) => e.host !== cleanHost && e.host !== rawPattern);
            if (next.length > 0) tabErrors.set(targetTabId, next);
            else tabErrors.delete(targetTabId);
            broadcastTab(targetTabId);
          }
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
