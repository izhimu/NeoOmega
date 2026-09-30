<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  Settings,
  Trash2,
  ChevronUp,
  ChevronDown,
  Globe,
  Palette,
  Download,
  Upload,
  Plus,
  ShieldAlert,
  Save,
  CheckCircle2,
  Sparkles,
  Menu,
  X,
  Eye,
  Copy,
  Search,
  Activity,
  Zap,
  Gauge,
  RefreshCw,
  Cloud,
} from 'lucide-vue-next';
import { Toaster, toast } from 'vue-sonner';
import { decodeRuleListText } from '../../src/core/parsers/autoproxy';
import { parseSwitchyOmegaBackup } from '../../src/core/parsers/switchyomega';
import { ProxyManager } from '../../src/core/proxy/proxy-manager';
import { DEFAULT_SETTINGS, getSettings, normalizeBypassList, saveSettings } from '../../src/core/storage/storage';
import type { AppSettings, ConditionType, FixedProfile, Profile, SwitchProfile } from '../../src/core/types';
import { useI18n, resolveLocale } from '../../src/core/i18n';
import { applyTheme, initThemeListener } from '../../src/core/theme';

import UiButton from '../../src/components/ui/UiButton.vue';
import UiInput from '../../src/components/ui/UiInput.vue';
import UiSelect from '../../src/components/ui/UiSelect.vue';
import UiSwitch from '../../src/components/ui/UiSwitch.vue';
import UiDialog from '../../src/components/ui/UiDialog.vue';
import UiConfirmDialog from '../../src/components/ui/UiConfirmDialog.vue';
import UiBadge from '../../src/components/ui/UiBadge.vue';
import AppLogo from '../../src/components/ui/AppLogo.vue';

const settings = ref<AppSettings>(DEFAULT_SETTINGS);
const activeTab = ref<string>('profile:proxy'); // 'profile:<id>' | 'backup'
const mobileMenuOpen = ref(false);
const { t, setLocale, getProfileDisplayName } = useI18n();
let cleanThemeListener: (() => void) | null = null;

const selectTab = (tab: string) => {
  activeTab.value = tab;
  mobileMenuOpen.value = false;
};

const openAddModal = () => {
  mobileMenuOpen.value = false;
  showAddModal.value = true;
};
// Add profile modal
const showAddModal = ref(false);
const newProfileName = ref('');
const newProfileType = ref<'FixedProfile' | 'SwitchProfile'>('FixedProfile');

// Delete profile confirm modal
const showDeleteConfirm = ref(false);
const profileToDeleteId = ref<string>('');
const profileToDeleteName = computed(() => getProfileDisplayName(settings.value.profiles[profileToDeleteId.value]) || profileToDeleteId.value);

const presetColors = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#64748b'];
const currentProfileId = computed(() => {
  if (activeTab.value.startsWith('profile:')) {
    return activeTab.value.slice(8);
  }
  return '';
});

const currentProfile = computed(() => {
  if (!currentProfileId.value) return null;
  return settings.value.profiles[currentProfileId.value] || null;
});

const activeProfileView = computed<Profile | null>(() => {
  if (activeTab.value.startsWith('profile:') && currentProfile.value) {
    return currentProfile.value;
  }
  return null;
});

const fixedProfile = computed<FixedProfile | null>(() => {
  const p = activeProfileView.value;
  return p?.profileType === 'FixedProfile' ? (p as FixedProfile) : null;
});

const switchProfile = computed<SwitchProfile | null>(() => {
  const p = activeProfileView.value;
  return p?.profileType === 'SwitchProfile' ? (p as SwitchProfile) : null;
});

const loadSettings = async () => {
  settings.value = await getSettings();
  applyTheme(settings.value.theme);
  setLocale(resolveLocale(settings.value.language));
  if (settings.value?.profiles) {
    for (const profile of Object.values(settings.value.profiles)) {
      if (profile.profileType === 'FixedProfile') {
        const fp = profile as FixedProfile;
        if (!fp.fallbackProxy) {
          fp.fallbackProxy = { host: '127.0.0.1', port: 7890, scheme: 'http' };
        }
        fp.bypassList = normalizeBypassList(fp.bypassList);
      } else if (profile.profileType === 'SwitchProfile') {
        const sp = profile as SwitchProfile;
        if (!sp.rules) sp.rules = [];
      }
    }
  }
  if (!Array.isArray(settings.value.order)) {
    settings.value.order = Object.values(settings.value.order || {}).map(String);
  }
  if (settings.value.order.length > 0 && !settings.value.profiles[currentProfileId.value]) {
    activeTab.value = `profile:${settings.value.order[0]}`;
  }
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get('neo_omega_latency_cache').then((cache) => {
      if (cache?.neo_omega_latency_cache) {
        speedTestResults.value = cache.neo_omega_latency_cache as Record<string, SpeedTestResult>;
      }
    });
  }
};

const saveCurrentSettings = async () => {
  await saveSettings(settings.value);
  applyTheme(settings.value.theme);
  await ProxyManager.applyCurrentActive();
  toast.success(t('options.profileSaved'));
};

const changeLanguage = async (lang: 'auto' | 'zh_CN' | 'en') => {
  settings.value.language = lang;
  setLocale(resolveLocale(lang));
  await saveCurrentSettings();
  document.title = `${t('options.brand')} - ${t('options.brandSub')}`;
  toast.success(t('options.profileSaved'));
};

const promptDeleteProfile = (id: string) => {
  if (['direct', 'system'].includes(id)) {
    toast.error(t('options.cannotDeleteBuiltin'));
    return;
  }
  profileToDeleteId.value = id;
  showDeleteConfirm.value = true;
};

const confirmDeleteProfile = async () => {
  const id = profileToDeleteId.value;
  if (!id) return;

  delete settings.value.profiles[id];
  const currentOrder: string[] = Array.isArray(settings.value.order)
    ? settings.value.order
    : Object.values(settings.value.order || {}).map(String);
  settings.value.order = currentOrder.filter((i) => i !== id);
  if (settings.value.activeProfileId === id) {
    settings.value.activeProfileId = 'system';
  }
  await saveCurrentSettings();
  activeTab.value = `profile:${settings.value.order[0] || 'direct'}`;
  showDeleteConfirm.value = false;
  toast.success(t('options.profileDeleted'));
};

const createProfile = async () => {
  const name = newProfileName.value.trim();
  if (!name) return;

  const id = `profile_${Date.now()}`;
  let newProfile: Profile;

  if (newProfileType.value === 'FixedProfile') {
    newProfile = {
      id,
      name,
      profileType: 'FixedProfile',
      color: '#3b82f6',
      fallbackProxy: { host: '127.0.0.1', port: 7890, scheme: 'http' },
      bypassList: [{ id: `bp_${Date.now()}`, pattern: '<local>', conditionType: 'BypassCondition' }],
    };
  } else {
    newProfile = {
      id,
      name,
      profileType: 'SwitchProfile',
      color: '#10b981',
      defaultProfileId: 'direct',
      rules: [],
    };
  }

  settings.value.profiles[id] = newProfile;
  settings.value.order.push(id);
  await saveCurrentSettings();

  showAddModal.value = false;
  newProfileName.value = '';
  activeTab.value = `profile:${id}`;
  toast.success(t('options.profileSaved'));
};

// Switch Rule Management
const addRule = (profile: SwitchProfile) => {
  profile.rules.push({
    id: `rule_${Date.now()}`,
    enabled: true,
    condition: { conditionType: 'HostWildcardCondition', pattern: '' },
    profileId: 'proxy',
  });
};

const removeRule = (profile: SwitchProfile, index: number) => {
  profile.rules.splice(index, 1);
};

