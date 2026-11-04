import React from 'react';
import { useRouter } from 'next/router';
import { Stack } from '@mantine/core';
import { SegmentedControl } from '@gen3/frontend';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import { EmptyState, QueryBoundary } from '@/lib/vectis-kit/ui/primitives';
import { ExploreWorkspace } from '../hunt/ExploreWorkspace';
import { huntIndexes } from '../hunt/huntModel';
import DataTab from './DataTab';

type Mode = 'table' | 'timeline';

/**
 * Explore: the events themselves. Table is the filterable, sortable table of any index (with its charts); Timeline is every event over time
 * from the precomputed rollups, with a heat map and the rows of a range dragged out of the chart.
 */
const ExploreTab = () => {
  const router = useRouter();
  // In the link (?explore=timeline) so either view can be shared or bookmarked.
  const mode: Mode = router.query.explore === 'timeline' ? 'timeline' : 'table';
  const setMode = (m: Mode) => {
    const { explore: _drop, ...rest } = router.query;
    void router.replace({ pathname: router.pathname, query: m === 'timeline' ? { ...rest, explore: 'timeline' } : rest }, undefined, { shallow: true });
  };
  const catalog = useSiemQuery('catalog', {});
  return (
    <Stack gap="sm" data-testid="explore-tab">
      <SegmentedControl padding={2} size="xs" aria-label="Explore as" value={mode} onChange={(v) => setMode(v as Mode)}
        data={[{ value: 'table', label: 'Table' }, { value: 'timeline', label: 'Timeline' }]} />
      {mode === 'table' ? <DataTab /> : (
        <QueryBoundary query={catalog} isEmpty={(c) => huntIndexes(c).length === 0} empty={<EmptyState title="No indexes are available for the timeline" />}>
          {(c) => <ExploreWorkspace catalog={c} />}
        </QueryBoundary>
      )}
    </Stack>
  );
};
export default ExploreTab;
