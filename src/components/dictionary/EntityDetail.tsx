import React, { useMemo, useState } from 'react';
import { Badge, Group, Stack, Text, TextInput, Title, UnstyledButton } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import type { Entity } from '@/lib/dictionary/ddv2';
import { cleanText } from '@/lib/safe-text';
import { PropertyTable } from './PropertyTable';

/** One entity: what it is, the graph labels that carry it, and a sortable, filterable table of its properties. */
export const EntityDetail = ({ entity, onOpenLabel }: { entity: Entity; onOpenLabel?: (label: string) => void }) => {
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const q = cleanText(filter, 100).toLowerCase();
    return q ? entity.properties.filter((p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.typeLabel.toLowerCase().includes(q)) : entity.properties;
  }, [entity, filter]);
  const piiCount = entity.properties.filter((p) => p.pii).length;
  return (
    <Stack gap="sm" data-testid="entity-detail">
      <div>
        <Group gap="sm" align="baseline">
          <Title order={3} ff="monospace" style={{ overflowWrap: 'anywhere' }}>{entity.name}</Title>
          <Badge variant="light" radius="sm">{entity.properties.length} {entity.properties.length === 1 ? 'property' : 'properties'}</Badge>
          {entity.category ? <Badge variant="outline" color="gray" radius="sm">{entity.category}</Badge> : null}
          {piiCount ? <Badge color="red" variant="light" radius="sm">{piiCount} PII</Badge> : null}
        </Group>
        {entity.description ? <Text size="sm" mt={4}>{entity.description}</Text> : null}
      </div>
      {entity.labels.length ? (
        <Group gap="xs" align="center" data-testid="entity-labels">
          <Text size="sm" c="dimmed">Carried by graph {entity.labels.length === 1 ? 'label' : 'labels'}:</Text>
          {entity.labels.map((l) => (
            <UnstyledButton key={l} onClick={() => onOpenLabel?.(l)} aria-label={`Show graph label ${l} in Relationships`} disabled={!onOpenLabel}>
              <Badge variant="light" color="grape" radius="sm" style={{ cursor: onOpenLabel ? 'pointer' : 'default', textTransform: 'none' }}>{l}</Badge>
            </UnstyledButton>
          ))}
        </Group>
      ) : null}
      {entity.properties.length === 0 ? (
        <Text c="dimmed" data-testid="no-properties">This entity has no properties in the dictionary.</Text>
      ) : (
        <>
          <TextInput
            size="xs" w={320} maxLength={100} value={filter} onChange={(e) => setFilter(e.currentTarget.value)}
            aria-label={`Filter the properties of ${entity.name}`} placeholder="Filter properties" leftSection={<IconSearch size={14} />}
            description={filter.trim() ? `${shown.length} of ${entity.properties.length} properties` : undefined}
          />
          {shown.length ? <PropertyTable properties={shown} caption={`Properties of ${entity.name}`} /> : <Text c="dimmed" data-testid="no-match">No property matches the filter.</Text>}
        </>
      )}
    </Stack>
  );
};