const moveRule = (profile: SwitchProfile, index: number, delta: number) => {
  const newIndex = index + delta;
  if (newIndex < 0 || newIndex >= profile.rules.length) return;
  const temp = profile.rules[index];
  if (!temp) return;
  profile.rules[index] = profile.rules[newIndex]!;
  profile.rules[newIndex] = temp;
};

// Online Rule List Management
const updatingRuleList = ref(false);

const toggleRuleList = async (profile: SwitchProfile) => {
  if (!profile.ruleList) {
    profile.ruleList = {
      id: `rulelist_${Date.now()}`,
      url: 'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt',
      format: 'autoproxy',
      matchProfileId: 'proxy',
      defaultProfileId: profile.defaultProfileId || 'direct',
      updateIntervalMinutes: 1440,
      enabled: true,
    };
  } else {
    profile.ruleList.enabled = !profile.ruleList.enabled;
  }
  await saveCurrentSettings();
};

const updateRuleListNow = async (profileId: string) => {
  const profile = settings.value.profiles[profileId] as SwitchProfile | undefined;
  if (!profile?.ruleList?.url?.trim()) {
    toast.error(t('options.ruleListUrlRequired'));
    return;
  }
  updatingRuleList.value = true;
  await saveCurrentSettings();
  chrome.runtime.sendMessage(
    { type: 'UPDATE_RULE_LIST', profileId, ruleList: profile.ruleList },
    (res) => {
      updatingRuleList.value = false;
      if (res && res.success) {
        toast.success(`${t('options.ruleListUpdateSuccess')} (${res.count} ${t('options.cachedRules')})`);
        loadSettings();
      } else {
        toast.error(res?.error || t('options.ruleListUpdateFailed'));
      }
    }
  );
};

const showRuleListModal = ref(false);
const ruleListSearchQuery = ref('');
const ruleListDisplayLimit = ref(200);

const currentRuleListLines = computed(() => {
  if (!switchProfile.value?.ruleList?.rulesCache) return [];
  const raw = switchProfile.value.ruleList.rulesCache.join('\n');
  const decoded = decodeRuleListText(raw);
  return decoded.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
});

const filteredRuleListLines = computed(() => {
  const query = ruleListSearchQuery.value.trim().toLowerCase();
  if (!query) return currentRuleListLines.value;
  return currentRuleListLines.value.filter(line => line.toLowerCase().includes(query));
});

const openRuleListModal = () => {
  ruleListSearchQuery.value = '';
  ruleListDisplayLimit.value = 200;
  showRuleListModal.value = true;
};

const copyRuleList = async () => {
  if (!currentRuleListLines.value.length) return;
  await navigator.clipboard.writeText(currentRuleListLines.value.join('\n'));
  toast.success(t('options.rulesCopied'));
};

const loadMoreRules = () => {
  ruleListDisplayLimit.value += 200;
};

interface SpeedTestResult {
  success: boolean;
  latency?: number;
  speedMBps?: number;
  speedMbps?: number;
  totalBytes?: number;
  durationSec?: number;
  mode?: 'latency' | 'bandwidth';
  status?: number;
  statusText?: string;
  error?: string;
  testUrl: string;
  timestamp: number;
}

const formatBytes = (bytes?: number) => {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};
const isTestingSpeed = ref(false);
const isTestingBandwidth = ref(false);
const speedTestMode = ref<'latency' | 'bandwidth'>('latency');
const speedTestResults = ref<Record<string, SpeedTestResult>>({});
const speedTestTarget = ref('http://cp.cloudflare.com/generate_204');
const bandwidthTarget = ref('https://speed.cloudflare.com/__down?bytes=5000000');

const speedTestTargetOptions = computed(() => [
  { value: 'http://cp.cloudflare.com/generate_204', label: 'Cloudflare (HTTP 204)' },
  { value: 'https://www.google.com/generate_204', label: 'Google (HTTPS 204)' },
  { value: 'http://www.gstatic.com/generate_204', label: 'Gstatic (HTTP 204)' },
  { value: 'https://www.qualcomm.cn/generate_204', label: 'Domestic (HTTP 204)' },
]);

const bandwidthTargetOptions = computed(() => [
  { value: 'https://speed.cloudflare.com/__down?bytes=5000000', label: 'Cloudflare 5 MB' },
  { value: 'https://speed.cloudflare.com/__down?bytes=10000000', label: 'Cloudflare 10 MB' },
  { value: 'https://speed.cloudflare.com/__down?bytes=1000000', label: 'Cloudflare 1 MB' },
  { value: 'https://speed.cloudflare.com/__down?bytes=25000000', label: 'Cloudflare 25 MB' },
]);

const currentProfileSpeedTest = computed(() => {
  if (!fixedProfile.value) return null;
  return speedTestResults.value[fixedProfile.value.id] || null;
});

const runSpeedTest = async (mode: 'latency' | 'bandwidth' = 'latency') => {
  const fp = fixedProfile.value;
  if (!fp || !fp.fallbackProxy?.host || !fp.fallbackProxy?.port) {
    toast.error(t('options.speedTestHostMissing'));
    return;
  }
  if (mode === 'bandwidth') {
    isTestingBandwidth.value = true;
  } else {
    isTestingSpeed.value = true;
  }
  const proxyPayload = JSON.parse(JSON.stringify(fp.fallbackProxy));
  const targetUrl = mode === 'bandwidth' ? bandwidthTarget.value : speedTestTarget.value;

  chrome.runtime.sendMessage(
    {
      type: 'TEST_PROXY',
      proxy: proxyPayload,
      testUrl: targetUrl,
      mode,
    },
    (res: any) => {
      isTestingSpeed.value = false;
      isTestingBandwidth.value = false;
      if (chrome.runtime.lastError) {
        console.error('Speed test runtime error:', chrome.runtime.lastError);
        toast.error(`${t('options.speedTestFailed')}: ${chrome.runtime.lastError.message}`);
        return;
      }
      if (res) {
        speedTestResults.value[fp.id] = {
          ...res,
          timestamp: Date.now(),
        };
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.set({ neo_omega_latency_cache: speedTestResults.value });
        }
        if (res.success) {
          if (res.speedMBps !== undefined) {
            toast.success(`${t('options.bandwidthSpeed')}: ${res.speedMbps} Mbps (${res.speedMBps} MB/s) · ${res.latency} ms`);
          } else {
            toast.success(`${t('options.speedTestTitle')}: ${res.latency} ms (${res.status || 'OK'})`);
          }
        } else {
          toast.error(`${t('options.speedTestFailed')}: ${res.error || 'Unknown error'}`);
        }
      } else if (!chrome.runtime.lastError) {
        toast.error(t('options.speedTestFailed'));
      }
    }
  );
};
// Bypass Pattern Management
const updateProxyUsername = (val: string) => {
  const fp = fixedProfile.value;
  if (!fp || !fp.fallbackProxy) return;
  if (!fp.fallbackProxy.auth) fp.fallbackProxy.auth = {};
  fp.fallbackProxy.auth.username = val;
};

const updateProxyPassword = (val: string) => {
  const fp = fixedProfile.value;
  if (!fp || !fp.fallbackProxy) return;
  if (!fp.fallbackProxy.auth) fp.fallbackProxy.auth = {};
  fp.fallbackProxy.auth.password = val;
};

const bypassMode = ref<'textarea' | 'list'>('textarea');

const bypassText = computed({
  get(): string {
    const fp = fixedProfile.value;
    if (!fp || !Array.isArray(fp.bypassList)) return '';
    return fp.bypassList.map((b) => b?.pattern || '').filter(Boolean).join('\n');
  },
  set(val: string) {
    const fp = fixedProfile.value;
    if (!fp) return;
    fp.bypassList = normalizeBypassList(val);
  },
});

