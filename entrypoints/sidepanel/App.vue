<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Trash2, Settings, Radio, Search, Plus, ExternalLink, Shield } from 'lucide-vue-next';
import { Toaster, toast } from 'vue-sonner';
import { getSettings } from '../../src/core/storage/storage';
import type { AppSettings, Profile, TabNetworkError, TabRequestLog } from '../../src/core/types';
import { useI18n, resolveLocale } from '../../src/core/i18n';
import { applyTheme, initThemeListener } from '../../src/core/theme';
import UiButton from '../../src/components/ui/UiButton.vue';
import UiInput from '../../src/components/ui/UiInput.vue';
import UiBadge from '../../src/components/ui/UiBadge.vue';
import AppLogo from '../../src/components/ui/AppLogo.vue';

const settings = ref<AppSettings | null>(null);
const currentTabId = ref<number>(0);
const currentTabHost = ref<string>('');
const currentTabTitle = ref<string>('');

const requests = ref<TabRequestLog[]>([]);
const errors = ref<TabNetworkError[]>([]);
const filterType = ref<'all' | 'errors' | 'xhr'>('all');
const searchQuery = ref<string>('');
const { t, setLocale, getProfileDisplayName } = useI18n();
let pollTimer: number | null = null;
let cleanThemeListener: (() => void) | null = null;

const activeProfile = computed<Profile | null>(() => {
  if (!settings.value) return null;
  return settings.value.profiles[settings.value.activeProfileId] || null;
});

const loadCurrentTab = async () => {
  if (typeof chrome === 'undefined' || !chrome.tabs) return;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (tab && tab.id) {
      currentTabId.value = tab.id;
      currentTabTitle.value = tab.title || '';
      try {
        const u = new URL(tab.url || '');
        currentTabHost.value = u.hostname;
      } catch {
        currentTabHost.value = '';
      }
      fetchData();
    }
  } catch (err) {
    console.error('Failed to query active tab:', err);
  }
};

const fetchData = () => {
  if (currentTabId.value <= 0 || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;

  // Heartbeat: keeps request monitoring alive across service worker restarts
  chrome.runtime.sendMessage({ type: 'START_TAB_MONITOR' });
  chrome.runtime.sendMessage(
    { type: 'GET_TAB_REQUESTS', tabId: currentTabId.value },
    (res) => {
      if (res && res.requests) {
        requests.value = res.requests;
      }
    }
  );

  chrome.runtime.sendMessage(
    { type: 'GET_TAB_ERRORS', tabId: currentTabId.value },
    (res) => {
      if (res && res.errors) {
        errors.value = res.errors;
      }
    }
  );
};

const refreshState = async () => {
  settings.value = await getSettings();
  applyTheme(settings.value?.theme);
  setLocale(resolveLocale(settings.value?.language));
  await loadCurrentTab();
};

const filteredRequests = computed(() => {
  return requests.value.filter((req) => {
    if (filterType.value === 'errors' && !req.error) {
      return false;
    }
    if (filterType.value === 'xhr' && req.type !== 'xmlhttprequest' && req.type !== 'fetch') {
      return false;
    }
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.trim().toLowerCase();
      return req.host.toLowerCase().includes(q) || req.url.toLowerCase().includes(q);
    }
    return true;
  });
});

const addQuickRule = (host: string) => {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  chrome.runtime.sendMessage(
    { type: 'ADD_HOST_RULE', pattern: host, profileId: 'proxy' },
    (res) => {
      if (res && res.success) {
        toast.success(`${t('popup.ruleAdded')}: *.${host}`);
        fetchData();
      } else {
        toast.error(res?.error || t('popup.addRuleFailed'));
      }
    }
  );
};

const clearLogs = () => {
  requests.value = [];
  errors.value = [];
  toast.info(t('sidepanel.logsCleared'));
};

