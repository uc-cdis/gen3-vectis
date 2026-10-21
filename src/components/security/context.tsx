import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import type { EntitySeed, EntityType, TimeWindow } from '@/lib/vectis-kit/spec';

export const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'cases', label: 'Cases' },
  { id: 'hunt', label: 'Hunt' },
  { id: 'data', label: 'Data' },
  { id: 'entities', label: 'Entities' },
  { id: 'intel', label: 'Intel' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'health', label: 'Health' },
] as const;
export type TabId = (typeof TABS)[number]['id'];
export const isTabId = (v: unknown): v is TabId => TABS.some((t) => t.id === v);

/** Each top-level page shows one or two related tabs. Pages not listed here do not exist. */
export const SECTIONS = {
  '/Security': { title: 'Overview', tabs: ['overview'] },
  '/Alerts': { title: 'Alerts', tabs: ['alerts'] },
  '/Investigate': { title: 'Investigate', tabs: ['hunt', 'entities', 'data'] },
  '/Cases': { title: 'Cases', tabs: ['cases'] },
  '/Detection': { title: 'Detection', tabs: ['intel', 'coverage', 'health'] },
} as const satisfies Record<string, { title: string; tabs: readonly TabId[] }>;
export type SectionPath = keyof typeof SECTIONS;
export const SECTION_PATHS = Object.keys(SECTIONS) as SectionPath[];
/** The page a tab lives on. */
export const pathOfTab = (tab: TabId): SectionPath => SECTION_PATHS.find((p) => (SECTIONS[p].tabs as readonly TabId[]).includes(tab))!;

export const RANGES = [
  { id: '1h', label: 'Last hour', ms: 3_600_000 },
  { id: '24h', label: 'Last 24 hours', ms: 86_400_000 },
  { id: '7d', label: 'Last 7 days', ms: 7 * 86_400_000 },
  { id: '30d', label: 'Last 30 days', ms: 30 * 86_400_000 },
] as const;
export type RangeId = (typeof RANGES)[number]['id'];

/** "ip:203.0.113.50" <-> {type, value}. The value may itself contain colons (IPv6), so split once. */
export const encodeEntity = (s: EntitySeed): string => `${s.type}:${s.value}`;
function decodeEntity(raw: string | undefined): EntitySeed | null {
  if (!raw) return null;
  const i = raw.indexOf(':');
  if (i < 1 || i === raw.length - 1) return null;
  const type = raw.slice(0, i) as EntityType;
  const types: EntityType[] = ['ip', 'domain', 'url', 'hash', 'email', 'path', 'host', 'user', 'session', 'arn'];
  return types.includes(type) ? { type, value: raw.slice(i + 1) } : null;
}

/** What "find similar" starts from: an entity ("ip:203.0.113.50") or an alert group id. Never both. */
export type SimilarSeed = { seed: EntitySeed; groupId?: undefined } | { groupId: string; seed?: undefined };
function decodeSimilar(raw: string | undefined): SimilarSeed | null {
  if (!raw) return null;
  const seed = decodeEntity(raw);
  if (seed) return { seed };
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(raw) ? { groupId: raw } : null;
}

interface SecurityContextValue {
  tab: TabId;
  range: RangeId;
  setRange: (r: RangeId) => void;
  /** A fresh window ending now. Recomputed when the range changes or `refreshKey` bumps. */
  window: TimeWindow;
  refreshKey: number;
  refresh: () => void;
  alertId: string | null;
  entity: EntitySeed | null;
  /** The case open in the Cases tab (?case=). */
  caseId: string | null;
  /** Set by 'Find similar' links (?similar=); read by the Hunt tab. */
  similar: SimilarSeed | null;
  goTab: (tab: TabId, extra?: Record<string, string | undefined>) => void;
  openAlert: (groupId: string | null) => void;
  openEntity: (seed: EntitySeed | null) => void;
  openCase: (caseId: string | null) => void;
}

const Ctx = createContext<SecurityContextValue | null>(null);
export const useSecurity = (): SecurityContextValue => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSecurity must be used inside <SecurityProvider>');
  return v;
};

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** `section` is the page's own tabs; without it (the development page) every tab is available through ?tab=. */
export const SecurityProvider = ({ children, section }: { children: React.ReactNode; section?: readonly TabId[] }) => {
  const router = useRouter();
  const q = router.query;
  const asked = first(q.tab);
  const tab: TabId = section
    ? (isTabId(asked) && section.includes(asked) ? asked : section[0])
    : (isTabId(asked) ? asked : 'overview');
  const range: RangeId = RANGES.some((r) => r.id === first(q.range)) ? (first(q.range) as RangeId) : '24h';
  const alertId = first(q.alert) ?? null;
  const entity = decodeEntity(first(q.entity));
  const caseRaw = first(q.case);
  const caseId = caseRaw && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(caseRaw) ? caseRaw : null;
  const similar = decodeSimilar(first(q.similar));
  const [refreshKey, setRefreshKey] = useState(0);

  const push = useCallback(
    (patch: Record<string, string | undefined>, replaceTabState = false) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries({ ...router.query, ...patch })) {
        const val = first(v as string | string[] | undefined);
        if (val !== undefined && val !== '') next[k] = val;
      }
      void router[replaceTabState ? 'replace' : 'push']({ pathname: router.pathname, query: next }, undefined, { shallow: true });
    },
    [router],
  );

  const window = useMemo<TimeWindow>(() => {
    const ms = RANGES.find((r) => r.id === range)!.ms;
    const end = new Date();
    // refreshKey is part of the dependency list on purpose: bumping it re-anchors "now".
    void refreshKey;
    return { start: new Date(end.getTime() - ms).toISOString(), end: end.toISOString() };
  }, [range, refreshKey]);

  const value = useMemo<SecurityContextValue>(
    () => ({
      tab, range, window, refreshKey, alertId, entity, caseId, similar,
      setRange: (r) => push({ range: r }, true),
      refresh: () => setRefreshKey((k) => k + 1),
      goTab: (t, extra) => {
        if (!section || section.includes(t)) return push({ tab: t, alert: undefined, entity: undefined, case: undefined, similar: undefined, ...extra });
        // Another page: carry only what was asked for, plus the time range, never the drawer state of this page.
        const query: Record<string, string> = {};
        for (const [k, v] of Object.entries({ range, ...extra })) if (v) query[k] = v;
        void router.push({ pathname: pathOfTab(t), query });
      },
      openAlert: (id) => push({ alert: id ?? undefined }),
      openEntity: (s) => push({ entity: s ? encodeEntity(s) : undefined }),
      openCase: (id) => push({ case: id ?? undefined }),
    }),
    [tab, range, window, refreshKey, alertId, entity, caseId, similar, push, section, router],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};
