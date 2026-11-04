import React, { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { Grid, Skeleton, Stack, Tabs, Text } from '@mantine/core';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { CatalogResponse, EntitySeed } from '@/lib/vectis-kit/spec';
import { EmptyState, Panel, QueryBoundary } from '@/lib/vectis-kit/ui/primitives';
import { useSecurity } from '../context';
import { FindSimilar } from '../hunt/FindSimilar';
import { ContextEvents } from '../hunt/ContextEvents';
import { InvestigateForm } from '../hunt/InvestigateForm';
import type { Start } from '../hunt/InvestigateForm';
import { AskGraph } from '../hunt/AskGraph';
import { HuntGraph } from '../hunt/HuntGraph';
import { HuntSummary } from '../hunt/HuntSummary';
import { WhatItDid } from '../hunt/WhatItDid';
import { LAST_ACTIVITY, readContextLink, readPendingLast, writeContextLink, writePendingLast } from '../hunt/contextModel';
import type { ContextSpec, Scope } from '../hunt/contextModel';
import { EntityProfile } from '../entities/EntityProfile';
import { huntIndexes } from '../hunt/huntModel';

/** The moment of a new investigation, once the entity's profile says when it was last active (now, when the profile has no such time). */
const ResolveLast = ({ pending, go }: { pending: { seed: EntitySeed; span: number; scope: Scope }; go: (spec: ContextSpec) => void }) => {
  const profile = useSiemQuery('entityProfile', { body: { type: pending.seed.type, value: pending.seed.value } });
  const done = useRef(false);
  useEffect(() => {
    if (done.current || (!profile.data && !profile.error)) return;
    done.current = true;
    const last = profile.data?.last_seen;
    const at = last && !Number.isNaN(Date.parse(last)) ? new Date(Date.parse(last)).toISOString() : new Date().toISOString();
    go({ seed: pending.seed, at, span: pending.span, scope: pending.scope });
  }, [profile.data, profile.error, pending, go]);
  return (
    <Panel>
      <Stack gap="xs" data-testid="hunt-resolving">
        <Text size="sm">Finding when {pending.seed.value} was last active...</Text>
        <Skeleton height={14} width="60%" />
        <Skeleton height={14} width="45%" />
      </Stack>
    </Panel>
  );
};

/**
 * The people-and-things beside the events. One tab at a time, so the page is the events and one question about them, not seven stacked panels.
 * Only the open tab is mounted: the graph and the full profile are read when asked for.
 */
const SideTabs = ({ spec, onPivot }: { spec: ContextSpec; onPivot: (seed: EntitySeed) => void }) => {
  const { similar } = useSecurity();
  const key = `${spec.seed.type}:${spec.seed.value}`;
  return (
    <Tabs defaultValue="similar" keepMounted={false} variant="outline" aria-label="More about this entity" data-testid="hunt-side">
      <Tabs.List mb="sm">
        <Tabs.Tab value="similar">Who else</Tabs.Tab>
        <Tabs.Tab value="ask">Ask the graph</Tabs.Tab>
        <Tabs.Tab value="graph">Graph</Tabs.Tab>
        <Tabs.Tab value="details">Details</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="similar">
        <FindSimilar compact form={false} key={similar ? `ctx:${JSON.stringify(similar)}` : `seed:${key}`} prefill={similar ?? (spec.seed.type === 'ip' ? { seed: spec.seed } : null)} />
      </Tabs.Panel>
      <Tabs.Panel value="ask"><AskGraph key={key} seed={spec.seed} onPivot={onPivot} /></Tabs.Panel>
      <Tabs.Panel value="graph"><HuntGraph seed={spec.seed} /></Tabs.Panel>
      <Tabs.Panel value="details">
        <Panel title="Details">
          <EntityProfile key={key} seed={spec.seed} graph={false} />
        </Panel>
      </Tabs.Panel>
    </Tabs>
  );
};

/**
 * Hunt: one box to start (paste anything), then the events around the moment first, with what the graph knows beside them. Every value in the
 * events can be followed. Ready-made questions are in Views; the full tables are in Explore.
 */
const HuntPage = ({ catalog }: { catalog: CatalogResponse }) => {
  const router = useRouter();
  const { similar, goTab } = useSecurity();
  const spec = readContextLink(router.query);
  const pending = spec ? null : readPendingLast(router.query);

  const replace = (query: Record<string, string>) => { void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true }); };
  const go = (next: ContextSpec | null) => replace(writeContextLink(router.query, next));
  const start = (s: Start) => {
    if (s.at === LAST_ACTIVITY) replace(writePendingLast(router.query, { seed: s.seed, span: s.span, scope: s.scope }));
    else go({ seed: s.seed, at: s.at, span: s.span, scope: s.scope });
  };
  const pivot = (seed: EntitySeed) => { if (spec) go({ ...spec, seed }); };
  // An alert id is searched for similar alerts, which is a different question from following an entity: it replaces the investigation.
  const findAlert = (groupId: string) => goTab('hunt', { similar: groupId, inv_type: undefined, inv_value: undefined, inv_at: undefined, inv_span: undefined, inv_scope: undefined });

  return (
    <Stack gap="md" data-testid="hunt-page">
      <InvestigateForm key={spec ? `${spec.seed.type}:${spec.seed.value}:${spec.at}` : 'none'} current={spec} onChange={go} onStart={start} onAlert={findAlert} />
      {pending ? <ResolveLast pending={pending} go={go} /> : null}
      {spec ? (
        <Stack gap="md" data-testid="hunt-investigation">
          <HuntSummary seed={spec.seed} />
          <Grid gap="md">
            <Grid.Col span={{ base: 12, lg: 8 }}>
              <Stack gap="md">
                <ContextEvents spec={spec} catalog={catalog} onPivot={pivot} onMove={(at) => go({ ...spec, at })} />
                <WhatItDid seed={spec.seed} />
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 4 }}>
              <SideTabs spec={spec} onPivot={pivot} />
            </Grid.Col>
          </Grid>
        </Stack>
      ) : pending || !similar ? null : (
        <FindSimilar form={false} key={`ctx:${JSON.stringify(similar)}`} prefill={similar} />
      )}
    </Stack>
  );
};

const HuntTab = () => {
  const catalog = useSiemQuery('catalog', {});
  return (
    <QueryBoundary query={catalog} isEmpty={(c) => huntIndexes(c).length === 0} empty={<EmptyState title="No hunting indexes are available" hint="The data catalog lists none of the indexes the unified timeline covers." />}>
      {(c) => <HuntPage catalog={c} />}
    </QueryBoundary>
  );
};
export default HuntTab;
