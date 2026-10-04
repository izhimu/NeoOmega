import type { RuleCondition } from './types';

export function addBypass(
  target?: { bypassList?: RuleCondition[] } | RuleCondition[] | null,
): RuleCondition | undefined {
  if (!target) return undefined;
  const list = Array.isArray(target)
    ? target
    : (target.bypassList = Array.isArray(target.bypassList) ? target.bypassList : []);
  const item: RuleCondition = {
    id: `bp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    pattern: '',
    conditionType: 'BypassCondition',
  };
  list.push(item);
  return item;
}

export function removeBypass(
  target: { bypassList?: RuleCondition[] } | RuleCondition[] | null | undefined,
  indexOrId: number | string,
): void {
  if (!target) return;
  const list = Array.isArray(target) ? target : target.bypassList;
  if (!Array.isArray(list)) return;
  if (typeof indexOrId === 'string') {
    const idx = list.findIndex((item) => item.id === indexOrId);
    if (idx !== -1) {
      list.splice(idx, 1);
    }
  } else if (indexOrId >= 0 && indexOrId < list.length) {
    list.splice(indexOrId, 1);
  }
}