const openOptions = async () => {
  if (typeof chrome === 'undefined') return;
  const optionsUrl = chrome.runtime.getURL('options.html');
  if (chrome.tabs?.query && chrome.tabs?.create) {
    const tabs = await chrome.tabs.query({ url: optionsUrl });
    if (tabs.length > 0 && tabs[0]?.id !== undefined) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      if (tabs[0].windowId) {
        await chrome.windows.update(tabs[0].windowId, { focused: true });
      }
      return;
    }
    await chrome.tabs.create({ url: optionsUrl });
  } else if (chrome.runtime?.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  }
};

onMounted(() => {
  chrome.runtime?.sendMessage?.({ type: 'START_TAB_MONITOR' });
  refreshState();
  document.title = `${t('sidepanel.title')} - ${t('sidepanel.subtitle')}`;
  pollTimer = window.setInterval(fetchData, 2000);
  cleanThemeListener = initThemeListener(() => settings.value?.theme);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (cleanThemeListener) cleanThemeListener();
  chrome.runtime?.sendMessage?.({ type: 'STOP_TAB_MONITOR' });
});
</script>

<template>
  <div class="flex flex-col h-screen select-none font-sans text-slate-800 dark:text-slate-100 bg-slate-50 dark:bg-slate-950">
    <Toaster position="bottom-center" rich-colors :duration="2000" />

    <!-- Header -->
    <header class="flex justify-between items-center px-4 py-3 border-b border-slate-200/80 dark:border-white/10 bg-white/80 dark:bg-slate-900/60 backdrop-blur-md shrink-0">
      <div class="flex items-center gap-2.5">
        <AppLogo size="sm" />
        <div class="flex flex-col">
          <h2 class="text-sm font-bold tracking-tight text-slate-900 dark:text-white leading-tight flex items-center gap-1.5">
            {{ t('sidepanel.title') }}
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          </h2>
          <span class="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{{ t('sidepanel.subtitle') }}</span>
        </div>
      </div>
      <div class="flex items-center gap-1.5">
        <UiButton
          variant="outline"
          size="icon"
          class="h-8 w-8 rounded-xl"
          :title="t('sidepanel.clear')"
          @click="clearLogs"
        >
          <Trash2 :size="14" />
        </UiButton>
        <UiButton
          variant="outline"
          size="icon"
          class="h-8 w-8 rounded-xl"
          :title="t('popup.openSettings')"
          @click="openOptions"
        >
          <Settings :size="14" />
        </UiButton>
      </div>
    </header>

    <!-- Active Status Card -->
    <div class="mx-4 mt-3 p-3 bg-white dark:bg-slate-900/70 border border-slate-200/80 dark:border-white/10 rounded-2xl shadow-xs flex flex-col gap-2 shrink-0">
      <div class="flex justify-between items-center">
        <span class="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
          <Shield :size="13" class="text-blue-500" />
          {{ t('popup.matchingProfile') }}
        </span>
        <span
          v-if="activeProfile"
          class="text-xs font-semibold text-white px-2.5 py-0.5 rounded-full shadow-xs flex items-center gap-1"
          :style="{ backgroundColor: activeProfile.color || '#3b82f6' }"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-white"></span>
          {{ getProfileDisplayName(activeProfile) }}
        </span>
      </div>
      <div class="flex justify-between items-center pt-2 border-t border-slate-100 dark:border-white/5">
        <span class="text-xs font-medium text-slate-500 dark:text-slate-400">{{ t('popup.currentTab') }}</span>
        <span class="text-xs font-semibold font-mono text-blue-600 dark:text-blue-400 max-w-[200px] truncate" :title="currentTabHost">
          {{ currentTabHost || t('sidepanel.noActiveTab') }}
        </span>
      </div>
    </div>

    <!-- Filter & Search Bar -->
    <div class="px-4 py-2.5 flex flex-col gap-2 shrink-0">
      <div class="flex gap-1 bg-slate-200/60 dark:bg-white/5 p-1 rounded-2xl border border-slate-200/80 dark:border-white/10">
        <button
          class="flex-1 py-1 px-2.5 rounded-xl text-xs font-medium transition-all cursor-pointer flex items-center justify-center gap-1"
          :class="filterType === 'all'
            ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-semibold'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'"
          @click="filterType = 'all'"
        >
          {{ t('sidepanel.allRequests') }}
          <UiBadge variant="outline" size="sm" class="px-1.5 py-0 text-[10px]">
            {{ requests.length }}
          </UiBadge>
        </button>
        <button
          class="flex-1 py-1 px-2.5 rounded-xl text-xs font-medium transition-all cursor-pointer flex items-center justify-center gap-1"
          :class="filterType === 'errors'
            ? 'bg-red-600 text-white shadow-xs font-semibold'
            : errors.length > 0 ? 'text-red-600 dark:text-red-400 font-bold' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'"
          @click="filterType = 'errors'"
        >
          {{ t('sidepanel.errors') }}
          <UiBadge v-if="errors.length > 0" variant="destructive" size="sm" class="px-1.5 py-0 text-[10px] bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-200 border-none">
            {{ errors.length }}
          </UiBadge>
        </button>
        <button
          class="flex-1 py-1 px-2.5 rounded-xl text-xs font-medium transition-all cursor-pointer"
          :class="filterType === 'xhr'
            ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-semibold'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'"
          @click="filterType = 'xhr'"
        >
          XHR / Fetch
        </button>
      </div>

      <div class="relative">
        <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <UiInput
          v-model="searchQuery"
          size="sm"
          class="pl-8"
          :placeholder="t('sidepanel.searchPlaceholder')"
        />
      </div>
    </div>

    <!-- Request List -->
    <div class="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-2">
      <div v-if="filteredRequests.length === 0" class="text-center text-slate-400 dark:text-slate-500 py-16 flex flex-col items-center justify-center">
        <div class="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-white/5 flex items-center justify-center mb-3">
          <Radio :size="24" class="opacity-40" />
        </div>
        <p class="text-xs font-medium">{{ t('sidepanel.noRequests') }}</p>
      </div>
      <TransitionGroup name="list" tag="div" class="flex flex-col gap-2">
        <div
          v-for="req in filteredRequests"
          :key="req.id"
          class="p-3 bg-white dark:bg-slate-900/70 border rounded-2xl shadow-xs transition-all duration-150 hover:border-slate-300 dark:hover:border-white/20 flex flex-col gap-2"
          :class="req.error ? 'border-red-300 dark:border-red-500/30 bg-red-50/40 dark:bg-red-500/5' : 'border-slate-200/80 dark:border-white/10'"
        >
        <div class="flex items-center gap-2 text-xs">
          <UiBadge variant="default" size="sm" class="font-mono font-bold text-[10px]">
            {{ req.method }}
          </UiBadge>
          <UiBadge
            v-if="req.error"
            variant="destructive"
            size="sm"
            class="max-w-[150px] truncate text-[10px]"
            :title="req.error"
          >
            {{ req.error.replace('net::', '') }}
          </UiBadge>
          <UiBadge
            v-else
            :variant="req.statusCode && req.statusCode < 400 ? 'success' : 'warning'"
            size="sm"
            class="font-mono text-[10px]"
          >
            {{ req.statusCode || 'OK' }}
          </UiBadge>
          <span class="ml-auto text-slate-400 dark:text-slate-500 text-[10px] font-mono">{{ new Date(req.timestamp).toLocaleTimeString() }}</span>
        </div>

        <div class="font-mono text-[11px] text-slate-700 dark:text-slate-300 break-all line-clamp-2 leading-relaxed" :title="req.url">
          {{ req.url }}
        </div>

        <div class="flex justify-between items-center pt-2 border-t border-slate-100 dark:border-white/5 text-xs">
          <span class="text-slate-500 dark:text-slate-400 font-mono text-[11px] truncate max-w-[180px]">{{ req.host }}</span>
          <UiButton
            variant="outline"
            size="sm"
            class="h-6 px-2.5 text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-500/10 border-blue-200 dark:border-blue-500/30"
            :title="t('sidepanel.quickRuleTooltip')"
            @click="addQuickRule(req.host)"
          >
            <Plus :size="11" />
            {{ t('sidepanel.quickRule') }}
          </UiButton>
        </div>
      </div>
    </TransitionGroup>
  </div>
</div>
</template>
