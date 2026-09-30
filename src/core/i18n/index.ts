import { ref, computed } from 'vue';

export type SupportedLocale = 'zh_CN' | 'en';

export const messages = {
  en: {
    // Common
    common: {
      save: 'Save Changes',
      cancel: 'Cancel',
      delete: 'Delete',
      create: 'Create',
      edit: 'Edit',
      confirm: 'Confirm',
      close: 'Close',
      loading: 'Loading...',
      actions: 'Actions',
      status: 'Status',
      notes: 'Notes',
      enabled: 'Enabled',
      disabled: 'Disabled',
      auto: 'Auto',
      ready: 'Ready',
      proxy: 'Proxy',
      active: 'Active',
      direct: 'Direct',
    },
    // Profiles
    profiles: {
      direct: 'Direct',
      system: 'System Proxy',
      proxy: 'Proxy Server',
      autoSwitch: 'Auto Switch',
    },
    // Condition Types
    conditions: {
      HostWildcardCondition: 'Host Wildcard',
      HostRegexCondition: 'Host Regex',
      UrlWildcardCondition: 'URL Wildcard',
      UrlRegexCondition: 'URL Regex',
      IpCondition: 'CIDR Subnet',
      KeywordCondition: 'Keyword',
      BypassCondition: 'Bypass Condition',
    },
    // Popup
    popup: {
      title: 'NeoOmega',
      profiles: 'Profiles',
      currentTab: 'Current Tab',
      directTab: 'Direct / Special page',
      matchingProfile: 'Routing Profile',
      failedRequests: 'Failed Requests',
      addRule: 'Add rule for this domain',
      openSettings: 'Settings',
      openInspector: 'Live Inspector',
      noErrors: 'No failed network requests detected',
      ruleAdded: 'Rule added successfully',
      addRuleFailed: 'Failed to add rule',
      quickAddProxy: '+ Proxy',
      clickToRetest: 'Click to re-test',
    },
    // Options
    options: {
      brand: 'NeoOmega',
      brandSub: 'Options & Rules',
      profilesNav: 'PROFILES',
      toolsNav: 'TOOLS & SETTINGS',
      newProfile: 'New Profile',
      generalSettings: 'Settings & Backup',
      discardChanges: 'Reset',
      saveProfile: 'Save Profile',
      profileSaved: 'Profile saved successfully',
      cannotDeleteBuiltin: 'Built-in profiles cannot be deleted!',
      deleteConfirmTitle: 'Delete Profile',
      deleteConfirmDesc: 'Are you sure you want to delete profile "{name}"? This action cannot be undone.',
      profileDeleted: 'Profile deleted successfully',
      activeBadge: 'Active',

      // Profile Info & Color
      modalProfileName: 'Profile Name',
      profileNamePlaceholder: 'Profile Name',
      themeColor: 'Theme Color',

      // Fixed Profile
      serverConfig: 'Proxy Server Configuration',
      scheme: 'Protocol',
      host: 'Server Host / IP',
      port: 'Port',
      authTitle: 'Proxy Authentication (Optional)',
      username: 'Username',
      usernamePlaceholder: 'Proxy username (optional)',
      password: 'Password',
      passwordPlaceholder: 'Proxy password (optional)',
      speedTestTitle: 'Latency & Bandwidth Test',
      speedTestDesc: 'Test connection latency and download bandwidth through this proxy server.',
      testSpeed: 'Ping',
      testingSpeed: 'Pinging...',
      testBandwidth: 'Speed Test',
      testingBandwidth: 'Testing...',
      bandwidthSpeed: 'Bandwidth',
      bandwidthSize: 'Bandwidth',
      downloadRate: 'Download Rate',
      transferredPayload: 'Payload',
      testDuration: 'Duration',
      latency: 'Latency',
      measuringBandwidth: 'Measuring download bandwidth...',
      speedTestTarget: 'Test Target',
      speedTestFailed: 'Failed',
      speedTestHostMissing: 'Please configure host and port first',
      bypassList: 'Bypass List',
      bypassPlaceholder: 'One host or CIDR per line, e.g. 127.0.0.1, <local>, *.internal.net',
      textView: 'Text View',
      listView: 'List View',
      quickPresets: 'Quick Presets:',
      clearAll: 'Clear all',
      noBypassPatterns: 'No bypass patterns. Click below to add.',
      addBypassPattern: 'Add Bypass Pattern',
      bypassInputPlaceholder: 'e.g. <local>, 127.0.0.1, *.example.com',

      // Switch Profile
      switchRules: 'Switch Rules',
      switchRulesDesc: 'Rules are evaluated sequentially from top to bottom.',
      addRule: 'Add Switch Rule',
      noCustomRules: 'No custom rules yet. Click "Add Switch Rule" to start routing traffic.',
      conditionType: 'Condition Type',
      pattern: 'Pattern / Value',
      rulePatternPlaceholder: 'e.g. *.google.com',
      targetProfile: 'Target Profile',
      order: 'Order',
      defaultProfile: 'Default Profile (Fallback)',
      ruleListTitle: 'Online Rule List (AutoProxy / GFWList)',
      ruleListDesc: 'Subscribe to remote GFWList or AutoProxy format rule list and update automatically.',
      ruleListFormat: 'Format',
      ruleListFormatAutoProxy: 'AutoProxy (Base64 / Plain)',
      ruleListFormatSwitchy: 'Switchy Rules',
      ruleListUrl: 'Rule List URL',
      ruleListInterval: 'Update Interval',
      ruleListTarget: 'Target Profile for List Rules',
      updateNow: 'Update Now',
      updating: 'Updating...',
      lastUpdated: 'Last updated',
      neverUpdated: 'Never updated yet',
      cachedRules: 'rules cached',
      ruleListUpdateSuccess: 'Rule list updated successfully',
      ruleListUpdateFailed: 'Failed to update rule list',
      ruleListUrlRequired: 'Please provide a rule list URL first',
      viewRules: 'View Rules',
      ruleListModalTitle: 'Online Rule List Content',
      ruleListModalDesc: 'Inspect cached rules from the subscription source.',
      searchRulesPlaceholder: 'Search rules or domains...',
      totalRulesCount: '{count} rules in total',
      filteredRulesCount: '{count} matching rules',
      noRulesCached: 'No rules cached yet. Click "Update Now" to download.',
      noRulesMatch: 'No matching rules found',
      loadMoreRules: 'Load more... ({count} remaining)',
      copyRules: 'Copy All',
      rulesCopied: 'Rules copied to clipboard',

      // Settings & Backup
      settingsTitle: 'General Settings & Backup',
      themeTitle: 'Theme',
      themeAuto: 'Follow System',
      themeLight: 'Light',
      themeDark: 'Dark',
      langTitle: 'Language / 语言',
      langAuto: 'Auto / 自动',
      langZh: '简体中文 (Chinese)',
      langEn: 'English',
      langSelectDesc: 'Select display language / 选择扩展显示语言',
      themeSelectDesc: 'Select interface appearance / 选择界面外观',
      exportTitle: 'Export Backup',
      exportDesc: 'Download all profiles, switch rules, and preferences as JSON.',
      exportBtn: 'Download Backup',
      backupExported: 'Backup exported',
      importTitle: 'Import SwitchyOmega / NeoOmega',
      importDesc: 'Select a .bak or .json backup file to restore all settings.',
      importBtn: 'Choose File',
      importSuccess: 'Backup imported successfully!',
      importFailed: 'Import failed',
      invalidUrl: 'Invalid URL',

      // Create modal
      modalTitle: 'Create New Profile',
      modalProfileType: 'Profile Type',
      modalProfileNamePlaceholder: 'e.g. My SOCKS5',
      fixedType: 'Fixed Proxy',
      switchType: 'Switch Profile (Rule-based routing)',
      pacType: 'PAC Script Profile',
    },
    // Sidepanel
    sidepanel: {
      title: 'NeoOmega',
      subtitle: 'Live Inspector',
      allRequests: 'All Requests',
      errors: 'Errors',
      clear: 'Clear',
      quickRule: 'Add Rule',
      quickRuleTooltip: 'Add wildcard proxy rule for this host',
      time: 'Time',
      url: 'URL',
      proxy: 'Proxy',
      rule: 'Rule',
      noRequests: 'Waiting for network traffic...',
      noActiveTab: 'No active tab',
      searchPlaceholder: 'Filter host or URL...',
      logsCleared: 'Logs cleared',
    },
  },
  zh_CN: {
    // Common
    common: {
      save: '保存修改',
      cancel: '取消',
      delete: '删除',
      create: '创建',
      edit: '编辑',
      confirm: '确认',
      close: '关闭',
      loading: '加载中...',
      actions: '操作',
      status: '状态',
      notes: '备注',
      enabled: '启用',
      disabled: '停用',
      auto: '自动',
      ready: '已就绪',
      proxy: '代理',
      active: '当前生效',
      direct: '直接连接',
    },
    // Profiles
    profiles: {
      direct: '直接连接',
      system: '系统代理',
      proxy: '代理服务器',
      autoSwitch: '自动切换',
    },
    // Condition Types
    conditions: {
      HostWildcardCondition: '域名通配符 (Host Wildcard)',
      HostRegexCondition: '域名正则 (Host Regex)',
      UrlWildcardCondition: '网址通配符 (URL Wildcard)',
      UrlRegexCondition: '网址正则 (URL Regex)',
      IpCondition: 'CIDR 子网 / IP 范围',
      KeywordCondition: '网址关键字 (Keyword)',
      BypassCondition: '不代理匹配 (Bypass)',
    },
    // Popup
    popup: {
      title: 'NeoOmega',
      profiles: '情景模式',
      currentTab: '当前标签页',
      directTab: '直接连接 / 特殊页面',
      matchingProfile: '路由代理',
      failedRequests: '请求失败',
      addRule: '为该域名添加分流规则',
      openSettings: '设置选项',
      openInspector: '实时抓包监控',
      noErrors: '未检测到失败请求',
      ruleAdded: '规则添加成功',
      addRuleFailed: '添加规则失败',
      quickAddProxy: '+ 代理',
      clickToRetest: '点击重新测速',
    },
    // Options
    options: {
      brand: 'NeoOmega',
      brandSub: '配置与分流中心',
      profilesNav: '情景模式',
      toolsNav: '工具与全局设置',
      newProfile: '新建情景模式',
      generalSettings: '通用设置与备份',
      discardChanges: '重置',
      saveProfile: '保存配置',
      profileSaved: '情景模式保存成功',
      cannotDeleteBuiltin: '内置情景模式无法删除！',
      deleteConfirmTitle: '删除情景模式',
      deleteConfirmDesc: '确认删除情景模式 "{name}" 吗？此操作不可撤销。',
      profileDeleted: '情景模式已删除',
      activeBadge: '当前生效',

      // Profile Info & Color
      modalProfileName: '模式名称',
      profileNamePlaceholder: '情景模式名称',
      themeColor: '标识颜色',

      // Fixed Profile
      serverConfig: '代理服务器配置',
      scheme: '协议类型',
      host: '服务器地址 / IP',
      port: '端口',
      authTitle: '代理身份认证 (可选)',
      username: '用户名',
      usernamePlaceholder: '代理认证用户名 (可选)',
      password: '密码',
      passwordPlaceholder: '代理认证密码 (可选)',
      speedTestTitle: '连通性与带宽测速',
      speedTestDesc: '检测此代理服务器的网络连通性、往返延迟及下行带宽速度。',
      testSpeed: '测延迟',
      testingSpeed: '测试中...',
      testBandwidth: '测带宽',
      testingBandwidth: '下载测速中...',
      bandwidthSpeed: '带宽大小',
      bandwidthSize: '带宽大小',
      downloadRate: '下载速率',
      transferredPayload: '测试负载',
      testDuration: '测速耗时',
      latency: '网络延迟',
      measuringBandwidth: '正在测量下行带宽...',
      speedTestTarget: '测试目标',
      speedTestFailed: '测速失败',
      speedTestHostMissing: '请先填写服务器地址和端口',
      bypassList: '不代理列表 (Bypass List)',
      bypassPlaceholder: '每行一个主机名或 CIDR，例如 127.0.0.1, <local>, *.internal.net',
      textView: '文本模式',
      listView: '列表模式',
      quickPresets: '快速预设：',
      clearAll: '清空全部',
      noBypassPatterns: '暂无不代理规则，点击下方按钮添加',
      addBypassPattern: '添加不代理规则',
      bypassInputPlaceholder: '例如 <local>, 127.0.0.1, *.example.com',

      // Switch Profile
      switchRules: '自动切换规则列表',
      switchRulesDesc: '按从上到下顺序逐条匹配规则。',
      addRule: '添加切换规则',
      noCustomRules: '暂无自定义规则，点击“添加切换规则”开始分流。',
      conditionType: '匹配条件类型',
      pattern: '匹配表达式 / 值',
      rulePatternPlaceholder: '例如 *.google.com',
      targetProfile: '目标情景模式',
      order: '排序',
      defaultProfile: '默认情景模式 (未命中规则时回退)',
      ruleListTitle: '在线规则列表 (AutoProxy / GFWList)',
      ruleListDesc: '订阅远程 GFWList 或 AutoProxy 格式在线列表并按设定周期自动同步。',
      ruleListFormat: '列表格式',
      ruleListFormatAutoProxy: 'AutoProxy 格式 (Base64 / 纯文本)',
      ruleListFormatSwitchy: 'Switchy 规则格式',
      ruleListUrl: '在线订阅地址 (URL)',
      ruleListInterval: '更新周期',
      ruleListTarget: '命中在线规则的目标代理',
      updateNow: '立即更新',
      updating: '更新中...',
      lastUpdated: '最后更新于',
      neverUpdated: '尚未更新',
      cachedRules: '条规则已缓存',
      ruleListUpdateSuccess: '在线规则列表更新成功',
      ruleListUpdateFailed: '在线规则列表更新失败',
      ruleListUrlRequired: '请先填写规则列表 URL',
      viewRules: '查看规则',
      ruleListModalTitle: '在线规则列表内容',
      ruleListModalDesc: '查看从订阅源下载并缓存的规则列表。',
      searchRulesPlaceholder: '搜索规则或域名...',
      totalRulesCount: '共 {count} 条规则',
      filteredRulesCount: '匹配到 {count} 条规则',
      noRulesCached: '暂无缓存规则，请先点击“立即更新”下载。',
      noRulesMatch: '未找到匹配规则',
      loadMoreRules: '加载更多... (剩余 {count} 条)',
      copyRules: '复制全部',
      rulesCopied: '已复制全部规则到剪贴板',

      // Settings & Backup
      settingsTitle: '通用设置与数据备份',
      themeTitle: '界面主题',
      themeAuto: '跟随系统',
      themeLight: '浅色明亮',
      themeDark: '深色暗黑',
      langTitle: '语言 / Language',
      langAuto: '自动识别 (Auto)',
      langZh: '简体中文 (Chinese)',
      langEn: 'English',
      langSelectDesc: '选择扩展界面语言',
      themeSelectDesc: '选择界面外观主题',
      exportTitle: '导出配置备份',
      exportDesc: '将所有情景模式、切换规则与配置导出为 JSON 备份文件。',
      exportBtn: '下载备份文件',
      backupExported: '备份已导出',
      importTitle: '导入 SwitchyOmega / NeoOmega',
      importDesc: '选择 .bak 或 .json 备份文件一键恢复所有配置与规则。',
      importBtn: '选择备份文件',
      importSuccess: '备份导入成功！',
      importFailed: '导入失败',
      invalidUrl: '无效的 URL 地址',

      // Create modal
      modalTitle: '新建情景模式',
      modalProfileType: '情景模式类型',
      modalProfileNamePlaceholder: '例如：我的代理服务器',
      fixedType: '代理服务器 (Fixed Proxy)',
      switchType: '自动切换模式 (Switch Profile)',
      pacType: 'PAC 脚本模式 (PAC Profile)',
    },
    // Sidepanel
    sidepanel: {
      title: 'NeoOmega',
      subtitle: '实时监控面板',
      allRequests: '全部请求',
      errors: '失败请求',
      clear: '清空记录',
      quickRule: '加规则',
      quickRuleTooltip: '为该域名添加通配符代理规则',
      time: '时间',
      url: '请求 URL',
      proxy: '代理',
      rule: '分流规则',
      noRequests: '等待页面网络流量...',
      noActiveTab: '无活动标签页',
      searchPlaceholder: '过滤域名或 URL...',
      logsCleared: '请求记录已清空',
    },
  },
} as const;

