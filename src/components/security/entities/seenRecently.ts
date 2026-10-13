import type { AlertGroup, EntityType } from '@/lib/vectis-kit/spec';
import { classifyIndicator } from '@/lib/vectis-kit/spec/indicator';

export interface SeenEntity { type: EntityType; value: string; groups: number; lastSeen: string }

/**
 * Entities worth a look, read ONLY from the alert groups passed in: each group's `top_sources` and its matched
 * indicators. A group whose `top_sources` is null has not had its sources computed; it contributes only its
 * indicators (it is never guessed from a label). Nothing is stored or invented. Most recently seen first.
 */
export function deriveSeenRecently(groups: readonly AlertGroup[], limit = 50): SeenEntity[] {
  const seen = new Map<string, SeenEntity>();
  const add = (type: EntityType, value: string, g: AlertGroup) => {
    const k = `${type}:${value}`;
    const cur = seen.get(k);
    if (!cur) seen.set(k, { type, value, groups: 1, lastSeen: g.last_seen });
    else {
      cur.groups += 1;
      if (g.last_seen > cur.lastSeen) cur.lastSeen = g.last_seen;
    }
  };
  for (const g of groups) {
    const here = new Set<string>();
    for (const src of g.top_sources ?? []) here.add(`${src.type}:${src.value}`);
    for (const raw of g.matched_indicators ?? []) {
      const t = classifyIndicator(raw);
      if (t) here.add(`${t}:${raw.trim()}`);
    }
    for (const k of here) {
      const i = k.indexOf(':');
      add(k.slice(0, i) as EntityType, k.slice(i + 1), g);
    }
  }
  return [...seen.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || a.value.localeCompare(b.value)).slice(0, limit);
}
