import React from 'react';
import { Badge, Group, Stack, Table, Text } from '@mantine/core';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { GraphCoveragePath } from '@/lib/vectis-kit/spec';
import { QueryBoundary } from '@/lib/vectis-kit/ui/primitives';
import { formatNumber } from '@/lib/vectis-kit/ui/format';

const SHOWN_IDS = 8;

/** The relations with no edges that stop questions, most questions first: what to fix or which feed to turn on. */
export const blockedBy = (paths: readonly GraphCoveragePath[]): { relation: string; ids: string[] }[] => {
  const found = new Map<string, string[]>();
  for (const p of paths) {
    if (p.state !== 'missing' || p.first_missing === null || p.first_missing === undefined) continue;
    const relation = p.steps[p.first_missing].relation;
    found.set(relation, [...(found.get(relation) ?? []), p.id]);
  }
  return [...found].map(([relation, ids]) => ({ relation, ids })).sort((a, b) => b.ids.length - a.ids.length || a.relation.localeCompare(b.relation));
};

/** Which of the dictionary's questions the graph can walk today, and what stops the rest. */
export const QuestionCoverage = () => {
  const query = useSiemQuery('graphCoverage', {});
  return (
    <QueryBoundary query={query} isEmpty={(d) => d.paths.length === 0}>
      {(d) => (
        <Stack gap="xs" data-testid="question-coverage">
          <Group gap="xs">
            <Badge color="green" variant="light">{formatNumber(d.answerable)} can be answered</Badge>
            <Badge color={d.missing ? 'orange' : 'gray'} variant="light">{formatNumber(d.missing)} wait for data</Badge>
            <Badge color="blue" variant="light">{formatNumber(d.events)} are answered from the events</Badge>
            <Text size="xs" c="dimmed">Edges seen in the last {d.days} days.</Text>
          </Group>
          {blockedBy(d.paths).length ? (
            <Table verticalSpacing={4} aria-label="Relations with no edges">
              <Table.Thead><Table.Tr><Table.Th>Relation with no edges</Table.Th><Table.Th>Questions it stops</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {blockedBy(d.paths).map((b) => (
                  <Table.Tr key={b.relation}>
                    <Table.Td><Text size="sm" ff="monospace">{b.relation}</Text></Table.Td>
                    <Table.Td><Text size="sm">{b.ids.slice(0, SHOWN_IDS).join(', ')}{b.ids.length > SHOWN_IDS ? ` and ${b.ids.length - SHOWN_IDS} more` : ''}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : <Text size="sm" c="dimmed">Every question that starts in the graph has edges to walk.</Text>}
        </Stack>
      )}
    </QueryBoundary>
  );
};
