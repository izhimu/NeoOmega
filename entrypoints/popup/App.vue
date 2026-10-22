<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, toRaw } from 'vue';
import { Toaster, toast } from 'vue-sonner';
import { Settings, Activity, ArrowUpRight, Globe } from '@lucide/vue';
import { getSettings } from '../../src/core/storage/storage';
import type { AppSettings, Profile, TabNetworkError } from '../../src/core/types';
import { resolveProfile } from '../../src/core/pac/generator';
import { resolveRouting, routingKindOf } from '../../src/core/routing';
import { useI18n, resolveLocale } from '../../src/core/i18n';
import { applyTheme, initThemeListener } from '../../src/core/theme';
import UiButton from '../../src/components/ui/UiButton.vue';
import UiBadge from '../../src/components/ui/UiBadge.vue';
import AppLogo from '../../src/components/ui/AppLogo.vue';
import { openOptions } from '../../src/lib/navigation';

const settings = ref<AppSettings | null>(null);
const currentTabHost = ref<string>('');
const currentTabUrl = ref<string>('');
const currentTabId = ref<number>(0);
const tabErrors = ref<TabNetworkError[]>([]);
const addingRule = ref(false);
const { t, setLocale, getProfileDisplayName } = useI18n();
let cleanThemeListener: (() => void) | null = null;

interface LatencyItem {
  latency?: number;
  success: boolean;
  status?: number;
  error?: string;
  timestamp: number;
}

const latencies = ref<Record<string, LatencyItem>>({});
const testingIds = ref<Record<string, boolean>>({});
const activeProfile = computed(() => {
  if (!settings.value) return null;
  return settings.value.profiles[settings.value.activeProfileId] || null;
});

const LATENCY_CACHE_TTL = 5 * 60 * 1000;

// Render-time staleness filter: cache entries older than TTL render as absent.
const freshLatency = (id: string): LatencyItem | undefined => {
  const item = latencies.value[id];
  return item && Date.now() - item.timestamp < LATENCY_CACHE_TTL ? item : undefined;
};

const activeProfileLatency = computed(() => {
  const p = activeProfile.value;
  if (!p) return undefined;
  if (p.profileType === 'FixedProfile') {
    const item = freshLatency(p.id);
    return item?.success ? item.latency : undefined;
  }
  return undefined;
});

type RoutingKind = import('../../src/core/routing').RoutingKind;
const verdictOf = (p: Profile | null | undefined): { kind: RoutingKind } => {
  return { kind: routingKindOf(p) };
};

const routing = computed<{ kind: RoutingKind } | null>(() => {
  const s = settings.value;
  const active = activeProfile.value;
  if (!s || !active) return null;
  const base = resolveProfile(active.id, s.profiles) ?? active;
  const url = currentTabUrl.value;
  const host = currentTabHost.value;
  if (!url || !host) return verdictOf(base);
  const kind = resolveRouting(s, url, host);
  return kind === null ? null : { kind };
});

const loadLatencyCache = async () => {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const res = await chrome.storage.local.get('neo_omega_latency_cache');
    if (res?.neo_omega_latency_cache) {
      latencies.value = res.neo_omega_latency_cache as Record<string, LatencyItem>;
    }
  }
};

