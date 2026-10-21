import React, { useMemo, useState } from 'react';
import { Button, Group, Select, Stack, Text, TextInput } from '@mantine/core';
import type { MRT_ColumnDef } from 'mantine-react-table-open';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import { SimpleTable } from '@/lib/vectis-kit/entity-card/blocks';
import { useSecurity } from '../context';
import { EmptyState, EntityLink, Panel, QueryBoundary } from '@/lib/vectis-kit/ui/primitives';
import { relativeTime } from '@/lib/vectis-kit/ui/format';
import { ENTITY_INPUT_LABEL, ENTITY_INPUT_TYPES, validateEntityInput } from '../entities/entityKeys';
import { MAX_VALUE_LENGTH } from '@/lib/vectis-kit/spec/indicator';
import type { SeenEntity } from '../entities/seenRecently';
import { deriveSeenRecently } from '../entities/seenRecently';

const TYPE_OPTIONS = ENTITY_INPUT_TYPES.map((t) => ({ value: t, label: ENTITY_INPUT_LABEL[t] ?? t }));

const SeenRecently = () => {
  const { window } = useSecurity();
  const query = useSiemQuery('alerts', { body: { window, min_severity: 'medium', paging: { limit: 500 } } });
  const columns = useMemo<MRT_ColumnDef<SeenEntity>[]>(() => [
    { accessorKey: 'value', header: 'Entity', Cell: ({ row }) => <EntityLink type={row.original.type} value={row.original.value} /> },
    { accessorKey: 'type', header: 'Type', size: 90 },
    { accessorKey: 'groups', header: 'Alert groups', size: 120 },
    { accessorFn: (r) => r.lastSeen, id: 'lastSeen', header: 'Last seen', size: 120, Cell: ({ row }) => relativeTime(row.original.lastSeen) },
  ], []);
  return (
    <Panel title="Seen recently">
      <Text size="xs" c="dimmed" mb="xs">
        Addresses and indicators named by alerts of medium severity or higher in this time range. Read from the current alerts, not from a stored history.
      </Text>
      <QueryBoundary
        query={query}
        isEmpty={(d) => deriveSeenRecently(d.groups).length === 0}
        empty={<EmptyState title="No entities to show for this time range" hint="Alerts of medium severity or higher that name an address or indicator will appear here." />}
      >
        {(d) => <SimpleTable columns={columns} data={deriveSeenRecently(d.groups)} caption="Entities seen recently" pageSize={10} />}
      </QueryBoundary>
    </Panel>
  );
};

/** Entities: look up any entity, or pick one named by a recent alert. Both open the entity drawer. */
const EntitiesTab = () => {
  const { openEntity } = useSecurity();
  const [type, setType] = useState<string>('ip');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = validateEntityInput(type, value);
    if ('error' in r) { setError(r.error); return; }
    setError(null);
    openEntity(r.seed);
  };

  return (
    <Stack gap="md" data-testid="entities-tab">
      <Panel title="Look up an entity">
        <form onSubmit={submit} noValidate aria-label="Look up an entity">
          <Group align="flex-start" gap="sm">
            <Select label="Type" data={TYPE_OPTIONS} value={type} onChange={(v) => { if (v) { setType(v); setError(null); } }} allowDeselect={false} w={170} />
            <TextInput
              label="Value" placeholder="203.0.113.50" value={value} error={error}
              onChange={(e) => { setValue(e.currentTarget.value); setError(null); }}
              maxLength={MAX_VALUE_LENGTH + 1} spellCheck={false} style={{ flex: 1, minWidth: 260 }}
            />
            <Button type="submit" mt={25}>Investigate</Button>
          </Group>
        </form>
      </Panel>
      <SeenRecently />
    </Stack>
  );
};
export default EntitiesTab;
