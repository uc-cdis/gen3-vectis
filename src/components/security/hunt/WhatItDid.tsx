import React from 'react';
import { Text } from '@mantine/core';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { EntitySeed } from '@/lib/vectis-kit/spec';
import { EmptyState, Panel, QueryBoundary, Unmeasured } from '@/lib/vectis-kit/ui/primitives';
import { GroupList, groupGraph } from './FindSimilar';

const Neighbours = ({ startId }: { startId: string }) => {
  const graph = useSiemQuery('graph', { body: { start_id: startId, max_hops: 1, limit: 200 } });
  return (
    <QueryBoundary query={graph} isEmpty={(d) => d.nodes.length <= 1} empty={<EmptyState title="Nothing recorded for it in the graph" />} rows={3}>
      {(d) => <GroupList grid groups={groupGraph(d, true).direct} />}
    </QueryBoundary>
  );
};

/**
 * What the graph records this entity doing, one hop out, grouped by what each thing is (requests it sent, sites it targeted, rules it triggered,
 * who saw it). The picture is under "Graph" further down; this is the same facts as plain lists.
 */
export const WhatItDid = ({ seed }: { seed: EntitySeed }) => {
  const profile = useSiemQuery('entityProfile', { body: { type: seed.type, value: seed.value } });
  const startId = profile.data?.graph_id ?? null;
  return (
    <Panel title="What it did">
      <Text size="xs" c="dimmed" mb="xs">Everything the graph records this {seed.type === 'ip' ? 'address' : 'entity'} doing, grouped by kind. Click a name to open it.</Text>
      {startId ? <Neighbours startId={startId} /> : profile.data ? <Unmeasured reason="The graph has no node for this entity, so there is nothing recorded about what it did beyond the events below." /> : (
        <QueryBoundary query={profile} rows={3}>{() => null}</QueryBoundary>
      )}
    </Panel>
  );
};