const testFixedProfiles = async (force = false) => {
  if (!settings.value?.profiles) return;
  const now = Date.now();

  // Probe only the active profile on open; other profiles use their retest button.
  const id = settings.value.activeProfileId;
  const profile = settings.value.profiles[id];
  if (profile?.profileType !== 'FixedProfile' || !profile.fallbackProxy?.host || !profile.fallbackProxy.port) return;
  const cached = latencies.value[id];
  if (!force && cached && now - cached.timestamp < LATENCY_CACHE_TTL) return;

  testingIds.value[id] = true;
  const pending = [{ id, proxy: toRaw(profile).fallbackProxy }];
  let cacheChanged = false;

  try {
    await new Promise<void>((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'TEST_PROXIES', proxies: pending.map((p) => p.proxy), testUrl: 'https://www.google.com/generate_204' },
        (res) => {
          for (const { id } of pending) testingIds.value[id] = false;
          if (chrome.runtime.lastError) {
            for (const { id } of pending) {
              latencies.value[id] = { success: false, error: chrome.runtime.lastError.message, timestamp: Date.now() };
              cacheChanged = true;
            }
          } else if (res?.success && Array.isArray(res.results)) {
            pending.forEach(({ id }, i) => {
              const r = res.results[i];
              if (r) {
                latencies.value[id] = { ...r, timestamp: Date.now() };
                cacheChanged = true;
              }
            });
          } else {
            for (const { id } of pending) {
              latencies.value[id] = { success: false, error: res?.error || 'ERR', timestamp: Date.now() };
              cacheChanged = true;
            }
          }
          resolve();
        }
      );
    });
  } catch {
    for (const { id } of pending) testingIds.value[id] = false;
  }

  if (cacheChanged && typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ neo_omega_latency_cache: toRaw(latencies.value) });
  }
};

const retestProfile = async (id: string) => {
  const profile = settings.value?.profiles[id];
  if (!profile || profile.profileType !== 'FixedProfile' || !profile.fallbackProxy?.host) return;
  testingIds.value[id] = true;
  const proxyPayload = toRaw(profile).fallbackProxy;
  chrome.runtime.sendMessage(
    { type: 'TEST_PROXY', proxy: proxyPayload, testUrl: 'https://www.google.com/generate_204' },
    async (res) => {
      testingIds.value[id] = false;
      let cacheChanged = false;
      if (chrome.runtime.lastError) {
        latencies.value[id] = { success: false, error: chrome.runtime.lastError.message, timestamp: Date.now() };
        cacheChanged = true;
      } else if (res) {
        latencies.value[id] = { ...res, timestamp: Date.now() };
        cacheChanged = true;
      }
      if (cacheChanged && typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({ neo_omega_latency_cache: toRaw(latencies.value) });
      }
    }
  );
};

const getLatencyClass = (item?: LatencyItem) => {
  if (!item || !item.success || item.latency === undefined) {
    return 'text-rose-600 dark:text-rose-400 bg-rose-50/80 dark:bg-rose-950/40 border-rose-200/60 dark:border-rose-900/40';
  }
  if (item.latency < 250) {
    return 'text-emerald-600 dark:text-emerald-400 bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200/60 dark:border-emerald-900/40';
  }
  if (item.latency < 600) {
    return 'text-amber-600 dark:text-amber-400 bg-amber-50/80 dark:bg-amber-950/40 border-amber-200/60 dark:border-amber-900/40';
  }
  return 'text-rose-600 dark:text-rose-400 bg-rose-50/80 dark:bg-rose-950/40 border-rose-200/60 dark:border-rose-900/40';
};

const loadState = async () => {
  try {
    const stashed = globalThis.__neoOmegaInitialSettings;
    delete globalThis.__neoOmegaInitialSettings;
    settings.value = stashed ?? (await getSettings());
    applyTheme(settings.value?.theme);
    setLocale(resolveLocale(settings.value?.language));

    // Query active tab
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0] && tabs[0].url) {
        currentTabId.value = tabs[0].id || 0;
        currentTabUrl.value = tabs[0].url;
        try {
          const u = new URL(tabs[0].url);
          if (['http:', 'https:'].includes(u.protocol)) {
            currentTabHost.value = u.hostname;
          } else {
            currentTabHost.value = '';
          }
        } catch {
          currentTabHost.value = '';
        }

        // Query background for tab errors
        if (currentTabId.value > 0) {
          chrome.runtime.sendMessage(
            { type: 'GET_TAB_ERRORS', tabId: currentTabId.value },
            (res) => {
              if (chrome.runtime.lastError) return;
              if (res && res.errors) {
                tabErrors.value = res.errors;
              }
            }
          );
        }
      }
    }
  } catch (err) {
    console.error('Failed to load popup state:', err);
  }
  await loadLatencyCache();
  testFixedProfiles();
};
const reloadCurrentTab = () => {
  if (typeof chrome === 'undefined' || !chrome.tabs?.reload) return;
  const reload = (id: number, url?: string) => {
    if (id > 0 && url && !url.startsWith('chrome://') && !url.startsWith('chrome-extension://') && !url.startsWith('edge://') && !url.startsWith('about:')) {
      chrome.tabs.reload(id);
    }
  };
  if (currentTabId.value > 0) {
    reload(currentTabId.value, currentTabUrl.value);
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) reload(tab.id, tab.url);
    });
  }
};

