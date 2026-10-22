import type { AppSettings, Profile } from './types';
import { matchCondition } from './pac/matcher';
import { parseRuleListCache } from './parsers/autoproxy';
import { resolveProfile } from './pac/generator';

export type RoutingKind = 'direct' | 'proxy' | 'system';

export function routingKindOf(p: Profile | null | undefined): RoutingKind {
  if (!p || p.profileType === 'DirectProfile') return 'direct';
  if (p.profileType === 'SystemProfile') return 'system';
  return 'proxy';
}

/**
 * Resolve which routing kind the active profile gives for url+host.
 * Mirrors generated PAC evaluation: profile rules in order, then rule list
 * (whitelist pass first, then proxy pass), then default profile.
 * PacProfile is not evaluable here -> returns its verdict ('proxy').
 */
export function resolveRouting(s: AppSettings, url: string, host: string): RoutingKind | null {
  const active = s.profiles?.[s.activeProfileId];
  if (!active) return null;
  const base = resolveProfile(active.id, s.profiles) ?? active;
  if (base.profileType === 'FixedProfile') {
    return base.bypassList?.some((c) => matchCondition(c, url, host)) ? 'direct' : 'proxy';
  }
  if (base.profileType === 'SwitchProfile') {
    let matchedId: string | null = null;
    for (const rule of base.rules) {
      if (rule.enabled === false) continue;
      if (matchCondition(rule.condition, url, host)) {
        matchedId = rule.profileId;
        break;
      }
    }
    const rl = base.ruleList;
    if (matchedId === null && rl?.enabled && rl.rulesCache?.length) {
      const parsed = parseRuleListCache(rl.rulesCache, rl.matchProfileId, rl.defaultProfileId || base.defaultProfileId);
      // parseRuleListCache returns whitelist rules first, so one ordered scan
      // matches the old whitelist-pass-then-proxy-pass semantics.
      for (const r of parsed) {
        if (matchCondition(r.condition, url, host)) {
          matchedId = r.profileId;
          break;
        }
      }
    }
    return routingKindOf(resolveProfile(matchedId ?? base.defaultProfileId, s.profiles));
  }
  return routingKindOf(base);
}
