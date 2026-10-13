import React, { useMemo, useState } from 'react';
import { Badge, Group, Table, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconSelector } from '@tabler/icons-react';
import type { Property } from '@/lib/dictionary/ddv2';

type SortKey = 'name' | 'type' | 'flags';
type Dir = 'asc' | 'desc';

const flagCount = (p: Property) => Number(p.pii) + Number(p.required) + Number(p.envelope) + Number(p.internal);

const compare = (key: SortKey, a: Property, b: Property): number => {
  if (key === 'name') return a.name.localeCompare(b.name);
  if (key === 'type') return a.typeLabel.localeCompare(b.typeLabel) || a.name.localeCompare(b.name);
  return flagCount(b) - flagCount(a) || a.name.localeCompare(b.name);
};

const Flags = ({ p }: { p: Property }) => (
  <Group gap={4} wrap="wrap">
    {p.pii ? <Tooltip label="The dictionary marks this property as personal data."><Badge color="red" variant="light" size="sm" radius="sm">PII</Badge></Tooltip> : null}
    {p.required ? <Tooltip label="Listed in the dictionary's required keys: present on every record."><Badge color="blue" variant="filled" size="sm" radius="sm">required</Badge></Tooltip> : null}
    {p.envelope ? <Tooltip label="An envelope key: part of the common record envelope the graph writer reads."><Badge color="grape" variant="light" size="sm" radius="sm">envelope</Badge></Tooltip> : null}
    {p.internal ? <Tooltip label="An internal key: used by the pipeline, not a data field."><Badge color="gray" variant="light" size="sm" radius="sm">internal</Badge></Tooltip> : null}
  </Group>
);

const Constraints = ({ p }: { p: Property }) => {
  const parts: string[] = [];
  if (p.format) parts.push(`format ${p.format}`);
  if (p.minimum !== null || p.maximum !== null) parts.push(`range ${p.minimum ?? '…'} to ${p.maximum ?? '…'}`);
  if (p.defaultValue !== null) parts.push(`default ${p.defaultValue}`);
  if (p.enumValues.length) parts.push(`one of ${p.enumValues.join(', ')}`);
  return parts.length ? <Text size="xs" c="dimmed">{parts.join(' · ')}</Text> : null;
};

const Header = ({ label, k, sort, dir, onSort }: { label: string; k: SortKey; sort: SortKey | null; dir: Dir; onSort: (k: SortKey) => void }) => {
  const active = sort === k;
  const Icon = !active ? IconSelector : dir === 'asc' ? IconChevronUp : IconChevronDown;
  return (
    <Table.Th aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <UnstyledButton onClick={() => onSort(k)} aria-label={`Sort by ${label}`} className="flex items-center gap-1 font-semibold">
        {label}<Icon size={14} aria-hidden />
      </UnstyledButton>
    </Table.Th>
  );
};

/** A sortable table of an entity's properties. Everything from the dictionary is rendered as plain text. */
export const PropertyTable = ({ properties, caption }: { properties: readonly Property[]; caption: string }) => {
  const [sort, setSort] = useState<SortKey | null>(null);
  const [dir, setDir] = useState<Dir>('asc');
  const rows = useMemo(() => {
    if (!sort) return properties;
    const sorted = [...properties].sort((a, b) => compare(sort, a, b));
    return dir === 'asc' ? sorted : sorted.reverse();
  }, [properties, sort, dir]);
  // none -> ascending -> descending -> declared order
  const onSort = (k: SortKey) => {
    if (sort !== k) { setSort(k); setDir('asc'); } else if (dir === 'asc') setDir('desc'); else setSort(null);
  };
  return (
    <Table.ScrollContainer minWidth={640} type="native">
      <Table striped highlightOnHover stickyHeader withTableBorder data-testid="property-table">
        <Table.Caption className="sr-only">{caption}</Table.Caption>
        <Table.Thead>
          <Table.Tr>
            <Header label="Property" k="name" sort={sort} dir={dir} onSort={onSort} />
            <Header label="Type" k="type" sort={sort} dir={dir} onSort={onSort} />
            <Table.Th>Description</Table.Th>
            <Header label="Flags" k="flags" sort={sort} dir={dir} onSort={onSort} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((p) => (
            <Table.Tr key={p.name} data-testid="property-row">
              <Table.Td style={{ minWidth: 190 }}><Text size="sm" ff="monospace" fw={600} style={{ overflowWrap: 'anywhere' }}>{p.name}</Text></Table.Td>
              <Table.Td>
                <Group gap={6} wrap="wrap">
                  <Text size="sm" ff="monospace">{p.typeLabel}</Text>
                  {p.nullable ? <Badge variant="outline" color="gray" size="xs" radius="sm">nullable</Badge> : null}
                </Group>
                <Constraints p={p} />
              </Table.Td>
              <Table.Td>{p.description ? <Text size="sm">{p.description}</Text> : <Text size="sm" c="dimmed" aria-label="No description in the dictionary">—</Text>}</Table.Td>
              <Table.Td><Flags p={p} /></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
};
