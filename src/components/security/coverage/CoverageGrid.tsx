import React from 'react';
import { Badge, Box, Group, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import type { CoverageRow } from '@/lib/vectis-kit/spec';
import { VERDICTS, VERDICT_COLOR, VERDICT_LABEL, VERDICT_MEANING } from './navigator';

/** Colour AND label: the verdict is never conveyed by colour alone. */
const VerdictBadge = ({ verdict }: { verdict: CoverageRow['verdict'] }) => (
  <Badge color={VERDICT_COLOR[verdict]} variant={verdict === 'missed' ? 'filled' : 'light'} radius="sm">{VERDICT_LABEL[verdict]}</Badge>
);

export const Legend = () => (
  <Group gap="md" component="ul" p={0} m={0} aria-label="Verdict legend" style={{ listStyle: 'none' }}>
    {VERDICTS.map((v) => (
      <li key={v}>
        <Group gap={6} wrap="nowrap" align="flex-start">
          <VerdictBadge verdict={v} />
          <Text size="xs" c="dimmed" maw={220}>{VERDICT_MEANING[v]}</Text>
        </Group>
      </li>
    ))}
  </Group>
);

export const CoverageGrid = ({ rows }: { rows: CoverageRow[] }) => {
  const ordered = [...rows].sort((a, b) => a.replay.localeCompare(b.replay) || a.step - b.step || a.technique_id.localeCompare(b.technique_id));
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} component="ul" p={0} m={0} aria-label="Techniques" style={{ listStyle: 'none' }}>
      {ordered.map((r) => (
        <Paper component="li" key={`${r.replay}:${r.step}:${r.technique_id}`} withBorder p="sm" radius="md" data-verdict={r.verdict}
          style={{ borderLeft: `6px solid var(--mantine-color-${VERDICT_COLOR[r.verdict]}-6)` }}>
          <Stack gap={4}>
            <Group justify="space-between" wrap="nowrap">
              <Text fw={700} ff="monospace">{r.technique_id}</Text>
              <VerdictBadge verdict={r.verdict} />
            </Group>
            <Box><Text size="xs" c="dimmed">Replay {r.replay}, step {r.step}</Text></Box>
          </Stack>
        </Paper>
      ))}
    </SimpleGrid>
  );
};
