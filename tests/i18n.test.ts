import { describe, expect, it } from 'vitest';
import { getLocale, getProfileDisplayName, messages, resolveLocale, setLocale, t } from '../src/core/i18n';

describe('i18n module', () => {
  it('resolves locale properly', () => {
    expect(resolveLocale('zh_CN')).toBe('zh_CN');
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('auto')).toBeDefined();
    expect(resolveLocale()).toBe('zh_CN');
  });

  it('has 100% key parity and non-empty translations between zh_CN and en', () => {
    function collectKeysAndValues(obj: unknown, prefix = ''): Record<string, string> {
      const result: Record<string, string> = {};
      if (!obj || typeof obj !== 'object') return result;
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const fullKey = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'object' && v !== null) {
          Object.assign(result, collectKeysAndValues(v, fullKey));
        } else if (typeof v === 'string') {
          result[fullKey] = v;
        }
      }
      return result;
    }

    const enDict = collectKeysAndValues(messages.en);
    const zhDict = collectKeysAndValues(messages.zh_CN);

    const enKeys = Object.keys(enDict).sort();
    const zhKeys = Object.keys(zhDict).sort();

    expect(zhKeys).toEqual(enKeys);

    for (const key of enKeys) {
      expect(zhDict[key], `zh_CN key ${key} should not be empty`).toBeTruthy();
      expect(enDict[key], `en key ${key} should not be empty`).toBeTruthy();
    }
  });

  it('translates nested keys in both zh_CN and en', () => {
    setLocale('en');
    expect(t('popup.title')).toBe('NeoOmega');
    expect(t('common.save')).toBe('Save Changes');
    expect(t('options.newProfile')).toBe('New Profile');
    expect(t('conditions.HostWildcardCondition')).toBe('Host Wildcard');

    setLocale('zh_CN');
    expect(t('common.save')).toBe('保存修改');
    expect(t('options.newProfile')).toBe('新建情景模式');
    expect(t('popup.profiles')).toBe('情景模式');
    expect(t('conditions.HostWildcardCondition')).toContain('域名通配符');
    expect(t('options.activeBadge')).toBe('当前生效');
  });

  it('translates profile display names properly', () => {
    setLocale('zh_CN');
    expect(getProfileDisplayName({ id: 'direct', name: 'Direct' })).toBe('直接连接');
    expect(getProfileDisplayName({ id: 'system', name: 'System Proxy' })).toBe('系统代理');
    expect(getProfileDisplayName({ id: 'proxy', name: 'Proxy Server' })).toBe('代理服务器');
    expect(getProfileDisplayName({ id: 'autoSwitch', name: 'Auto Switch' })).toBe('自动切换');
    expect(getProfileDisplayName({ id: 'custom', name: 'My Proxy' })).toBe('My Proxy');

    setLocale('en');
    expect(getProfileDisplayName({ id: 'direct', name: '直接连接' })).toBe('Direct');
    expect(getProfileDisplayName({ id: 'system', name: '系统代理' })).toBe('System Proxy');
    expect(getProfileDisplayName({ id: 'proxy', name: '代理服务器' })).toBe('Proxy Server');
    expect(getProfileDisplayName({ id: 'autoSwitch', name: '自动切换' })).toBe('Auto Switch');
  });

  it('falls back to en or raw path if key missing in current locale', () => {
    setLocale('zh_CN');
    expect(t('non.existent.key', 'Default fallback')).toBe('Default fallback');
  });
});