const switchProfile = async (profileId: string) => {
  if (!settings.value || settings.value.activeProfileId === profileId) return;
  const previousProfileId = settings.value.activeProfileId;
  settings.value.activeProfileId = profileId;
  chrome.runtime.sendMessage({ type: 'SWITCH_PROFILE', profileId }, (res) => {
    if (chrome.runtime.lastError || (res && !res.success)) {
      if (settings.value) settings.value.activeProfileId = previousProfileId;
      toast.error(res?.error || chrome.runtime.lastError?.message || t('options.profileSaveFailed'));
      return;
    }
    reloadCurrentTab();
  });
};

const addQuickRule = (host: string) => {
  addingRule.value = true;
  chrome.runtime.sendMessage(
    { type: 'ADD_HOST_RULE', pattern: host, profileId: 'proxy', tabId: currentTabId.value },
    async (res) => {
      addingRule.value = false;
      const err = chrome.runtime.lastError;
      if (!err && res && res.success) {
        tabErrors.value = tabErrors.value.filter((e) => e.host !== host);
        settings.value = await getSettings();
        reloadCurrentTab();
      } else {
        toast.error(res?.error || err?.message || t('popup.addRuleFailed'));
      }
    }
  );
};

const addingSiteRule = ref(false);
const siteRuleMsg = ref<{ ok: boolean; text: string } | null>(null);
let siteRuleTimer: ReturnType<typeof setTimeout> | null = null;
const canQuickRule = computed(() => !!currentTabHost.value && activeProfile.value?.profileType === 'SwitchProfile');

const quickAddSite = (profileId: 'proxy' | 'direct') => {
  if (!currentTabHost.value || addingSiteRule.value) return;
  addingSiteRule.value = true;
  chrome.runtime.sendMessage(
    { type: 'ADD_HOST_RULE', pattern: currentTabHost.value, profileId, tabId: currentTabId.value },
    async (res) => {
      addingSiteRule.value = false;
      const err = chrome.runtime.lastError;
      const ok = !!(!err && res && res.success);
      siteRuleMsg.value = { ok, text: ok ? t('popup.ruleAdded') : (res?.error || err?.message || t('popup.addRuleFailed')) };
      if (ok) {
        settings.value = await getSettings();
        reloadCurrentTab();
      }
      if (siteRuleTimer) clearTimeout(siteRuleTimer);
      siteRuleTimer = setTimeout(() => {
        siteRuleMsg.value = null;
        siteRuleTimer = null;
      }, 2500);
    }
  );
};


onMounted(() => {
  loadState();
  cleanThemeListener = initThemeListener(() => settings.value?.theme);
});

onUnmounted(() => {
  if (cleanThemeListener) cleanThemeListener();
  if (siteRuleTimer) {
    clearTimeout(siteRuleTimer);
    siteRuleTimer = null;
  }
});
</script>

