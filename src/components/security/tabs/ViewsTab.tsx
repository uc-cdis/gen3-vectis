import React from 'react';
import { Grid, Stack, Text } from '@mantine/core';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { Hunt, SavedView } from '@/lib/vectis-kit/spec';
import { Panel } from '@/lib/vectis-kit/ui/primitives';
import { useSecurity } from '../context';
import { SavedHunts } from '../hunt/SavedHunts';
import { applySpec, linkForQuery } from '../hunt/huntModel';
import { ViewsPanel } from './DataTab';

/**
 * Views: questions someone already worked out. A saved view (ready-made or shared) opens in Explore with its index, columns, filters and sort;
 * a saved hunt opens in Explore on the index and time window it was saved with. New hunts are saved from Explore, where the query is.
 */
const ViewsTab = () => {
  const { goTab } = useSecurity();
  const catalog = useSiemQuery('catalog', {});

  const openView = (v: SavedView) => goTab('data', { view: v.id });
  const openHunt = (h: Hunt) => {
    const applied = catalog.data ? applySpec(h.spec, catalog.data) : null;
    if (applied) goTab('data', linkForQuery({ index: applied.index, range: applied.range, filters: applied.view.filters }));
  };

  return (
    <Grid gap="md" data-testid="views-tab">
      <Grid.Col span={{ base: 12, lg: 7 }}>
        <Panel title="Saved views">
          <Stack gap="xs">
            <Text size="xs" c="dimmed">Ready-made and shared questions. Opening one takes you to Explore with the table already set up; the time range stays as you chose it.</Text>
            <ViewsPanel activeId={null} onApply={openView} />
          </Stack>
        </Panel>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 5 }}>
        <SavedHunts onOpen={openHunt} />
      </Grid.Col>
    </Grid>
  );
};
export default ViewsTab;
