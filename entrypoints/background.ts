import { fetchAndParseRuleList } from '../src/core/parsers/autoproxy';
import { initAuthManager, setTempProxyCredentials, clearTempProxyCredentials } from '../src/core/proxy/auth-manager';
import { generatePacScript, generateTestPacScript, formatProxyDirective, formatFixedChain, resolveProfile } from '../src/core/pac/generator';
import { matchSwitchProfileFull } from '../src/core/pac/matcher';
import { resolveRouting } from '../src/core/routing';
import { ProxyManager } from '../src/core/proxy/proxy-manager';
import { getSettings, saveSettings, setActiveProfileId, adoptSyncSettings } from '../src/core/storage/storage';
import type { AppSettings, FixedProfile, Profile, ProxyServer, RuleListConfig, SwitchProfile, SwitchRule, TabNetworkError, TabRequestLog } from '../src/core/types';

type ProxyAuth = { username?: string; password?: string };

// ponytail: duplicates generator.ts's probe-block splice so a whole probe batch
// can share one generated base PAC; upgrade path = generator exposes a
// base+block API (generator.ts owned elsewhere).
const spliceProbeBlock = (baseScript: string | null, directive: string, targetHost: string): string => {
  const block = `  if (host === ${JSON.stringify(targetHost.toLowerCase().replace(/^\[|\]$/g, ''))}) return ${JSON.stringify(directive)};`;
  // Insert after the directive prologue + host normalization (see generator.ts).
  const anchors = ['  if (host.charCodeAt(host.length - 1) === 46) host = host.substring(0, host.length - 1);', '  "use strict";', 'function FindProxyForURL(url, host) {'];
  if (baseScript) {
    for (const anchor of anchors) {
      const idx = baseScript.indexOf(anchor);
      if (idx !== -1) {
        const insertPos = idx + anchor.length;
        return baseScript.slice(0, insertPos) + `\n${block}` + baseScript.slice(insertPos);
      }
    }
  }
  return `function FindProxyForURL(url, host) {\n${block}\n  return "DIRECT";\n}`;
};

type TimeoutHandle = ReturnType<typeof setTimeout>;

