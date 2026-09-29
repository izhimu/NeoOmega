import { describe, it, expect } from 'vitest';
import { ref, computed } from 'vue';
import { normalizeBypassList } from '../src/core/storage/storage';
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

    const addBypass = () => {
      const fp = fixedProfile.value;
      if (!fp) return;
      if (!Array.isArray(fp.bypassList)) fp.bypassList = [];
      fp.bypassList.push({
        id: `bp_${Date.now()}_test`,
        pattern: '',
        conditionType: 'BypassCondition',
      });
    };

    const removeBypass = (indexOrId: number | string) => {
      const fp = fixedProfile.value;
      if (!fp || !Array.isArray(fp.bypassList)) return;
      if (typeof indexOrId === 'string') {
        const idx = fp.bypassList.findIndex((item) => item.id === indexOrId);
        if (idx !== -1) fp.bypassList.splice(idx, 1);
      } else if (indexOrId >= 0 && indexOrId < fp.bypassList.length) {
        fp.bypassList.splice(indexOrId, 1);
      }
    };

    addBypass();
    expect(fixedProfile.value.bypassList).toHaveLength(3);
    expect(fixedProfile.value.bypassList[2]?.pattern).toBe('');

    removeBypass('bp_1');
    expect(fixedProfile.value.bypassList).toHaveLength(2);
    expect(fixedProfile.value.bypassList[0]?.id).toBe('bp_2');
  });
});
