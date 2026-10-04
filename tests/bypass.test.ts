import { describe, it, expect } from 'vitest';
import { ref, computed } from 'vue';
import { normalizeBypassList } from '../src/core/storage/storage';
import { matchCondition } from '../src/core/pac/matcher';
import { addBypass, removeBypass } from '../src/core/bypass';
import type { FixedProfile } from '../src/core/types';

describe('normalizeBypassList', () => {
  it('handles strings, objects, undefined and arrays of various types', () => {
    // String from textarea or old storage
    const fromString = normalizeBypassList('<local>\n127.0.0.1/32\r\n*.example.com');
    expect(fromString).toHaveLength(3);
    expect(fromString[0]?.pattern).toBe('<local>');
    expect(fromString[1]?.pattern).toBe('127.0.0.1/32');
    expect(fromString[2]?.pattern).toBe('*.example.com');

    // Array of strings
    const fromArrayOfStrings = normalizeBypassList(['<local>', '10.0.0.0/8']);
    expect(fromArrayOfStrings).toHaveLength(2);
    expect(fromArrayOfStrings[0]?.pattern).toBe('<local>');
    expect(fromArrayOfStrings[1]?.pattern).toBe('10.0.0.0/8');

    // Object with indexed keys (deserialization edge case)
    const fromObject = normalizeBypassList({ 0: { pattern: '<local>' }, 1: { pattern: '127.0.0.1' } });
    expect(fromObject).toHaveLength(2);
    expect(fromObject[0]?.pattern).toBe('<local>');

    // Null or undefined
    expect(normalizeBypassList(null)).toEqual([]);
    expect(normalizeBypassList(undefined)).toEqual([]);
    expect(normalizeBypassList(123)).toEqual([]);
  });
});

describe('Bypass list management', () => {
  it('synchronizes textarea and bypassList bidirectionally', () => {
    const fixedProfile = ref<FixedProfile>({
      id: 'proxy',
      name: 'Proxy',
      profileType: 'FixedProfile',
      bypassList: [
        { id: 'bp_1', conditionType: 'BypassCondition', pattern: '<local>' },
        { id: 'bp_2', conditionType: 'BypassCondition', pattern: '127.0.0.1/32' },
      ],
    });

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

    expect(bypassText.value).toBe('<local>\n127.0.0.1/32');

    // Add new lines via textarea
    bypassText.value = '<local>\n127.0.0.1/32\n*.internal.net\n10.0.0.0/8';
    expect(fixedProfile.value.bypassList).toHaveLength(4);
    expect(fixedProfile.value.bypassList[2]?.pattern).toBe('*.internal.net');

    // Delete lines via textarea
    bypassText.value = '127.0.0.1/32\n*.internal.net';
    expect(fixedProfile.value.bypassList).toHaveLength(2);
    expect(fixedProfile.value.bypassList[0]?.pattern).toBe('127.0.0.1/32');
  });

  it('supports list addition and deletion correctly', () => {
    const fixedProfile = ref<FixedProfile>({
      id: 'proxy',
      name: 'Proxy',
      profileType: 'FixedProfile',
      bypassList: [
        { id: 'bp_1', conditionType: 'BypassCondition', pattern: '<local>' },
        { id: 'bp_2', conditionType: 'BypassCondition', pattern: '127.0.0.1/32' },
      ],
    });

    addBypass(fixedProfile.value);
    expect(fixedProfile.value.bypassList).toHaveLength(3);
    expect(fixedProfile.value.bypassList[2]?.pattern).toBe('');

    removeBypass(fixedProfile.value, 'bp_1');
    expect(fixedProfile.value.bypassList).toHaveLength(2);
    expect(fixedProfile.value.bypassList[0]?.id).toBe('bp_2');

    // Delete by numeric index
    removeBypass(fixedProfile.value, 0);
    expect(fixedProfile.value.bypassList).toHaveLength(1);
    expect(fixedProfile.value.bypassList[0]?.pattern).toBe('');

  });
});

describe('BypassCondition bare domain', () => {
  it('matches subdomains per Chrome bypass convention', () => {
    const cond = { conditionType: 'BypassCondition' as const, pattern: 'example.com' };
    expect(matchCondition(cond, 'http://example.com/', 'example.com')).toBe(true);
    expect(matchCondition(cond, 'http://www.example.com/', 'www.example.com')).toBe(true);
    expect(matchCondition(cond, 'http://notexample.com/', 'notexample.com')).toBe(false);
  });
});