export type MessageSchema = typeof messages.en;

const currentLocaleRef = ref<SupportedLocale>('zh_CN');

export function resolveLocale(preference?: string): SupportedLocale {
  if (preference === 'zh_CN' || preference === 'en') {
    return preference;
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    const lang = navigator.language.toLowerCase();
    if (lang.startsWith('zh')) return 'zh_CN';
    return 'en';
  }
  return 'zh_CN';
}

export function setLocale(locale: SupportedLocale) {
  currentLocaleRef.value = locale;
}

export function getLocale(): SupportedLocale {
  return currentLocaleRef.value;
}

/**
 * Access nested translation key, e.g. t('popup.title')
 */
export function t(path: string, fallback?: string): string {
  const loc = currentLocaleRef.value;
  const dict = messages[loc] || messages.en;
  const parts = path.split('.');
  let current: unknown = dict;
  for (const p of parts) {
    if (current && typeof current === 'object' && p in current) {
      current = (current as Record<string, unknown>)[p];
    } else {
      // fallback to en
      let enCurrent: unknown = messages.en;
      for (const ep of parts) {
        if (enCurrent && typeof enCurrent === 'object' && ep in enCurrent) {
          enCurrent = (enCurrent as Record<string, unknown>)[ep];
        } else {
          return fallback ?? path;
        }
      }
      return typeof enCurrent === 'string' ? enCurrent : (fallback ?? path);
    }
  }
  return typeof current === 'string' ? current : (fallback ?? path);
}

/**
 * Localize default/built-in profile names if not renamed by user
 */
export function getProfileDisplayName(profile?: { id?: string; name?: string } | null): string {
  if (!profile) return '';
  const id = profile.id;
  const name = profile.name;
  if (!name && id) {
    const key = `profiles.${id}`;
    const tr = t(key);
    return tr !== key ? tr : id;
  }
  if (id === 'direct' && (!name || name === 'Direct' || name === '直接连接')) {
    return t('profiles.direct');
  }
  if (id === 'system' && (!name || name === 'System Proxy' || name === '系统代理')) {
    return t('profiles.system');
  }
  if (id === 'proxy' && (!name || name === 'Proxy Server' || name === '代理服务器')) {
    return t('profiles.proxy');
  }
  if (id === 'autoSwitch' && (!name || name === 'Auto Switch' || name === '自动切换')) {
    return t('profiles.autoSwitch');
  }
  return name || id || '';
}

export function useI18n() {
  const locale = computed(() => currentLocaleRef.value);
  return {
    locale,
    setLocale,
    getLocale,
    t,
    getProfileDisplayName,
  };
}
