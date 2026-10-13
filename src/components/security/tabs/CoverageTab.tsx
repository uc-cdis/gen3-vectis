import React, { useState } from 'react';
import { Button, Group, Stack, Text, Title } from '@mantine/core';
import { PanelErrorBoundary } from '@gen3/frontend';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import { downloadText } from '@/lib/vectis-kit/spec-actions/clipboard';
import type { CoverageResponse } from '@/lib/vectis-kit/spec';
import { formatNumber, formatPercent, formatTime } from '@/lib/vectis-kit/ui/format';
import { EmptyState, Panel, QueryBoundary, Unmeasured } from '@/lib/vectis-kit/ui/primitives';
import { CoverageGrid, Legend } from '../coverage/CoverageGrid';
import { buildNavigatorLayer } from '../coverage/navigator';

const CoverageBody = ({ cov }: { cov: CoverageResponse }) => {
  const [notice, setNotice] = useState<string | null>(null);
  const total = cov.caught + cov.missed;
  const exportLayer = () => {
    const { layer, rejected } = buildNavigatorLayer(cov);
    downloadText('vectis-attack-navigator-layer.json', JSON.stringify(layer, null, 2));
    setNotice(rejected > 0 ? `Exported ${layer.techniques.length} techniques. ${rejected} invalid ${rejected === 1 ? 'row was' : 'rows were'} left out.` : `Exported ${layer.techniques.length} techniques.`);
  };
  return (
    <Stack gap="md">
      <Group gap="xl" aria-label="Coverage totals">
        <div><Text size="xs" c="dimmed">Caught</Text><Text fz={28} fw={700} data-testid="caught">{formatNumber(cov.caught)}</Text></div>
        <div><Text size="xs" c="dimmed">Missed</Text><Text fz={28} fw={700} data-testid="missed">{formatNumber(cov.missed)}</Text></div>
        <div><Text size="xs" c="dimmed">Caught share</Text>{total === 0 ? <Unmeasured reason="No techniques were replayed." /> : <Text fz={28} fw={700}>{formatPercent(cov.caught / total)}</Text>}</div>
        <div><Text size="xs" c="dimmed">Last replay run</Text><Text size="sm">{formatTime(cov.run_at)}</Text></div>
      </Group>
      <Panel title="Verdicts" action={<Button size="xs" variant="default" onClick={exportLayer}>Export ATT&amp;CK Navigator layer</Button>}>
        <Stack gap="md">
          <Legend />
          <CoverageGrid rows={cov.rows} />
          {notice ? <Text component="output" display="block" size="sm" c="dimmed">{notice}</Text> : null}
        </Stack>
      </Panel>
    </Stack>
  );
};

const CoverageTab = () => {
  const query = useSiemQuery('coverage', {});
  return (
    <PanelErrorBoundary>
      <Stack gap="md">
        <Title order={3}>Detection coverage</Title>
        <Text size="sm" c="dimmed">How many replayed attack steps the detectors caught. Coverage is measured by replaying known techniques, not estimated.</Text>
        <QueryBoundary query={query} isEmpty={(d) => d.rows.length === 0} empty={<EmptyState title="No coverage replay has been run" hint="Totals appear after a replay completes." />}>
          {(cov) => <CoverageBody cov={cov} />}
        </QueryBoundary>
      </Stack>
    </PanelErrorBoundary>
  );
};
export default CoverageTab;