const addBypassPreset = (pattern: string) => {
  const fp = fixedProfile.value;
  if (!fp) return;
  if (!Array.isArray(fp.bypassList)) fp.bypassList = [];
  if (!fp.bypassList.some((b) => b.pattern === pattern)) {
    fp.bypassList.push({
      id: `bp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      pattern,
      conditionType: 'BypassCondition',
    });
  }
};

const clearAllBypass = () => {
  const fp = fixedProfile.value;
  if (!fp) return;
  fp.bypassList = [];
};

const addBypass = () => {
  const fp = fixedProfile.value;
  if (!fp) return;
  if (!Array.isArray(fp.bypassList)) fp.bypassList = [];
  fp.bypassList.push({
    id: `bp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    pattern: '',
    conditionType: 'BypassCondition',
  });
};

const removeBypass = (indexOrId: number | string) => {
  const fp = fixedProfile.value;
  if (!fp || !Array.isArray(fp.bypassList)) return;
  if (typeof indexOrId === 'string') {
    const idx = fp.bypassList.findIndex((item) => item.id === indexOrId);
    if (idx !== -1) {
      fp.bypassList.splice(idx, 1);
    }
  } else if (indexOrId >= 0 && indexOrId < fp.bypassList.length) {
    fp.bypassList.splice(indexOrId, 1);
  }
};

const addFallbackServer = () => {
  const fp = fixedProfile.value;
  if (!fp) return;
  if (!Array.isArray(fp.fallbackServers)) fp.fallbackServers = [];
  fp.fallbackServers.push({ scheme: 'http', host: '', port: 7890 });
};
const removeFallbackServer = (idx: number) => {
  fixedProfile.value?.fallbackServers?.splice(idx, 1);
};

// Backup Import / Export
const handleFileImport = async (e: Event) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (evt) => {
    const text = evt.target?.result as string;
    try {
      const imported = parseSwitchyOmegaBackup(text);
      settings.value = imported;
      await saveCurrentSettings();
      toast.success(t('options.importSuccess'));
      activeTab.value = `profile:${imported.order[0]}`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`${t('options.importFailed')}: ${message}`);
    }
  };
  reader.readAsText(file);
};

