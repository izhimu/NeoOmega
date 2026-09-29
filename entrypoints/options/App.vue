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
} from 'lucide-vue-next';
import { Toaster, toast } from 'vue-sonner';
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
          <UiBadge
            v-if="settings.activeProfileId === id"
            variant="primary"
            size="sm"
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
                size="sm"
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
  </div>
</template>
