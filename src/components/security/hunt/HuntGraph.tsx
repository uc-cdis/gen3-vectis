import React, { useState } from 'react';
import { Button, Text } from '@mantine/core';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { EntitySeed } from '@/lib/vectis-kit/spec';
import { Panel } from '@/lib/vectis-kit/ui/primitives';
import { EntityGraphSection } from '../entities/EntityGraphSection';

/** The picture of the neighbourhood. Closed until asked for: the lists above say the same things, and a drawn graph is the part that gets crowded. */
export const HuntGraph = ({ seed }: { seed: EntitySeed }) => {
  const [open, setOpen] = useState(false);
  const profile = useSiemQuery('entityProfile', { body: { type: seed.type, value: seed.value } });
  return (
    <Panel title="Graph" action={<Button size="compact-xs" variant="default" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show the graph'}</Button>}>
      {open ? <EntityGraphSection seed={seed} graphId={profile.data?.graph_id} /> : <Text size="xs" c="dimmed">The neighbourhood drawn as a graph: click to select, double-click to expand, and Enlarge for a full-screen view.</Text>}
    </Panel>
  );
};