const exportBackup = () => {
  const blob = new Blob([JSON.stringify(settings.value, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `NeoOmega_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(t('options.backupExported'));
};

// Options for UI Selects
const allProfileSelectOptions = computed(() => {
  const order: string[] = Array.isArray(settings.value?.order)
    ? settings.value.order
    : Object.values(settings.value?.order || {}).map(String);
  return order.map((id) => ({
    value: id,
    label: getProfileDisplayName(settings.value.profiles[id]) || id,
  }));
});

const defaultProfileSelectOptions = computed(() => {
  const order: string[] = Array.isArray(settings.value?.order)
    ? settings.value.order
    : Object.values(settings.value?.order || {}).map(String);
  return order
    .filter((id) => id !== currentProfileId.value)
    .map((id) => ({
      value: id,
      label: getProfileDisplayName(settings.value.profiles[id]) || id,
    }));
});

const conditionTypeOptions = computed(() => [
  { value: 'HostWildcardCondition', label: t('conditions.HostWildcardCondition') },
  { value: 'HostRegexCondition', label: t('conditions.HostRegexCondition') },
  { value: 'UrlWildcardCondition', label: t('conditions.UrlWildcardCondition') },
  { value: 'UrlRegexCondition', label: t('conditions.UrlRegexCondition') },
  { value: 'IpCondition', label: t('conditions.IpCondition') },
  { value: 'KeywordCondition', label: t('conditions.KeywordCondition') },
]);

const schemeOptions = [
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
  { value: 'socks4', label: 'SOCKS4' },
  { value: 'socks5', label: 'SOCKS5' },
];

const ruleListFormatOptions = computed(() => [
  { value: 'autoproxy', label: t('options.ruleListFormatAutoProxy') },
  { value: 'switchy', label: t('options.ruleListFormatSwitchy') },
]);
const langOptions = computed(() => [
  { value: 'auto', label: t('options.langAuto') },
  { value: 'zh_CN', label: t('options.langZh') },
  { value: 'en', label: t('options.langEn') },
]);

const themeOptions = computed(() => [
  { value: 'auto', label: t('options.themeAuto') },
  { value: 'light', label: t('options.themeLight') },
  { value: 'dark', label: t('options.themeDark') },
]);

const profileTypeOptions = computed(() => [
  { value: 'FixedProfile', label: t('options.fixedType') },
  { value: 'SwitchProfile', label: t('options.switchType') },
]);

onMounted(() => {
  loadSettings();
  cleanThemeListener = initThemeListener(() => settings.value?.theme);
  document.title = `${t('options.brand')} - ${t('options.brandSub')}`;
});
onUnmounted(() => {
  if (cleanThemeListener) cleanThemeListener();
});
</script>

<template>
  <div class="flex flex-col md:flex-row min-h-screen w-full bg-slate-50 dark:bg-slate-950 font-sans text-slate-800 dark:text-slate-100 select-none">
    <Toaster position="top-right" rich-colors :duration="3000" />

    <!-- Mobile Header -->
    <header class="md:hidden flex items-center justify-between px-4 py-3 bg-white/80 dark:bg-slate-900/80 border-b border-slate-200/80 dark:border-white/10 backdrop-blur-md sticky top-0 z-30 shrink-0">
      <div class="flex items-center gap-2.5">
        <AppLogo size="sm" />
        <div class="flex flex-col">
          <span class="text-xs font-bold tracking-tight text-slate-900 dark:text-white leading-tight flex items-center gap-1">
            {{ t('options.brand') }}
            <UiBadge variant="primary" size="sm" class="px-1 py-0 text-[8px] font-bold">v0.1</UiBadge>
          </span>
          <span class="text-[10px] text-slate-400 dark:text-slate-500 font-medium">{{ t('options.brandSub') }}</span>
        </div>
      </div>
      <UiButton
        variant="outline"
        size="icon"
        class="h-8 w-8 rounded-xl cursor-pointer"
        @click="mobileMenuOpen = !mobileMenuOpen"
      >
        <Menu v-if="!mobileMenuOpen" :size="16" />
        <X v-else :size="16" />
      </UiButton>
    </header>

    <!-- Mobile Drawer Backdrop -->
    <div
      v-if="mobileMenuOpen"
      class="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs md:hidden"
      @click="mobileMenuOpen = false"
    />

    <!-- Sidebar -->
    <aside
      class="fixed inset-y-0 left-0 z-50 w-72 md:w-68 lg:w-76 bg-white/95 dark:bg-slate-900/95 md:bg-white/70 md:dark:bg-slate-900/60 border-r border-slate-200/80 dark:border-white/10 flex flex-col backdrop-blur-xl shrink-0 transition-transform duration-200 ease-in-out md:static md:translate-x-0"
      :class="mobileMenuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0'"
    >
      <div class="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200/80 dark:border-white/10">
        <div class="flex items-center gap-3">
          <AppLogo size="md" />
          <div class="flex flex-col">
            <span class="text-sm font-bold tracking-tight text-slate-900 dark:text-white leading-tight flex items-center gap-1.5">
              {{ t('options.brand') }}
              <UiBadge variant="primary" size="sm" class="px-1.5 py-0 text-[9px] font-bold">v0.1</UiBadge>
            </span>
            <span class="text-[11px] text-slate-400 dark:text-slate-500 font-medium">{{ t('options.brandSub') }}</span>
          </div>
        </div>
        <button
          type="button"
          class="md:hidden p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
          @click="mobileMenuOpen = false"
        >
          <X :size="18" />
        </button>
      </div>

      <nav class="p-3.5 sm:p-4 flex-1 overflow-y-auto flex flex-col gap-2">
        <div class="text-[10px] font-bold text-slate-400 dark:text-slate-500 tracking-wider px-2.5 py-1 uppercase">{{ t('options.profilesNav') }}</div>

        <div
          v-for="id in settings.order"
          :key="id"
          class="group flex items-center gap-3 px-3.5 py-3 rounded-2xl cursor-pointer transition-all duration-150 border min-h-[46px]"
          :class="activeTab === `profile:${id}`
            ? 'bg-blue-50/80 dark:bg-slate-800/90 border-blue-500/30 dark:border-blue-500/50 text-blue-700 dark:text-blue-300 font-semibold shadow-xs'
            : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100/80 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white'"
          @click="selectTab(`profile:${id}`)"
        >
          <span
            class="w-3 h-3 rounded-full shrink-0 transition-transform group-hover:scale-125"
            :style="{ backgroundColor: settings.profiles[id]?.color || '#94a3b8', boxShadow: `0 0 6px ${settings.profiles[id]?.color || '#94a3b8'}80` }"
          />
          <span class="flex-1 text-xs truncate leading-normal">{{ getProfileDisplayName(settings.profiles[id]) || id }}</span>
          <span
            v-if="speedTestResults[id]"
            class="text-[10px] font-mono px-1.5 py-0.5 rounded-md shrink-0 font-medium"
            :class="speedTestResults[id].success
              ? (speedTestResults[id].speedMbps !== undefined
                  ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200/50 dark:border-indigo-500/20'
                  : (speedTestResults[id].latency! < 300
                      ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10'
                      : 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10'))
              : 'text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-500/10'"
            :title="speedTestResults[id].success ? (speedTestResults[id].speedMbps !== undefined ? `${speedTestResults[id].speedMbps} Mbps (${speedTestResults[id].speedMBps} MB/s) · ${speedTestResults[id].latency}ms` : `${speedTestResults[id].latency}ms`) : (speedTestResults[id].error || 'Error')"
          >
            {{ speedTestResults[id].success
              ? (speedTestResults[id].speedMbps !== undefined
                  ? `${speedTestResults[id].speedMbps} Mbps`
                  : `${speedTestResults[id].latency}ms`)
              : 'ERR' }}
          </span>
          <UiBadge
            v-if="settings.activeProfileId === id"
            variant="primary"
            class="bg-blue-600 text-white border-transparent px-1.5 py-0.5 text-[10px] font-bold"
          >
            {{ t('options.activeBadge') }}
          </UiBadge>
        </div>

        <UiButton
          variant="dashed"
          size="md"
          class="w-full mt-2 h-11 rounded-2xl font-medium"
          @click="openAddModal"
        >
          <Plus :size="15" />
          {{ t('options.newProfile') }}
        </UiButton>

        <div class="text-[10px] font-bold text-slate-400 dark:text-slate-500 tracking-wider px-2.5 pt-4 pb-1 uppercase">{{ t('options.toolsNav') }}</div>

        <div
          class="flex items-center gap-3 px-3.5 py-3 rounded-2xl cursor-pointer transition-all duration-150 border min-h-[46px]"
          :class="activeTab === 'backup'
            ? 'bg-blue-50/80 dark:bg-slate-800/90 border-blue-500/30 dark:border-blue-500/50 text-blue-700 dark:text-blue-300 font-semibold shadow-xs'
            : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100/80 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white'"
          @click="selectTab('backup')"
        >
          <Settings :size="16" class="text-indigo-600 dark:text-indigo-400" />
          <span class="text-xs">{{ t('options.generalSettings') }}</span>
        </div>
      </nav>
    </aside>

    <!-- Main Content Area -->
    <main class="flex-1 w-full min-w-0 p-4 sm:p-6 md:p-8 lg:p-10 overflow-y-auto bg-slate-50/70 dark:bg-slate-950">
      <!-- Profile View -->
        <div
          v-if="activeProfileView"
          :key="activeTab"
          class="w-full bg-white dark:bg-slate-900/70 border border-slate-200/80 dark:border-white/10 rounded-2xl md:rounded-3xl p-5 sm:p-6 md:p-8 shadow-xs dark:shadow-2xl mb-8 flex flex-col gap-6 backdrop-blur-md"
        >
          <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-5 border-b border-slate-100 dark:border-white/10">
            <div class="flex items-center gap-3 min-w-0">
              <span
                class="w-4 h-4 rounded-full shrink-0 shadow-sm"
                :style="{ backgroundColor: activeProfileView.color || '#3b82f6', boxShadow: `0 0 10px ${activeProfileView.color || '#3b82f6'}80` }"
              />
              <h2 class="text-xl font-bold tracking-tight text-slate-900 dark:text-white truncate">{{ getProfileDisplayName(activeProfileView) }}</h2>
              <UiBadge variant="outline" size="sm" class="font-mono text-[11px] shrink-0">
                {{ activeProfileView.profileType }}
              </UiBadge>
            </div>
            <div class="flex items-center gap-2.5 self-end sm:self-auto shrink-0">
              <UiButton
                v-if="!['direct', 'system'].includes(activeProfileView.id)"
                variant="destructive"
                @click="promptDeleteProfile(activeProfileView.id)"
              >
                <Trash2 :size="13" />
                {{ t('common.delete') }}
              </UiButton>
              <UiButton
                variant="primary"
                size="sm"
                @click="saveCurrentSettings"
              >
                <Save :size="14" />
                {{ t('options.saveProfile') }}
              </UiButton>
            </div>
          </div>

          <!-- Basic Info & Color swatch -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div class="flex flex-col gap-2">
              <label class="text-xs font-semibold text-slate-700 dark:text-slate-300">{{ t('options.modalProfileName') }}</label>
              <UiInput v-model="activeProfileView.name" :placeholder="t('options.profileNamePlaceholder')" />
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-xs font-semibold text-slate-700 dark:text-slate-300">{{ t('options.themeColor') }}</label>
              <div class="flex items-center gap-2 pt-1">
                <button
                  v-for="c in presetColors"
                  :key="c"
                  type="button"
                  class="w-7 h-7 rounded-full transition-transform hover:scale-110 active:scale-95 border-2 cursor-pointer flex items-center justify-center"
                  :class="activeProfileView.color === c ? 'border-slate-800 dark:border-white scale-110 shadow-sm' : 'border-transparent'"
                  :style="{ backgroundColor: c }"
                  @click="activeProfileView.color = c"
                >
                  <CheckCircle2 v-if="activeProfileView.color === c" :size="12" class="text-white drop-shadow-sm" />
                </button>
              </div>
            </div>
          </div>

        <!-- Fixed Profile Editor -->
        <div v-if="fixedProfile" class="flex flex-col gap-5 pt-2">
          <h3 class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Sparkles :size="16" class="text-blue-600 dark:text-blue-400" />
            {{ t('options.serverConfig') }}
          </h3>
          <div v-if="fixedProfile.fallbackProxy" class="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
            <div class="flex flex-col gap-2">
              <label class="text-xs font-semibold text-slate-700 dark:text-slate-300">{{ t('options.scheme') }}</label>
              <UiSelect
                v-model="fixedProfile.fallbackProxy.scheme"
                :options="schemeOptions"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-xs font-semibold text-slate-700 dark:text-slate-300">{{ t('options.host') }}</label>
              <UiInput v-model="fixedProfile.fallbackProxy.host" placeholder="127.0.0.1" />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-xs font-semibold text-slate-700 dark:text-slate-300">{{ t('options.port') }}</label>
              <UiInput
                :model-value="fixedProfile.fallbackProxy.port"
                type="number"
                placeholder="7890"
                @update:model-value="fixedProfile.fallbackProxy.port = Number($event)"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-xs font-semibold text-slate-700 dark:text-slate-300">{{ t('options.username') }}</label>
              <UiInput
                :model-value="fixedProfile.fallbackProxy.auth?.username || ''"
                :placeholder="t('options.usernamePlaceholder')"
                @update:model-value="updateProxyUsername"
              />
            </div>
            <div class="flex flex-col gap-2 md:col-span-2">
              <label class="text-xs font-semibold text-slate-700 dark:text-slate-300">{{ t('options.password') }}</label>
              <UiInput
                type="password"
                :model-value="fixedProfile.fallbackProxy.auth?.password || ''"
                :placeholder="t('options.passwordPlaceholder')"
                @update:model-value="updateProxyPassword"
              />
            </div>
          </div>

          <!-- Failover proxy chain -->
          <div class="flex flex-col gap-3 w-full">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-sm font-bold text-slate-900 dark:text-white">{{ t('options.fallbackServersTitle') }}</h3>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{{ t('options.fallbackServersDesc') }}</p>
              </div>
              <UiButton variant="outline" size="sm" @click="addFallbackServer">
                <Plus :size="14" />
                {{ t('options.fallbackServersAdd') }}
              </UiButton>
            </div>
            <div
              v-for="(srv, idx) in (fixedProfile.fallbackServers || [])"
              :key="idx"
              class="flex gap-2 items-center"
            >
              <UiSelect v-model="srv.scheme" :options="schemeOptions" class="w-32" />
              <UiInput v-model="srv.host" placeholder="host" class="flex-1" />
              <UiInput
                :model-value="srv.port"
                type="number"
                placeholder="port"
                class="w-28"
                @update:model-value="srv.port = Number($event)"
              />
              <UiButton variant="ghost" size="sm" @click="removeFallbackServer(idx)">
                <X :size="14" />
              </UiButton>
            </div>
          </div>

          <!-- Speed Test Card -->
          <div class="p-4 rounded-2xl border border-slate-200/80 dark:border-white/10 bg-slate-100/50 dark:bg-slate-900/40 flex flex-col gap-3">
            <!-- Controls Row -->
            <div class="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
              <div class="flex flex-col gap-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Activity :size="14" class="text-blue-600 dark:text-blue-400" />
                    {{ t('options.speedTestTitle') }}
                  </span>
                  <template v-if="currentProfileSpeedTest">
                    <span
                      v-if="currentProfileSpeedTest.success"
                      class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold font-mono border"
                      :class="currentProfileSpeedTest.speedMBps !== undefined
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20'
                        : (currentProfileSpeedTest.latency! < 300
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20'
                            : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border-amber-200 dark:border-amber-500/20')"
                    >
                      <span class="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span v-if="currentProfileSpeedTest.speedMBps !== undefined">
                        {{ currentProfileSpeedTest.speedMbps }} Mbps ({{ currentProfileSpeedTest.speedMBps }} MB/s)
                      </span>
                      <span :class="{ 'opacity-60': currentProfileSpeedTest.speedMBps !== undefined }">
                        {{ currentProfileSpeedTest.latency }} ms
                      </span>
                    </span>
                    <span
                      v-else
                      class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold font-mono border bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 border-red-200 dark:border-red-500/20"
                    >
                      <span class="w-1.5 h-1.5 rounded-full bg-red-500" />
                      {{ t('options.speedTestFailed') }}
                    </span>
                  </template>
                  <span v-if="currentProfileSpeedTest && !currentProfileSpeedTest.success" class="text-[11px] text-red-500 dark:text-red-400 truncate max-w-[200px]" :title="currentProfileSpeedTest.error">
                    ({{ currentProfileSpeedTest.error }})
                  </span>
                </div>
                <span class="text-[11px] text-slate-500 dark:text-slate-400">
                  {{ t('options.speedTestDesc') }}
                </span>
              </div>
              <div class="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
                <!-- Mode Selector -->
                <div class="flex items-center gap-1 bg-slate-200/60 dark:bg-white/5 p-1 rounded-xl text-xs">
                  <button
                    type="button"
                    class="px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer text-xs flex items-center gap-1"
                    :class="speedTestMode === 'latency' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-semibold' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'"
                    @click="speedTestMode = 'latency'"
                  >
                    <Zap :size="12" />
                    {{ t('options.testSpeed') }}
                  </button>
                  <button
                    type="button"
                    class="px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer text-xs flex items-center gap-1"
                    :class="speedTestMode === 'bandwidth' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-semibold' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'"
                    @click="speedTestMode = 'bandwidth'"
                  >
                    <Gauge :size="12" />
                    {{ t('options.testBandwidth') }}
                  </button>
                </div>

                <!-- Target Dropdown -->
                <UiSelect
                  v-if="speedTestMode === 'latency'"
                  v-model="speedTestTarget"
                  size="sm"
                  :options="speedTestTargetOptions"
                  class="w-44 text-xs"
                />
                <UiSelect
                  v-else
                  v-model="bandwidthTarget"
                  size="sm"
                  :options="bandwidthTargetOptions"
                  class="w-44 text-xs"
                />

                <!-- Trigger Button -->
                <UiButton
                  type="button"
                  variant="outline"
                  size="sm"
                  :loading="speedTestMode === 'bandwidth' ? isTestingBandwidth : isTestingSpeed"
                  class="flex items-center gap-1.5 shrink-0 font-medium"
                  @click="runSpeedTest(speedTestMode)"
                >
                  <component :is="speedTestMode === 'bandwidth' ? Gauge : Zap" :size="14" />
                  {{ (speedTestMode === 'bandwidth' ? isTestingBandwidth : isTestingSpeed)
                    ? (speedTestMode === 'bandwidth' ? t('options.testingBandwidth') : t('options.testingSpeed'))
                    : (speedTestMode === 'bandwidth' ? t('options.testBandwidth') : t('options.testSpeed')) }}
                </UiButton>
              </div>
            </div>

            <!-- Testing in progress indicator -->
            <div
              v-if="isTestingBandwidth || isTestingSpeed"
              class="pt-2 border-t border-slate-200/60 dark:border-white/5 flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 font-medium"
            >
              <span class="relative flex h-2 w-2">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span class="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
              </span>
              <span>{{ isTestingBandwidth ? t('options.measuringBandwidth') : t('options.testingSpeed') }}</span>
            </div>

            <!-- Dedicated Bandwidth Metrics Dashboard -->
            <div
              v-else-if="currentProfileSpeedTest && currentProfileSpeedTest.success && currentProfileSpeedTest.speedMbps !== undefined"
              class="pt-3 border-t border-slate-200/80 dark:border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-2.5"
            >
              <!-- 1. 带宽大小 (Bandwidth) -->
              <div class="flex flex-col p-3 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-emerald-200/60 dark:border-emerald-500/20 shadow-xs">
                <span class="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  <Gauge :size="12" class="text-emerald-500" />
                  {{ t('options.bandwidthSize') }}
                </span>
                <div class="mt-1 flex items-baseline gap-1">
                  <span class="text-xl font-extrabold font-mono text-emerald-600 dark:text-emerald-400 leading-tight">
                    {{ currentProfileSpeedTest.speedMbps }}
                  </span>
                  <span class="text-xs font-semibold text-emerald-600/80 dark:text-emerald-400/80">Mbps</span>
                </div>
                <span class="text-[10px] text-slate-400 font-mono mt-0.5">
                  ≈ {{ currentProfileSpeedTest.speedMBps }} MB/s
                </span>
              </div>

              <!-- 2. 网络延迟 (Latency) -->
              <div class="flex flex-col p-3 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/60 dark:border-white/5 shadow-xs">
                <span class="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  <Zap :size="12" class="text-amber-500" />
                  {{ t('options.latency') }}
                </span>
                <div class="mt-1 flex items-baseline gap-1">
                  <span
                    class="text-xl font-extrabold font-mono leading-tight"
                    :class="currentProfileSpeedTest.latency! < 300 ? 'text-slate-900 dark:text-white' : 'text-amber-600 dark:text-amber-400'"
                  >
                    {{ currentProfileSpeedTest.latency }}
                  </span>
                  <span class="text-xs font-semibold text-slate-400">ms</span>
                </div>
                <span class="text-[10px] text-slate-400 font-mono mt-0.5">
                  HTTP {{ currentProfileSpeedTest.status || 200 }}
                </span>
              </div>

              <!-- 3. 测试负载 (Payload) -->
              <div class="flex flex-col p-3 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/60 dark:border-white/5 shadow-xs">
                <span class="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  <Download :size="12" class="text-blue-500" />
                  {{ t('options.transferredPayload') }}
                </span>
                <div class="mt-1 flex items-baseline gap-1">
                  <span class="text-xl font-extrabold font-mono text-slate-900 dark:text-white leading-tight">
                    {{ formatBytes(currentProfileSpeedTest.totalBytes) }}
                  </span>
                </div>
                <span class="text-[10px] text-slate-400 font-mono mt-0.5">
                  {{ currentProfileSpeedTest.totalBytes?.toLocaleString() }} B
                </span>
              </div>

              <!-- 4. 测速耗时 (Duration) -->
              <div class="flex flex-col p-3 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/60 dark:border-white/5 shadow-xs">
                <span class="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  <Activity :size="12" class="text-indigo-500" />
                  {{ t('options.testDuration') }}
                </span>
                <div class="mt-1 flex items-baseline gap-1">
                  <span class="text-xl font-extrabold font-mono text-slate-900 dark:text-white leading-tight">
                    {{ currentProfileSpeedTest.durationSec !== undefined ? currentProfileSpeedTest.durationSec : ((currentProfileSpeedTest.latency || 0) / 1000).toFixed(2) }}
                  </span>
                  <span class="text-xs font-semibold text-slate-400">s</span>
                </div>
                <span class="text-[10px] text-slate-400 font-mono mt-0.5 truncate" :title="currentProfileSpeedTest.testUrl">
                  {{ new Date(currentProfileSpeedTest.timestamp).toLocaleTimeString() }}
                </span>
              </div>
            </div>
          </div>

          <div class="pt-4 flex flex-col gap-3">
            <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-3 w-full">
              <div>
                <h3 class="text-sm font-bold text-slate-900 dark:text-white">{{ t('options.bypassList') }}</h3>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{{ t('options.bypassPlaceholder') }}</p>
              </div>
              <div class="flex items-center gap-1 bg-slate-100 dark:bg-white/5 p-1 rounded-xl border border-slate-200/80 dark:border-white/10 text-xs">
                <button
                  type="button"
                  class="px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer"
                  :class="bypassMode === 'textarea' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'"
                  @click="bypassMode = 'textarea'"
                >
                  {{ t('options.textView') }}
                </button>
                <button
                  type="button"
                  class="px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer"
                  :class="bypassMode === 'list' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'"
                  @click="bypassMode = 'list'"
                >
                  {{ t('options.listView') }}
                </button>
              </div>
            </div>

            <!-- Textarea Mode (Default / SwitchyOmega style) -->
            <div v-if="bypassMode === 'textarea'" class="flex flex-col gap-3 w-full">
              <textarea
                v-model="bypassText"
                rows="6"
                class="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-white/10 rounded-2xl text-xs font-mono text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 shadow-xs focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all leading-relaxed resize-y"
                :placeholder="t('options.bypassPlaceholder')"
              />
              <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="text-slate-400 dark:text-slate-500 font-medium">{{ t('options.quickPresets') }}</span>
                <UiBadge
                  variant="outline"
                  size="sm"
                  class="cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-500/10 hover:border-blue-300 dark:hover:border-blue-500/30 transition-colors font-mono"
                  @click="addBypassPreset('<local>')"
                >
                  + &lt;local&gt;
                </UiBadge>
                <UiBadge
                  variant="outline"
                  size="sm"
                  class="cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-500/10 hover:border-blue-300 dark:hover:border-blue-500/30 transition-colors font-mono"
                  @click="addBypassPreset('127.0.0.1/32')"
                >
                  + 127.0.0.1/32
                </UiBadge>
                <UiBadge
                  variant="outline"
                  size="sm"
                  class="cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-500/10 hover:border-blue-300 dark:hover:border-blue-500/30 transition-colors font-mono"
                  @click="addBypassPreset('192.168.0.0/16')"
                >
                  + 192.168.0.0/16
                </UiBadge>
                <UiBadge
                  variant="outline"
                  size="sm"
                  class="cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-500/10 hover:border-blue-300 dark:hover:border-blue-500/30 transition-colors font-mono"
                  @click="addBypassPreset('*.local')"
                >
                  + *.local
                </UiBadge>
                <button
                  type="button"
                  class="ml-auto text-xs text-slate-400 hover:text-red-500 cursor-pointer transition-colors"
                  @click="clearAllBypass"
                >
                  {{ t('options.clearAll') }}
                </button>
              </div>
            </div>

            <!-- List Mode -->
            <div v-else class="flex flex-col gap-2 w-full">
              <div v-if="!Array.isArray(fixedProfile.bypassList) || fixedProfile.bypassList.length === 0" class="text-xs text-slate-400 py-3 italic">
                {{ t('options.noBypassPatterns') }}
              </div>
              <div
                v-for="(b, idx) in (fixedProfile.bypassList || [])"
                :key="b.id || idx"
                class="flex gap-2 items-center"
              >
                <UiInput v-model="b.pattern" :placeholder="t('options.bypassInputPlaceholder')" size="sm" />
                <UiButton
                  variant="ghost"
                  size="icon"
                  class="text-slate-400 hover:text-red-500 shrink-0"
                  @click="removeBypass(b.id ?? idx)"
                >
                  <Trash2 :size="14" />
                </UiButton>
              </div>
              <UiButton
                variant="outline"
                size="sm"
                class="self-start mt-1"
                @click="addBypass"
              >
                <Plus :size="13" />
                {{ t('options.addBypassPattern') }}
              </UiButton>
            </div>

            <!-- Section Save Button for immediate clarity -->
            <div class="pt-2">
              <UiButton
                variant="primary"
                size="sm"
                @click="saveCurrentSettings"
              >
                <Save :size="14" />
                {{ t('options.saveProfile') }}
              </UiButton>
            </div>
          </div>
        </div>
        <!-- Switch Profile Editor -->
        <div v-if="switchProfile" class="flex flex-col gap-6 pt-2">
          <div class="flex flex-col gap-2 w-full max-w-xl">
            <label class="text-xs font-semibold text-slate-700 dark:text-slate-300">{{ t('options.defaultProfile') }}</label>
            <UiSelect
              v-model="switchProfile.defaultProfileId"
              :options="defaultProfileSelectOptions"
            />
          </div>

          <div class="flex flex-col gap-3">
            <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
              <div>
                <h3 class="text-sm font-bold text-slate-900 dark:text-white">{{ t('options.switchRules') }}</h3>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{{ t('options.switchRulesDesc') }}</p>
              </div>
              <UiButton variant="outline" size="sm" @click="addRule(switchProfile)">
                <Plus :size="13" />
                {{ t('options.addRule') }}
              </UiButton>
            </div>

            <!-- Rules Table -->
            <div class="border border-slate-200/80 dark:border-white/10 rounded-2xl md:rounded-3xl overflow-x-auto shadow-xs bg-white dark:bg-slate-900/60 w-full">
              <table class="w-full min-w-[620px] border-collapse">
                <thead>
                  <tr class="bg-slate-100/70 dark:bg-white/5 border-b border-slate-200/80 dark:border-white/10 text-xs font-bold text-slate-600 dark:text-slate-400">
                    <th class="py-3 px-4 text-center w-14">{{ t('common.enabled') }}</th>
                    <th class="py-3 px-4 text-center w-20">{{ t('options.order') }}</th>
                    <th class="py-3 px-4 text-left w-52">{{ t('options.conditionType') }}</th>
                    <th class="py-3 px-4 text-left">{{ t('options.pattern') }}</th>
                    <th class="py-3 px-4 text-left w-48">{{ t('options.targetProfile') }}</th>
                    <th class="py-3 px-4 w-12"></th>
                  </tr>
                </thead>
                <TransitionGroup name="list" tag="tbody" class="divide-y divide-slate-100 dark:divide-white/5 text-xs">
                  <tr v-if="(switchProfile.rules || []).length === 0" key="empty-rules">
                    <td colspan="6" class="py-8 text-center text-slate-400 dark:text-slate-500">
                      {{ t('options.noCustomRules') }}
                    </td>
                  </tr>
                  <tr
                    v-for="(rule, idx) in (switchProfile.rules || [])"
                    :key="rule.id"
                    class="hover:bg-slate-50/80 dark:hover:bg-white/[0.02] transition-colors"
                  >
                    <td class="py-2.5 px-4 text-center">
                      <UiSwitch
                        size="sm"
                        :checked="rule.enabled"
                        @update:checked="rule.enabled = $event"
                      />
                    </td>
                    <td class="py-2.5 px-4 text-center whitespace-nowrap">
                      <button
                        class="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 cursor-pointer transition-colors"
                        :disabled="idx === 0"
                        @click="moveRule(switchProfile, idx, -1)"
                      >
                        <ChevronUp :size="14" />
                      </button>
                      <button
                        class="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 cursor-pointer transition-colors"
                        :disabled="idx === switchProfile.rules.length - 1"
                        @click="moveRule(switchProfile, idx, 1)"
                      >
                        <ChevronDown :size="14" />
                      </button>
                    </td>
                    <td class="py-2.5 px-4">
                      <UiSelect
                        v-if="rule.condition"
                        v-model="rule.condition.conditionType"
                        size="sm"
                        :options="conditionTypeOptions"
                      />
                    </td>
                    <td class="py-2.5 px-4">
                      <UiInput
                        v-if="rule.condition"
                        v-model="rule.condition.pattern"
                        size="sm"
                        :placeholder="t('options.rulePatternPlaceholder')"
                      />
                    </td>
                    <td class="py-2.5 px-4">
                      <UiSelect
                        v-model="rule.profileId"
                        size="sm"
                        :options="allProfileSelectOptions"
                      />
                    </td>
                    <td class="py-2.5 px-4 text-center">
                      <UiButton
                        variant="ghost"
                        size="icon"
                        class="text-slate-400 hover:text-red-500"
                        @click="removeRule(switchProfile, idx)"
                      >
                        <Trash2 :size="13" />
                      </UiButton>
                    </td>
                  </tr>
                </TransitionGroup>
              </table>
            </div>

            <!-- Online Rule List Section -->
            <div class="mt-4 p-5 sm:p-6 border border-slate-200/80 dark:border-white/10 rounded-2xl md:rounded-3xl bg-slate-100/50 dark:bg-slate-900/40 flex flex-col gap-4 w-full">
              <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                <div>
                  <h3 class="text-sm font-bold text-slate-900 dark:text-white">{{ t('options.ruleListTitle') }}</h3>
                  <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{{ t('options.ruleListDesc') }}</p>
                </div>
                <UiButton
                  :variant="switchProfile.ruleList?.enabled ? 'primary' : 'outline'"
                  size="sm"
                  class="self-start sm:self-auto shrink-0"
                  @click="toggleRuleList(switchProfile)"
                >
                  {{ switchProfile.ruleList?.enabled ? t('common.enabled') : t('common.disabled') }}
                </UiButton>
              </div>
              <Transition name="expand">
                <div v-if="switchProfile.ruleList?.enabled" class="flex flex-col gap-4 pt-2">
                  <div class="flex flex-col gap-1.5">
                    <label class="text-xs font-semibold text-slate-700 dark:text-slate-300">{{ t('options.ruleListUrl') }}</label>
                    <UiInput
                      v-model="switchProfile.ruleList!.url"
                      placeholder="https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt"
                    />
                  </div>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                    <div class="flex flex-col gap-1.5">
                      <label class="text-xs font-semibold text-slate-700 dark:text-slate-300">{{ t('options.ruleListFormat') }}</label>
                      <UiSelect
                        v-model="switchProfile.ruleList!.format"
                        size="sm"
                        :options="ruleListFormatOptions"
                      />
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <label class="text-xs font-semibold text-slate-700 dark:text-slate-300">{{ t('options.ruleListTarget') }}</label>
                      <UiSelect
                        v-model="switchProfile.ruleList!.matchProfileId"
                        size="sm"
                        :options="allProfileSelectOptions"
                      />
                    </div>
                  </div>
                  <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-3 pt-3 border-t border-slate-200/80 dark:border-white/10 text-xs">
                    <div class="text-slate-500 dark:text-slate-400">
                      <span v-if="switchProfile.ruleList?.lastUpdate">
                        {{ t('options.lastUpdated') }}: {{ new Date(switchProfile.ruleList!.lastUpdate!).toLocaleString() }}
                        ({{ switchProfile.ruleList?.rulesCache?.length || 0 }} {{ t('options.cachedRules') }})
                      </span>
                      <span v-else>{{ t('options.neverUpdated') }}</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <UiButton
                        v-if="currentRuleListLines.length > 0"
                        variant="outline"
                        size="sm"
                        class="self-start sm:self-auto shrink-0 flex items-center gap-1.5"
                        @click="openRuleListModal"
                      >
                        <Eye :size="14" />
                        {{ t('options.viewRules') }}
                      </UiButton>
                      <UiButton
                        variant="primary"
                        size="sm"
                        :loading="updatingRuleList"
                        :disabled="!switchProfile.ruleList?.url"
                        class="self-start sm:self-auto shrink-0"
                        @click="updateRuleListNow(switchProfile.id)"
                      >
                        {{ updatingRuleList ? t('options.updating') : t('options.updateNow') }}
                      </UiButton>
                    </div>
                  </div>
                </div>
              </Transition>
            </div>
          </div>
        </div>
      </div>


        <!-- Settings & Backup Tab -->
        <div
          v-else-if="activeTab === 'backup'"
          key="backup"
          class="w-full bg-white dark:bg-slate-900/70 border border-slate-200/80 dark:border-white/10 rounded-2xl md:rounded-3xl p-5 sm:p-6 md:p-8 shadow-xs dark:shadow-2xl flex flex-col gap-6 backdrop-blur-md"
        >
        <div>
          <h2 class="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
            <Settings :size="22" class="text-indigo-600 dark:text-indigo-400" />
            {{ t('options.settingsTitle') }}
          </h2>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">{{ t('options.exportDesc') }}</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
          <div class="p-5 sm:p-6 bg-slate-50/60 dark:bg-slate-950/60 border border-slate-200/80 dark:border-white/10 rounded-2xl sm:rounded-3xl flex flex-col gap-3 shadow-xs">
            <h3 class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Globe :size="16" class="text-blue-600 dark:text-blue-400" />
              {{ t('options.langTitle') }}
            </h3>
            <p class="text-xs text-slate-500 dark:text-slate-400">{{ t('options.langSelectDesc') }}</p>
            <UiSelect
              :model-value="settings.language || 'auto'"
              :options="langOptions"
              @update:model-value="changeLanguage($event as any)"
            />
          </div>

          <div class="p-5 sm:p-6 bg-slate-50/60 dark:bg-slate-950/60 border border-slate-200/80 dark:border-white/10 rounded-2xl sm:rounded-3xl flex flex-col gap-3 shadow-xs">
            <h3 class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Palette :size="16" class="text-indigo-600 dark:text-indigo-400" />
              {{ t('options.themeTitle') }}
            </h3>
            <p class="text-xs text-slate-500 dark:text-slate-400">{{ t('options.themeSelectDesc') }}</p>
            <UiSelect
              v-model="settings.theme"
              :options="themeOptions"
              @update:model-value="saveCurrentSettings"
            />
          </div>

          <div class="p-5 sm:p-6 bg-slate-50/60 dark:bg-slate-950/60 border border-slate-200/80 dark:border-white/10 rounded-2xl sm:rounded-3xl flex flex-col gap-3 shadow-xs">
            <h3 class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <RefreshCw :size="16" class="text-emerald-600 dark:text-emerald-400" />
              {{ t('options.ruleListIntervalTitle') }}
            </h3>
            <p class="text-xs text-slate-500 dark:text-slate-400">{{ t('options.ruleListIntervalDesc') }}</p>
            <UiInput
              type="number"
              min="15"
              :model-value="settings.ruleListUpdateInterval ?? 120"
              @update:model-value="settings.ruleListUpdateInterval = Math.max(15, Number($event) || 120); saveCurrentSettings()"
            />
          </div>

          <div class="p-5 sm:p-6 bg-slate-50/60 dark:bg-slate-950/60 border border-slate-200/80 dark:border-white/10 rounded-2xl sm:rounded-3xl flex flex-col gap-3 shadow-xs">
            <h3 class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Cloud :size="16" class="text-sky-600 dark:text-sky-400" />
              {{ t('options.cloudSyncTitle') }}
            </h3>
            <p class="text-xs text-slate-500 dark:text-slate-400">{{ t('options.cloudSyncDesc') }}</p>
            <label class="flex items-center gap-2 cursor-pointer text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                :checked="settings.enableCloudSync"
                class="accent-indigo-600 w-4 h-4"
                @change="settings.enableCloudSync = ($event.target as HTMLInputElement).checked; saveCurrentSettings()"
              />
              {{ t('options.cloudSyncTitle') }}
            </label>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 w-full">
          <div class="p-5 sm:p-6 bg-slate-50/60 dark:bg-slate-950/60 border border-slate-200/80 dark:border-white/10 rounded-2xl sm:rounded-3xl flex flex-col gap-3 shadow-xs">
            <h3 class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Download :size="16" class="text-blue-600 dark:text-blue-400" />
              {{ t('options.exportTitle') }}
            </h3>
            <p class="text-xs text-slate-500 dark:text-slate-400">{{ t('options.exportDesc') }}</p>
            <UiButton variant="primary" size="sm" class="self-start mt-2" @click="exportBackup">
              <Download :size="14" />
              {{ t('options.exportBtn') }}
            </UiButton>
          </div>

          <div class="p-5 sm:p-6 bg-slate-50/60 dark:bg-slate-950/60 border border-slate-200/80 dark:border-white/10 rounded-2xl sm:rounded-3xl flex flex-col gap-3 shadow-xs">
            <h3 class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Upload :size="16" class="text-indigo-600 dark:text-indigo-400" />
              {{ t('options.importTitle') }}
            </h3>
            <p class="text-xs text-slate-500 dark:text-slate-400">{{ t('options.importDesc') }}</p>
            <label class="self-start mt-2 cursor-pointer">
              <UiButton variant="outline" size="sm" type="button">
                <Upload :size="14" />
                {{ t('options.importBtn') }}
              </UiButton>
              <input type="file" accept=".bak,.json" style="display: none;" @change="handleFileImport" />
            </label>
          </div>
        </div>
      </div>
    </main>

    <!-- Add Profile Modal -->
    <UiDialog
      v-model:open="showAddModal"
      :title="t('options.modalTitle')"
      :description="t('options.brandSub')"
    >
      <div class="flex flex-col gap-4 mt-2">
        <div class="flex flex-col gap-2">
          <label class="text-xs font-semibold text-slate-700 dark:text-slate-300">{{ t('options.modalProfileName') }}</label>
          <UiInput v-model="newProfileName" :placeholder="t('options.modalProfileNamePlaceholder')" />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-xs font-semibold text-slate-700 dark:text-slate-300">{{ t('options.modalProfileType') }}</label>
          <UiSelect v-model="newProfileType" :options="profileTypeOptions" />
        </div>
        <div class="flex justify-end gap-2.5 pt-4 border-t border-slate-100 dark:border-white/5">
          <UiButton variant="secondary" size="sm" @click="showAddModal = false">
            {{ t('common.cancel') }}
          </UiButton>
          <UiButton variant="primary" size="sm" @click="createProfile">
            {{ t('common.create') }}
          </UiButton>
        </div>
      </div>
    </UiDialog>

    <!-- Delete Profile Confirm Modal -->
    <UiConfirmDialog
      v-model:open="showDeleteConfirm"
      :title="t('options.deleteConfirmTitle')"
      :description="t('options.deleteConfirmDesc').replace('{name}', profileToDeleteName)"
      :confirm-text="t('common.delete')"
      :cancel-text="t('common.cancel')"
      variant="destructive"
      @confirm="confirmDeleteProfile"
    />

    <!-- View Rule List Modal -->
    <UiDialog
      v-model:open="showRuleListModal"
      :title="t('options.ruleListModalTitle')"
      :description="t('options.ruleListModalDesc')"
      max-width="max-w-3xl"
    >
      <div class="flex flex-col gap-3 mt-2">
        <div class="flex flex-col sm:flex-row gap-2 justify-between items-stretch sm:items-center">
          <div class="relative flex-1">
            <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              v-model="ruleListSearchQuery"
              type="text"
              :placeholder="t('options.searchRulesPlaceholder')"
              class="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 rounded-xl text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
          <div class="flex items-center gap-2 justify-between sm:justify-end">
            <span class="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
              {{ ruleListSearchQuery ? t('options.filteredRulesCount').replace('{count}', String(filteredRuleListLines.length)) : t('options.totalRulesCount').replace('{count}', String(currentRuleListLines.length)) }}
            </span>
            <UiButton
              variant="outline"
              size="sm"
              class="flex items-center gap-1.5 shrink-0"
              @click="copyRuleList"
            >
              <Copy :size="13" />
              {{ t('options.copyRules') }}
            </UiButton>
          </div>
        </div>

        <!-- Rules content viewer -->
        <div class="h-96 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-900 p-3 font-mono text-xs text-slate-200">
          <div v-if="filteredRuleListLines.length === 0" class="flex items-center justify-center h-full text-slate-400">
            {{ currentRuleListLines.length === 0 ? t('options.noRulesCached') : t('options.noRulesMatch') }}
          </div>
          <div v-else class="space-y-0.5">
            <div
              v-for="(line, idx) in filteredRuleListLines.slice(0, ruleListDisplayLimit)"
              :key="idx"
              class="flex items-start gap-3 py-0.5 hover:bg-slate-800/60 px-1.5 rounded"
            >
              <span class="text-slate-500 select-none w-12 text-right shrink-0">{{ idx + 1 }}</span>
              <span
                class="break-all"
                :class="{
                  'text-slate-500 italic': line.startsWith('!') || line.startsWith('['),
                  'text-emerald-400': line.startsWith('@@'),
                  'text-sky-300': !line.startsWith('!') && !line.startsWith('[') && !line.startsWith('@@')
                }"
              >{{ line }}</span>
            </div>
            <div v-if="filteredRuleListLines.length > ruleListDisplayLimit" class="pt-3 pb-1 text-center">
              <UiButton variant="ghost" size="sm" class="text-xs text-blue-400 hover:text-blue-300" @click="loadMoreRules">
                {{ t('options.loadMoreRules').replace('{count}', String(filteredRuleListLines.length - ruleListDisplayLimit)) }}
              </UiButton>
            </div>
          </div>
        </div>

        <div class="flex justify-end pt-2 border-t border-slate-100 dark:border-white/5">
          <UiButton variant="secondary" size="sm" @click="showRuleListModal = false">
            {{ t('common.close') }}
          </UiButton>
        </div>
      </div>
    </UiDialog>
  </div>
</template>