<template>
  <div class="flex flex-col gap-2.5 p-2.5 select-none font-sans text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-950 w-[250px]">
    <Toaster position="top-center" rich-colors :duration="2000" />
    <!-- Header -->
    <header class="flex justify-between items-center px-1">
      <div class="flex items-center gap-2 min-w-0">
        <AppLogo size="sm" />
        <div class="flex flex-col min-w-0 leading-none">
          <div class="flex items-center gap-1.5">
            <h1 class="m-0 text-xs font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
              {{ t('popup.title') }}
            </h1>
          </div>
          <span class="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
            {{ t('popup.profiles') }}
          </span>
        </div>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <button
          class="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors cursor-pointer"
          :title="t('popup.openSettings')"
          @click="openOptions"
        >
          <Settings :size="15" />
        </button>
      </div>
    </header>

    <!-- Top Routing Hub Card -->
    <div class="px-3 py-2 rounded-xl bg-slate-900 text-white dark:bg-slate-900 border border-slate-800 dark:border-white/10 shadow-sm flex flex-col gap-1.5">
      <div class="flex items-center justify-between gap-1.5">
        <div class="flex items-center gap-1.5 min-w-0">
          <Globe :size="12" class="text-blue-400 shrink-0" />
          <span class="text-[11px] font-medium truncate max-w-[145px]" :title="currentTabHost || t('popup.directTab')">
            {{ currentTabHost || t('popup.directTab') }}
          </span>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <div
            v-if="canQuickRule"
            class="flex items-center gap-0.5 p-0.5 rounded-full bg-white/5 border border-white/10 shadow-inner"
            :title="siteRuleMsg?.text"
          >
            <button
              class="px-1.5 py-0.5 rounded-full text-[9px] font-semibold leading-none cursor-pointer transition-all duration-150 disabled:pointer-events-none disabled:opacity-50"
              :class="routing?.kind === 'proxy' ? 'bg-blue-500/25 text-blue-200 shadow-xs shadow-blue-500/20' : 'text-slate-500 hover:text-slate-300'"
              :disabled="addingSiteRule"
              @click="quickAddSite('proxy')"
            >
              {{ t('popup.routing.proxy') }}
            </button>
            <button
              class="px-1.5 py-0.5 rounded-full text-[9px] font-semibold leading-none cursor-pointer transition-all duration-150 disabled:pointer-events-none disabled:opacity-50"
              :class="routing?.kind === 'direct' ? 'bg-emerald-500/25 text-emerald-200 shadow-xs shadow-emerald-500/20' : 'text-slate-500 hover:text-slate-300'"
              :disabled="addingSiteRule"
              @click="quickAddSite('direct')"
            >
              {{ t('popup.routing.direct') }}
            </button>
          </div>
          <span
            v-else-if="routing"
            class="text-[9px] px-1.5 py-0.5 rounded-full font-semibold leading-none"
            :class="routing.kind === 'direct' ? 'bg-emerald-500/20 text-emerald-300' : routing.kind === 'proxy' ? 'bg-blue-500/20 text-blue-300' : 'bg-slate-500/20 text-slate-300'"
          >
            {{ t(`popup.routing.${routing.kind}`) }}
          </span>
        <span
          v-if="activeProfileLatency !== undefined"
          class="text-[9px] font-mono px-1.5 py-0.5 rounded-full font-semibold leading-none shrink-0"
          :class="activeProfileLatency < 250 ? 'bg-emerald-500/20 text-emerald-300' : activeProfileLatency < 600 ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'"
        >
          {{ activeProfileLatency }}ms
        </span>
        </div>
      </div>

      <div class="flex items-center justify-between text-[10px] pt-1.5 border-t border-white/10">
        <span v-if="siteRuleMsg" :class="siteRuleMsg.ok ? 'text-emerald-400' : 'text-rose-400'" class="truncate">{{ siteRuleMsg.text }}</span>
        <span v-else class="text-slate-400">{{ t('popup.matchingProfile') }}</span>
        <div class="flex items-center gap-1.5 text-slate-200 font-medium">
          <span
            class="w-1.5 h-1.5 rounded-full shrink-0 shadow-xs"
            :style="{ backgroundColor: activeProfile?.color || '#3b82f6', boxShadow: `0 0 6px ${activeProfile?.color || '#3b82f6'}` }"
          />
          <span class="truncate max-w-[120px]">{{ getProfileDisplayName(activeProfile) }}</span>
        </div>
      </div>
    </div>

    <!-- Profile List -->
    <div v-if="settings" class="flex flex-col gap-1.5">
      <div
        v-for="id in (settings.order || [])"
        :key="id"
        class="group flex items-center justify-between px-3 py-2.5 min-h-[38px] rounded-xl cursor-pointer transition-all duration-150"
        :class="settings.activeProfileId === id
          ? 'bg-blue-50/90 dark:bg-blue-500/15 border border-blue-500/40 dark:border-blue-400/40 text-blue-900 dark:text-blue-100 font-semibold shadow-xs'
          : 'bg-white dark:bg-slate-900/60 border border-slate-200/70 dark:border-white/5 text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/70 hover:border-slate-300 dark:hover:border-white/15'"
        @click="switchProfile(id)"
      >
        <div class="flex items-center gap-2.5 min-w-0">
          <span
            class="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs ring-2 ring-white dark:ring-slate-900 transition-transform group-hover:scale-125"
            :style="{ backgroundColor: settings.profiles[id]?.color || '#64748b' }"
          />
          <span class="text-xs truncate font-medium">{{ getProfileDisplayName(settings.profiles[id]) }}</span>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          <template v-if="settings.profiles[id]?.profileType === 'FixedProfile'">
            <span
              v-if="testingIds[id]"
              class="text-[9px] font-mono text-slate-400 dark:text-slate-500 animate-pulse px-1.5 py-0.5 rounded-full bg-slate-200/50 dark:bg-slate-700/50 leading-none"
            >
              ...
            </span>
            <span
              v-else-if="freshLatency(id)"
              class="text-[9px] font-mono px-1.5 py-0.5 rounded-full border leading-none font-medium cursor-pointer transition-transform hover:scale-105 select-none"
              :class="getLatencyClass(freshLatency(id))"
              :title="freshLatency(id)!.success ? `${freshLatency(id)!.latency}ms (${t('popup.clickToRetest')})` : (freshLatency(id)!.error || t('common.timeout'))"
              @click.stop="retestProfile(id)"
            >
              {{ freshLatency(id)!.success ? `${freshLatency(id)!.latency}ms` : 'ERR' }}
            </span>
          </template>

          <span
            v-if="settings.profiles[id]?.profileType === 'SwitchProfile'"
            class="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-slate-150 dark:bg-slate-800 text-slate-500 dark:text-slate-400 leading-none border border-slate-200/60 dark:border-white/5"
          >
            {{ t('common.auto') }}
          </span>
        </div>
      </div>
    </div>

    <!-- Current Tab Error Monitoring / Quick Add -->
    <Transition name="fade">
      <div v-if="tabErrors.length > 0" class="mt-0.5 p-2 bg-rose-50/80 dark:bg-rose-500/10 border border-rose-200/70 dark:border-rose-500/20 rounded-xl text-xs flex flex-col gap-1.5">
        <div class="flex items-center justify-between font-semibold text-rose-600 dark:text-rose-400 text-[11px]">
          <div class="flex items-center gap-1.5">
            <Activity :size="13" />
            <span>{{ t('popup.failedRequests') }}</span>
          </div>
          <UiBadge variant="destructive" size="sm" class="px-1 py-0 text-[9px] font-bold">
            {{ tabErrors.length }}
          </UiBadge>
        </div>
        <TransitionGroup name="list" tag="div" class="flex flex-col gap-1">
          <div v-for="err in tabErrors.slice(0, 3)" :key="err.host" class="flex justify-between items-center gap-1.5">
            <span class="truncate text-slate-600 dark:text-slate-400 text-[10px] font-mono" :title="err.url">{{ err.host }}</span>
            <UiButton
              variant="destructive"
              size="sm"
              class="h-5 px-1.5 text-[9px] shrink-0"
              :disabled="addingRule"
              @click="addQuickRule(err.host)"
            >
              {{ t('popup.quickAddProxy') }}
            </UiButton>
          </div>
        </TransitionGroup>
      </div>
    </Transition>

    <!-- Footer -->
    <footer class="pt-1.5 border-t border-slate-100 dark:border-white/5 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 px-0.5">
      <div class="flex items-center gap-1 text-slate-400 dark:text-slate-500 font-medium">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-xs shadow-emerald-500/50" />
        <span>{{ t('common.ready') }}</span>
      </div>
      <button
        class="hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-0.5 cursor-pointer transition-colors"
        @click="openOptions"
      >
        <span>{{ t('options.brandSub') }}</span>
        <ArrowUpRight :size="11" />
      </button>
    </footer>
  </div>
</template>