const lastToastAt = new Map<string, number>();
const failureAlertTypes: Record<string, true> = {
  main_frame: true,
  sub_frame: true,
  script: true,
  stylesheet: true,
  xmlhttprequest: true,
  font: true,
};
const benignFailureErrors: Record<string, true> = {
  'net::ERR_ABORTED': true,
  'net::ERR_BLOCKED_BY_CLIENT': true,
  'net::ERR_BLOCKED_BY_RESPONSE': true,
};

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

  // One shared startup read: alarm setup + listener gating both consume it.
  const startupSettingsPromise = getSettings();
  // Setup periodic rule list update alarm (every 2 hours)
  if (chrome.alarms) {
    startupSettingsPromise.then((s) => {
      const period = Math.max(15, s.ruleListUpdateInterval ?? 120);
      // create() with an existing name resets the schedule; SW cold-starts are
      // frequent (webRequest wakes), which would postpone the alarm forever.
      chrome.alarms.get('neo_omega_update_rules', (existing) => {
        if (!existing || existing.periodInMinutes !== period) {
          chrome.alarms.create('neo_omega_update_rules', { periodInMinutes: period });
        }
      });
    }).catch(() => {});
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
      const resolved = resolveProfile(freshSettings.activeProfileId, freshSettings.profiles);
      if (resolved?.id === profileId || freshSettings.activeProfileId === profileId) {
        const active = freshSettings.profiles[freshSettings.activeProfileId] || freshProfile;
        await ProxyManager.applyProfile(active, freshSettings.profiles);
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
  let userTestRunning = false;
  let speedProbeRunning = false;
  let speedProbeAbort: AbortController | null = null;

  // Direct fetch fails (e.g. GFWList unreachable without proxy): silently
  // route ONLY the rule-list host through the first configured Fixed proxy
  // via a temporary PAC. Active profile is never switched.
  const fetchRuleListWithFallback = async (
    url: string,
    matchProfileId: string,
    defaultProfileId: string,
    settings: AppSettings
  ): Promise<{ text: string; rules: SwitchRule[] }> => {
    try {
      return await fetchAndParseRuleList(url, matchProfileId, defaultProfileId);
    } catch (directErr) {
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
        ruleListFallbackRunning ||
        speedProbeRunning
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

        await ProxyManager.setRawPac(pac);
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
        try {
          // Re-reads settings: user may have switched profiles during the fetch.
          if (!userTestRunning && !speedProbeRunning) {
            await ProxyManager.applyCurrentActive();
          }
        } catch (restoreErr) {
          console.error('[NeoOmega] Failed to restore proxy after rule-list fallback:', restoreErr);
        }
      }
    }
  };

  let userTestQueue: Promise<unknown> = Promise.resolve();

  // Bandwidth test: downloads MBs through ONE proxy via a dedicated PAC.
  // (Latency tests go through executeBatchLatencyTest — one PAC write for N proxies.)
  const executeProxyTest = async (
    proxy: ProxyServer,
    testUrl?: string
  ) => {
    if (typeof chrome === 'undefined' || !chrome.proxy?.settings) {
      throw new Error('Chrome proxy API not available');
    }
    const effectiveTestUrl = testUrl?.trim() || 'https://speed.cloudflare.com/__down?bytes=5000000';

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

      await ProxyManager.setRawPac(testPac);
      const { promise: delayPromise, resolve: delayResolve } = Promise.withResolvers<void>();
      setTimeout(delayResolve, 60);
      await delayPromise;

      const urlWithBuster = new URL(effectiveTestUrl);
      urlWithBuster.searchParams.set('_t', Date.now().toString());

      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 18000);

      const res = await fetch(urlWithBuster.toString(), {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

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
      const totalBytes = bytesCount;
      let speedMBps: number | undefined;
      let speedMbps: number | undefined;
      const totalDurationSec = (performance.now() - startTime) / 1000;
      if (totalDurationSec > 0 && bytesCount > 0) {
        const bytesPerSec = bytesCount / totalDurationSec;
        speedMBps = Number((bytesPerSec / (1024 * 1024)).toFixed(2));
        speedMbps = Number(((bytesPerSec * 8) / 1000000).toFixed(2));
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
        mode: 'bandwidth',
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
        mode: 'bandwidth',
        error: errMsg,
        testUrl: effectiveTestUrl,
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      // proxy restored below
      clearTempProxyCredentials();
      try {
        // Re-reads settings: user may have switched profiles while the test ran.
        await ProxyManager.applyCurrentActive();
      } catch (cleanupErr) {
        console.error('[NeoOmega] Failed to restore proxy after test:', cleanupErr);
      }
    }
  };

  // User tests preempt the background speed probe
  const preemptSpeedProbe = async () => {
    if (speedProbeRunning && speedProbeAbort) {
      speedProbeAbort.abort();
      for (let i = 0; i < 6 && speedProbeRunning; i++) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 50);
        await promise;
      }
    }
    // Rule-list fallback briefly owns proxy settings via a temp PAC — wait it
    // out (cap 30s) so a user test can't strand/overwrite it mid-flight.
    for (let i = 0; i < 300 && ruleListFallbackRunning; i++) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 100);
      await promise;
    }
  };

  const settleProbePac = async (expectedPac: string): Promise<boolean> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { promise: settlePromise, resolve: settleResolve } = Promise.withResolvers<void>();
      setTimeout(settleResolve, 120); // ≥ old single-write settle: chrome.proxy.settings.set resolving doesn't guarantee the network service swapped PACs; stale PAC would misattribute latency to the previous candidate
      await settlePromise;
      const current = await chrome.proxy.settings.get({});
      if (current.value.pacScript?.data === expectedPac) return true;
    }
    return false;
  };

  // Latency test for N proxies: sequential per-candidate host-only PAC writes
  // (batch query-marker PAC was abandoned — Chrome strips HTTPS URL path+query
  // before PAC evaluation, so markers never match for HTTPS targets).
  const executeBatchLatencyTest = async (
    proxies: ProxyServer[],
    testUrl?: string
  ): Promise<Array<Record<string, unknown>>> => {
    if (proxies.length === 0) return [];
    if (typeof chrome === 'undefined' || !chrome.proxy?.settings) {
      throw new Error('Chrome proxy API not available');
    }
    const effectiveTestUrl = testUrl?.trim() || 'https://www.google.com/generate_204';
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(effectiveTestUrl);
    } catch {
      throw new Error('无效的测试目标 URL');
    }
    const targetHost = parsedUrl.hostname;
    const settings = await getSettings();
    const activeProfile = settings.profiles[settings.activeProfileId];
    // Base PAC generated once for the whole batch; only the host block differs per candidate.
    const basePac = activeProfile ? generatePacScript(activeProfile, settings.profiles) : null;

    // Sequential per-candidate host-only PAC writes. Parallel batch with
    // URL-query markers was abandoned: Chrome strips path+query of HTTPS
    // URLs before PAC evaluation (PacHttpsUrlStrippingEnabled), so markers
    // never match and every probe falls through to base routing.
    try {
      const results: Array<Record<string, unknown>> = [];
      for (const p of proxies) {
        const probePac = spliceProbeBlock(basePac, formatProxyDirective(p), targetHost);
        await ProxyManager.setRawPac(probePac);
        if (!(await settleProbePac(probePac))) {
          results.push({ success: false, latency: 0, error: 'PAC not applied', testUrl: effectiveTestUrl, mode: 'latency' });
          continue;
        }
        if (p.auth?.username) setTempProxyCredentials(p.host, p.port, p.auth);
        const start = performance.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        try {
          const probeUrl = new URL(effectiveTestUrl);
          probeUrl.searchParams.set('_t', String(Date.now()));
          const res = await fetch(probeUrl.toString(), {
            signal: controller.signal,
            cache: 'no-store',
            redirect: 'manual',
          });
          try { await res.body?.cancel(); } catch {}
          const failed = res.status >= 400;
          results.push({
            success: !failed,
            ...(failed ? { error: `HTTP ${res.status}` } : {}),
            latency: Math.round(performance.now() - start),
            status: res.status,
            statusText: res.statusText,
            testUrl: effectiveTestUrl,
            mode: 'latency',
          });
        } catch (err) {
          let errMsg = err instanceof Error ? err.message : String(err);
          if (err instanceof Error && err.name === 'AbortError') errMsg = '连接超时 (Timeout)';
          results.push({ success: false, latency: Math.round(performance.now() - start), error: errMsg, testUrl: effectiveTestUrl, mode: 'latency' });
        } finally {
          clearTimeout(timeoutId);
        }
      }
      // Sub-10ms success means the proxy answered locally without contacting
      // the target — surface it so bogus-fast readings are diagnosable.
      console.log('[NeoOmega] Latency test results:', results.map((r, i) => ({ proxy: `${proxies[i]?.host}:${proxies[i]?.port}`, latency: r.latency, status: r.status, error: r.error })));
      return results;
    } finally {
      clearTempProxyCredentials();
      try {
        // Re-reads settings: user may have switched profiles while the test ran.
        await ProxyManager.applyCurrentActive();
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
    await preemptSpeedProbe();

    const run = async () => {
      userTestRunning = true;
      try {
        if (mode === 'bandwidth') {
          // Bandwidth downloads MBs through one proxy; keep the dedicated PAC path
          return await executeProxyTest(proxy, testUrl);
        }
        const results = await executeBatchLatencyTest([proxy], testUrl);
        return results[0];
      } finally {
        userTestRunning = false;
      }
    };

    const next = userTestQueue.then(run, run);
    userTestQueue = next.catch(() => {});
    return await next;
  };

  const testProxyServers = async (proxies: ProxyServer[], testUrl?: string) => {
    await preemptSpeedProbe();

    const run = async () => {
      userTestRunning = true;
      try {
        // Keep results index-aligned with the caller's array: invalid entries
        // get a failure result, valid ones are batch-tested.
        const validIdx = proxies.map((p, i) => (p && p.host ? i : -1)).filter((i) => i >= 0);
        const tested = await executeBatchLatencyTest(validIdx.map((i) => proxies[i]!), testUrl);
        return proxies.map((p, i) => {
          const slot = validIdx.indexOf(i);
          return slot >= 0 ? tested[slot] : { success: false, error: 'No proxy server configured' };
        });
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
  const mutedFailureHosts = new Set<string>();
  const analyzedHostsCache = new Map<string, number>();
  // Latest settings snapshot for routing lookups (failure-toast proxy exclusion).
  let cachedSettings: AppSettings | null = null;

  // Fetch through the currently-installed per-candidate probe PAC (host-only
  // match — the caller installs candidate i's PAC right before this call).
  const probeFetch = async (
    candidate: { id: string; name: string; directive: string; auth?: ProxyAuth },
    host: string,
    path = '/'
  ): Promise<number | null> => {
    if (speedProbeAbort?.signal.aborted || userTestRunning || ruleListFallbackRunning) return null;
    if (candidate.auth?.username) {
      const rawTarget = candidate.directive.replace(/^[A-Z0-9]+\s+/, '').split(';')[0]?.trim() ?? '';
      const lastColon = rawTarget.lastIndexOf(':');
      if (lastColon !== -1) {
        const h = rawTarget.slice(0, lastColon).replace(/^\[|\]$/g, '');
        const p = parseInt(rawTarget.slice(lastColon + 1), 10);
        if (h && !isNaN(p)) setTempProxyCredentials(h, p, candidate.auth);
      }
    }
    const attempt = async (scheme: string, timeoutMs: number): Promise<number> => {
      const start = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const signal = speedProbeAbort
        ? AbortSignal.any([controller.signal, speedProbeAbort.signal])
        : controller.signal;
      try {
        const res = await fetch(`${scheme}://${host}${path}?_t=${Date.now()}`, {
          method: 'GET',
          signal,
          cache: 'no-store',
          redirect: 'manual',
        });
        try { await res.body?.cancel(); } catch {}
        // Only 502/503/504 are proxy error pages; 401/403/404 mean the host answered.
        if (res.status === 502 || res.status === 503 || res.status === 504) throw new Error(`HTTP ${res.status}`);
        return Math.round(performance.now() - start);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      return await attempt('https', 2000);
    } catch {
      if (speedProbeAbort?.signal.aborted || userTestRunning || ruleListFallbackRunning) return null;
      try {
        return await attempt('http', 1000);
      } catch {
        return null;
      }
    }
  };

  const analyzeSlowHosts = async (
    hosts: Array<{ host: string; duration: number; protocol?: string }>,
    tabId?: number,
    protocol?: string,
    path = '/'
  ) => {
    if (!speedRecommendationOn || userTestRunning || speedProbeRunning || ruleListFallbackRunning || !hosts.length || !tabId) return;
    // Cooldown + mute checks first: cheap, and avoids a settings read per slow-host message.
    const now = Date.now();
    const target = hosts.find((h) => !mutedFailureHosts.has(h.host) && now - (analyzedHostsCache.get(h.host) || 0) > 300000);
    if (!target) return;
    const settings = cachedSettings ?? (await getSettings());
    if (userTestRunning || speedProbeRunning || ruleListFallbackRunning) return;
    const activeProfile = settings.profiles[settings.activeProfileId];
    if (!activeProfile || activeProfile.profileType !== 'SwitchProfile') return;

    const fixedCandidates = Object.values(settings.profiles).filter(
      (p): p is FixedProfile =>
        p.profileType === 'FixedProfile' &&
        !!(p.fallbackProxy?.host || p.proxyForHttps?.host || p.proxyForHttp?.host)
    );
    if (fixedCandidates.length === 0) return;
    const latencyCache = (await chrome.storage.local.get('neo_omega_latency_cache')).neo_omega_latency_cache as
      | Record<string, { success: boolean; latency?: number }>
      | undefined;
    const cachedLatency = (id: string) => {
      const cached = latencyCache?.[id];
      return cached?.success && typeof cached.latency === 'number' ? cached.latency : Infinity;
    };
    fixedCandidates.sort((a, b) => {
      const aLatency = cachedLatency(a.id);
      const bLatency = cachedLatency(b.id);
      return aLatency === bLatency ? 0 : aLatency - bLatency;
    });
    if (analyzedHostsCache.size > 2000) analyzedHostsCache.clear();
    analyzedHostsCache.set(target.host, now);
    const targetProto = target.protocol === 'http:' || target.protocol === 'http' || protocol === 'http:' || protocol === 'http'
      ? 'http:'
      : 'https:';
    const currentProfileId = matchSwitchProfileFull(activeProfile as SwitchProfile, `${targetProto}//${target.host}/`, target.host);
    // Current route must be a measured candidate — otherwise no honest baseline.
    const resolvedCurrent = resolveProfile(currentProfileId, settings.profiles);
    const currentIsFixed = resolvedCurrent?.profileType === 'FixedProfile';
    const currentKey = currentIsFixed ? resolvedCurrent.id : 'direct';
    const seen = new Set<string>();
    const candidates: Array<{ id: string; name: string; directive: string; auth?: ProxyAuth }> = [];
    const pushCandidate = (c: { id: string; name: string; directive: string; auth?: ProxyAuth }) => {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        candidates.push(c);
      }
    };
    if (currentIsFixed) {
      const cur = resolvedCurrent as FixedProfile;
      pushCandidate({ id: cur.id, name: cur.name, directive: formatFixedChain(cur), auth: cur.fallbackProxy?.auth });
    }
    pushCandidate({ id: 'direct', name: '直连', directive: 'DIRECT' });
    for (const p of fixedCandidates.slice(0, 2)) {
      pushCandidate({ id: p.id, name: p.name, directive: formatFixedChain(p), auth: p.fallbackProxy?.auth });
    }

    const abortController = new AbortController();
    speedProbeRunning = true;
    speedProbeAbort = abortController;
    // Base PAC generated once for the batch; only the host block differs per candidate.
    const basePac = generatePacScript(activeProfile, settings.profiles);
    const probeResults: Array<{ id: string; name: string; latency: number | null }> = [];
    try {
      // Sequential per-candidate host-only PAC writes. Parallel batch with
      // URL-query markers was abandoned: Chrome strips path+query of HTTPS
      // URLs before PAC evaluation (PacHttpsUrlStrippingEnabled), so markers
      // never match and every probe falls through to base routing.
      for (const cand of candidates) {
        if (abortController.signal.aborted) break;
        const probePac = spliceProbeBlock(basePac, cand.directive, target.host);
        await ProxyManager.setRawPac(probePac);
        if (!(await settleProbePac(probePac))) {
          probeResults.push({ id: cand.id, name: cand.name, latency: null });
          continue;
        }
        probeResults.push({ id: cand.id, name: cand.name, latency: await probeFetch(cand, target.host, path) });
      }
    } finally {
      // A preempting user test / rule-list fallback owns the temp cred slot now.
      if (!userTestRunning && !ruleListFallbackRunning) {
        clearTempProxyCredentials();
        // Restore with one retry — a failed restore would strand the probe PAC.
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await ProxyManager.applyCurrentActive();
            break;
          } catch (err) {
            console.warn(`[NeoOmega] Restore proxy after speed probe failed (attempt ${attempt}):`, err);
          }
        }
      }
      speedProbeAbort = null;
      speedProbeRunning = false;
    }
    if (abortController.signal.aborted) return;
    const valid = probeResults.filter((r): r is { id: string; name: string; latency: number } => typeof r.latency === 'number' && r.latency >= 10);
    console.log('[NeoOmega] Speed probe for', target.host, 'results:', probeResults);
    if (valid.length === 0) return;
    valid.sort((a, b) => a.latency - b.latency);
    const best = valid[0];
    if (!best) return;
    console.log('[NeoOmega] Best candidate:', best.name, `${best.latency}ms`, 'current:', currentKey);

    if (best.id !== currentKey) {
      const currentResult = valid.find((r) => r.id === currentKey);
      // Current route unmeasured → no honest baseline; never fall back to page-load duration.
      if (!currentResult) return;
      const currentLatency = currentResult.latency;
      if (currentLatency - best.latency >= 250 && currentLatency >= best.latency * 1.25) {
        if (analyzedHostsCache.size > 2000) analyzedHostsCache.clear();
        analyzedHostsCache.set(target.host, Date.now() + 600000);
        const curProfileObj = settings.profiles[currentProfileId];
        const curName = curProfileObj ? curProfileObj.name : (currentKey === 'direct' ? '直连' : currentKey);
        console.log('[NeoOmega] Sending speed recommendation to tab', tabId, target.host, '->', best.name);
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
    resolvePending(details.requestId);
    // Request log only feeds the side panel; skip per-request alloc when closed
    if (!requestLogOn || details.tabId <= 0) return;
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


  const notifyTabOfError = (tabId: number, url: string, host: string, count: number, requestType?: string, error?: string) => {
    if (requestType && !failureAlertTypes[requestType]) return;
    if (error && benignFailureErrors[error]) return;
    if (tabId <= 0 || !errorTrackingOn || !failureNotificationOn || mutedFailureHosts.has(host) || typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) return;
    // Host already routed through a proxy profile: failure is the proxy's or
    // the site's problem, a "switch to proxy" toast adds nothing.
    if (cachedSettings && resolveRouting(cachedSettings, url, host) === 'proxy') return;
    const now = Date.now();
    if (now - (lastToastAt.get(host) || 0) < 600000) return;
    lastToastAt.set(host, now);
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

  // 20s hang detection: any request pending > 20s without headers = unreachable.
  // Sits just under Chrome's own TCP timeout (~21s+); when Chrome's native
  // error arrives first, clearPending + per-host dedup in addTabError prevent
  // double-reporting the same failure.
  const HANG_TIMEOUT_MS = 20000;
  const HANG_EVICT_MS = 60000;
  const pendingRequests = new Map<
    string,
    { tabId: number; host: string; url: string; hangAt: number; evictAt?: number; reported?: boolean }
  >();

  // One shared 1s sweep instead of a setTimeout per request: default monitoring
  // tracks every request, so per-request timers allocate N handles per page.
  let sweepTimer: TimeoutHandle | null = null;
  const stopSweepIfIdle = () => {
    if (sweepTimer && pendingRequests.size === 0) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  };
  const sweepPending = () => {
    const now = Date.now();
    for (const [id, p] of pendingRequests) {
      if (!p.reported && now >= p.hangAt) {
        console.warn('[NeoOmega] Hang detected:', p.host, p.url);
        addTabError(p.tabId, p.url, p.host, 'net::ERR_CONNECTION_HANG');
        // Keep the entry so resolvePending can retract a false-positive hang
        // when late headers arrive; evict after the retraction window.
        p.reported = true;
        p.evictAt = now + HANG_EVICT_MS;
      }
      if (p.evictAt !== undefined && now >= p.evictAt) pendingRequests.delete(id);
    }
    stopSweepIfIdle();
  };
  const ensureSweep = () => {
    if (!sweepTimer) sweepTimer = setInterval(sweepPending, 1000);
  };

  const clearPending = (requestId: string) => {
    pendingRequests.delete(requestId);
    stopSweepIfIdle();
  };

  const resolvePending = (requestId: string) => {
    const p = pendingRequests.get(requestId);
    if (!p) return;
    if (p.reported) {
      const errors = tabErrors.get(p.tabId);
      if (errors) {
        const next = errors.filter(
          (e) => !(e.url === p.url && e.host === p.host && e.error === 'net::ERR_CONNECTION_HANG')
        );
        if (next.length > 0) tabErrors.set(p.tabId, next);
        else tabErrors.delete(p.tabId);
        broadcastTab(p.tabId);
        // Retract the content-script toast only if a hang entry was actually removed
        // (host may carry a different, genuine error that should keep the toast)
        if (next.length !== errors.length && typeof chrome !== 'undefined' && chrome.tabs?.sendMessage) {
          chrome.tabs.sendMessage(p.tabId, { type: 'TAB_ERROR_RETRACTED', host: p.host }, () => void chrome.runtime.lastError);
        }
      }
    }
    pendingRequests.delete(requestId);
    stopSweepIfIdle();
  };

  const addTabError = (tabId: number, url: string, host: string, error: string, requestType?: string) => {
    // Benign failures (ad-blockers, aborted navs) feed no consumer once toasts exclude them
    if (benignFailureErrors[error]) return;
    if (tabId <= 0) return;
    const errors = tabErrors.get(tabId) || [];
    if (!errors.some((e) => e.host === host)) {
      errors.push({ url, host, error, timestamp: Date.now() });
      if (errors.length > 50) errors.shift();
      tabErrors.set(tabId, errors);
      notifyTabOfError(tabId, url, host, errors.length, requestType, error);
      broadcastTab(tabId);
    }
  };

  const onBeforeRequestListener = (details: chrome.webRequest.OnBeforeRequestDetails): undefined => {
    if (details.tabId <= 0 || (!errorTrackingOn && !requestLogOn)) return;
    if (details.type !== 'main_frame' && details.type !== 'sub_frame') return;
    try {
      const urlObj = new URL(details.url);
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') return;
      const host = urlObj.hostname;
      if (!host) return;
      clearPending(details.requestId);
      pendingRequests.set(details.requestId, {
        tabId: details.tabId,
        host,
        url: details.url,
        hangAt: Date.now() + HANG_TIMEOUT_MS,
        reported: false,
      });
      ensureSweep();
    } catch {
      // ignore invalid URLs
    }
  };

  const onHeadersReceivedListener = (details: chrome.webRequest.OnHeadersReceivedDetails): undefined => {
    resolvePending(details.requestId);
  };

  const onErrorListener = (details: chrome.webRequest.OnErrorOccurredDetails) => {
    clearPending(details.requestId);
    if (details.tabId <= 0 || details.error === 'net::ERR_ABORTED') {
      return;
    }
    try {
      const urlObj = new URL(details.url);
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') return;
      addTabError(details.tabId, details.url, urlObj.hostname, details.error, details.type);
      if (!requestLogOn) return;
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
  // Last-pushed signature per tab: skip re-cloning 80+50 entries when nothing changed.
  // ponytail: heuristic (length + newest item id/status) misses mid-array edits;
  // upgrade path = revision counter bumped on every mutation.
  const lastPushSig = new Map<number, string>();
  const pushTabData = (port: chrome.runtime.Port, tabId: number, force = false) => {
    const requests = tabRequests.get(tabId) || [];
    const errors = tabErrors.get(tabId) || [];
    const newestReq = requests[0];
    const newestErr = errors[errors.length - 1];
    const sig = `${requests.length}:${newestReq?.id}:${newestReq?.statusCode ?? newestReq?.error ?? ''}|${errors.length}:${newestErr?.host}:${newestErr?.error}`;
    if (!force && lastPushSig.get(tabId) === sig) return;
    try {
      port.postMessage({ type: 'TAB_DATA', requests, errors });
      lastPushSig.set(tabId, sig);
    } catch {
      // port already dying
    }
  };
  const broadcastTab = (tabId: number) => {
    if (portTab.size === 0) return; // no open panel: skip timer churn per request
    clearTimeout(broadcastTimers.get(tabId));
    broadcastTimers.set(
      tabId,
      setTimeout(() => {
        broadcastTimers.delete(tabId);
        for (const [port, id] of portTab) {
          if (id === tabId) pushTabData(port, tabId);
        }
      }, 250)
    );
  };

  const syncWebRequestListeners = () => {
    if (!chrome.webRequest?.onCompleted) return;
    const wantError = requestLogOn || errorTrackingOn;
    // Hang detection runs a per-request timer to drive failure toasts / panel
    // data — when neither error tracking nor the panel is on, onBeforeRequest/
    // onHeadersReceived are pure per-request overhead (URL parse + timer +
    // Map insert for every request). Gate on wantError only: popup's
    // GET_TAB_ERRORS needs hang entries even with the toast disabled.
    const wantHang = wantError;
    const wantCompleted = requestLogOn || wantHang; // panel feed + pending cleanup

    if (!wantHang && pendingRequests.size > 0) {
      pendingRequests.clear();
      stopSweepIfIdle();
    }
    const mainFilter: chrome.webRequest.RequestFilter = { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame'] };
    const toggle = <L>(
      event: {
        addListener: (cb: L, filter: chrome.webRequest.RequestFilter) => void;
        removeListener: (cb: L) => void;
        hasListener: (cb: L) => boolean;
      },
      listener: L,
      want: boolean,
      filter?: chrome.webRequest.RequestFilter
    ) => {
      const has = event.hasListener(listener);
      // Remove-then-add: hasListener can't detect a stale filter from a prior registration
      if (has) event.removeListener(listener);
      if (want) event.addListener(listener, filter ?? { urls: ['<all_urls>'] });
    };

    // Hang entries are main/sub_frame only, so filter onBeforeRequest/
    // onHeadersReceived always; onErrorOccurred stays unfiltered (failure
    // toasts need script/xhr/font). onCompleted feeds the request log for all
    // types when the panel is open; filter only when it's hang-cleanup alone.
    toggle(chrome.webRequest.onCompleted, onCompletedListener, wantCompleted, requestLogOn ? undefined : mainFilter);
    toggle(chrome.webRequest.onErrorOccurred, onErrorListener, wantError);
    toggle(chrome.webRequest.onBeforeRequest, onBeforeRequestListener, wantHang, mainFilter);
    toggle(chrome.webRequest.onHeadersReceived, onHeadersReceivedListener, wantHang, mainFilter);
  };

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'sidepanel') return;
    portTab.set(port, 0);
    requestLogOn = true;
    syncWebRequestListeners();
    port.onMessage.addListener((msg: { type?: string; tabId?: number }) => {
      if (msg?.type !== 'SUBSCRIBE_TAB' || typeof msg.tabId !== 'number') return;
      portTab.set(port, msg.tabId);
      pushTabData(port, msg.tabId, true);
    });
    port.onDisconnect.addListener(() => {
      portTab.delete(port);
      if (portTab.size === 0) {
        requestLogOn = false;
        tabRequests.clear();
        lastPushSig.clear();
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
  startupSettingsPromise
    .then((s) => {
      cachedSettings = s;
      errorTrackingOn = !!s.enableErrorMonitoring;
      failureNotificationOn = s.enableFailureNotification ?? false;
      speedRecommendationOn = s.enableSpeedRecommendation ?? false;
      mutedFailureHosts.clear();
      for (const h of s.mutedFailureHosts ?? []) mutedFailureHosts.add(h);
      applyWebRtcPolicy(s.webRtcMode);
      applyNetworkPrediction(s.disableNetworkPrediction);
      syncWebRequestListeners();
    })
    .catch(() => {});
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes['neo_omega_settings'];
    if (!change) return;
    cachedSettings = (change.newValue as AppSettings | undefined) ?? null;
    const oldMonitoring = errorTrackingOn;
    errorTrackingOn = !!(change.newValue as AppSettings | undefined)?.enableErrorMonitoring;
    failureNotificationOn = (change.newValue as AppSettings | undefined)?.enableFailureNotification ?? false;
    speedRecommendationOn = (change.newValue as AppSettings | undefined)?.enableSpeedRecommendation ?? false;
    mutedFailureHosts.clear();
    for (const h of (change.newValue as AppSettings | undefined)?.mutedFailureHosts ?? []) mutedFailureHosts.add(h);
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
  const purgePendingForTab = (tabId: number) => {
    for (const [id, p] of pendingRequests) {
      if (p.tabId === tabId) pendingRequests.delete(id);
    }
    stopSweepIfIdle();
  };
  chrome.tabs?.onRemoved.addListener((tabId) => {
    tabErrors.delete(tabId);
    tabRequests.delete(tabId);
    purgePendingForTab(tabId);
  });
  chrome.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
      tabErrors.delete(tabId);
      purgePendingForTab(tabId);
      // SPA navigations keep the content script alive — tell it to drop stale state.
      chrome.tabs.sendMessage(tabId, { type: 'URL_CHANGED' }, () => void chrome.runtime.lastError);
    }
  });
  // Handle messages from Popup and Options
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    if (message.type === 'ANALYZE_SLOW_HOSTS' || message.type === 'TAB_SLOW_HOST') {
      const proto = message.protocol === 'http:' || message.protocol === 'http' ? 'http:' : (message.protocol === 'https:' || message.protocol === 'https' ? 'https:' : undefined);
      const hosts = Array.isArray(message.hosts)
        ? message.hosts
        : message.host
          ? [{ host: message.host, duration: message.duration ?? 0, protocol: message.protocol }]
          : [];
      const path = typeof message.path === 'string' && message.path.startsWith('/')
        ? (message.path.split(/[?#]/, 1)[0] || '/').slice(0, 200)
        : '/';
      void analyzeSlowHosts(hosts, _sender.tab?.id, proto, path);
      return false;
    }
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
      const errors = (tabId ? tabErrors.get(tabId) || [] : []).filter((e) => !mutedFailureHosts.has(e.host));
      sendResponse({ errors });
      return false;
    }
    if (message.type === 'MUTE_FAILURE_HOSTS') {
      (async () => {
        try {
          const hosts: string[] = Array.isArray(message.hosts)
            ? message.hosts.filter((h: unknown) => typeof h === 'string' && h)
            : [];
          const s = await getSettings();
          const muted = new Set(s.mutedFailureHosts ?? []);
          for (const h of hosts) muted.add(h);
          s.mutedFailureHosts = Array.from(muted);
          await saveSettings(s);
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
        }
      })();
      return true;
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
          const rawPattern = (host || '').trim();
          if (!rawPattern) {
            sendResponse({ success: false, error: '域名不能为空 (Host cannot be empty)' });
            return;
          }
          const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(rawPattern) || rawPattern.includes(':');
          const rulePattern = isIp || rawPattern.startsWith('*') ? rawPattern : `*.${rawPattern}`;
          const cleanHost = rawPattern.replace(/^\*\./, '');
          const isMatch = (p: string) => p === rulePattern || p === rawPattern || p.replace(/^\*\./, '') === cleanHost;

          const freshSettings = await getSettings();
          const active = freshSettings.profiles[freshSettings.activeProfileId];
          let targetSwitchProfile: SwitchProfile | undefined;

          if (active && active.profileType === 'SwitchProfile') {
            targetSwitchProfile = active as SwitchProfile;
          } else {
            targetSwitchProfile = Object.values(freshSettings.profiles).find(
              (p): p is SwitchProfile => p.profileType === 'SwitchProfile'
            );
          }

          if (!targetSwitchProfile) {
            sendResponse({ success: false, error: '未找到自动切换情景模式 (No Auto Switch profile found)' });
            return;
          }

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
          await saveSettings(freshSettings);
          if (active && active.profileType === 'SwitchProfile') {
            await ProxyManager.applyProfile(targetSwitchProfile, freshSettings.profiles);
          }
          const targetProfile = freshSettings.profiles[profileId];
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
          const { profileId, tabId } = message;
          // Batch: `patterns` (toast "add all") or legacy single `pattern`.
          // One settings save + one PAC recompile for the whole batch —
          // per-pattern apply would recompile the full PAC N times.
          const rawList: string[] = Array.isArray(message.patterns)
            ? message.patterns.filter((p: unknown) => typeof p === 'string')
            : [message.pattern];
          const patterns = [...new Set(rawList.map((p: string) => (p || '').trim()).filter(Boolean))];
          if (patterns.length === 0) {
            sendResponse({ success: false, error: '域名不能为空 (Host cannot be empty)' });
            return;
          }

          const freshSettings = await getSettings();
          const active = freshSettings.profiles[freshSettings.activeProfileId];

          if (!active || active.profileType !== 'SwitchProfile') {
            sendResponse({ success: false, error: '当前情景模式不是自动切换模式 (Current profile is not an Auto Switch profile)' });
            return;
          }

          let targetProfileId = profileId;
          if (!targetProfileId || !freshSettings.profiles[targetProfileId]) {
            if (freshSettings.profiles['proxy']) {
              targetProfileId = 'proxy';
            } else {
              const order = freshSettings.order || Object.keys(freshSettings.profiles);
              const firstFixed = order.find((id) => freshSettings.profiles[id]?.profileType === 'FixedProfile');
              if (firstFixed) {
                targetProfileId = firstFixed;
              } else {
                const anyFixed = Object.keys(freshSettings.profiles).find((id) => freshSettings.profiles[id]?.profileType === 'FixedProfile');
                if (anyFixed) targetProfileId = anyFixed;
              }
            }
          }
          if (!targetProfileId || !freshSettings.profiles[targetProfileId]) {
            sendResponse({ success: false, error: '未找到可用的代理情景模式 (No proxy profile available)' });
            return;
          }

          const switchProfile = active as SwitchProfile;
          const addedHosts: string[] = [];
          for (const rawPattern of patterns) {
            const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(rawPattern) || rawPattern.includes(':');
            const rulePattern = isIp || rawPattern.startsWith('*') ? rawPattern : `*.${rawPattern}`;
            const cleanHost = rawPattern.replace(/^\*\./, '');
            const isMatch = (p: string) => p === rulePattern || p === rawPattern || p.replace(/^\*\./, '') === cleanHost;

            const existingRule = switchProfile.rules.find(
              (r) => r.condition.conditionType === 'HostWildcardCondition' && isMatch(r.condition.pattern)
            );

            // Deduplicate: purge previous duplicate rules for this host and update to top
            switchProfile.rules = switchProfile.rules.filter(
              (r) => !(r.condition.conditionType === 'HostWildcardCondition' && isMatch(r.condition.pattern))
            );
            switchProfile.rules.unshift({
              id: existingRule?.id || `r_user_${Date.now()}_${addedHosts.length}`,
              enabled: true,
              condition: {
                conditionType: 'HostWildcardCondition',
                pattern: rulePattern,
              },
              profileId: targetProfileId,
              note: existingRule?.note || 'Added from popup',
            });
            addedHosts.push(rawPattern);
          }
          await saveSettings(freshSettings);
          await ProxyManager.applyProfile(switchProfile, freshSettings.profiles);
          const targetTabId = typeof tabId === 'number' && tabId > 0 ? tabId : _sender.tab?.id;
          if (typeof targetTabId === 'number' && targetTabId > 0 && tabErrors.has(targetTabId)) {
            const added = new Set(addedHosts);
            const cur = tabErrors.get(targetTabId)!;
            const next = cur.filter((e) => !added.has(e.host) && !added.has(`*.${e.host}`));
            if (next.length !== cur.length) {
              if (next.length > 0) tabErrors.set(targetTabId, next);
              else tabErrors.delete(targetTabId);
              broadcastTab(targetTabId);
            }
          }
          sendResponse({ success: true, count: addedHosts.length, hosts: addedHosts });
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

    if (message.type === 'TEST_PROXIES') {
      const raw = Array.isArray(message.proxies) ? message.proxies : [];
      // Do NOT filter here — results must stay index-aligned with the caller's
      // array; testProxyServers maps invalid entries to failure results.
      testProxyServers(raw as ProxyServer[], message.testUrl)
        .then((results) => {
          sendResponse({ success: true, results });
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          sendResponse({ success: false, error: msg });
        });
      return true;
    }

    if (message.type === 'REAPPLY_PROXY') {
      (async () => {
        try {
          await ProxyManager.applyCurrentActive();
          sendResponse({ success: true });
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
