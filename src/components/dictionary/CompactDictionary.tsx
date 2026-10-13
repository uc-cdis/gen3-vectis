import React, { useMemo, useState } from 'react';
import { Accordion, Anchor, Badge, Group, ScrollArea, Stack, Text, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import type { Dictionary } from '@/lib/dictionary/ddv2';
import { searchEntities } from '@/lib/dictionary/ddv2';
import type { DictionaryLoader } from '@/lib/dictionary/load';
import { useDictionary } from '@/lib/dictionary/load';
import { DictionaryBoundary } from './states';

const FULL_PAGE = '/DataDictionary';

const Body = ({ dictionary }: { dictionary: Dictionary }) => {
  const [query, setQuery] = useState('');
  const hits = useMemo(() => searchEntities(dictionary, query), [dictionary, query]);
  return (
    <Stack gap="xs" className="h-full min-h-0 p-2 bg-base-lightest" data-testid="compact-dictionary">
      <Group justify="space-between" gap={4} wrap="nowrap">
        <Text size="xs" c="dimmed">{dictionary.entities.length} entities, {dictionary.propertyCount} properties</Text>
        {dictionary.version ? <Badge variant="light" size="xs" radius="sm" tt="none" title={`schema ${dictionary.schema}`}>{dictionary.version}</Badge> : null}
      </Group>
      <TextInput
        size="xs" aria-label="Search entities and properties" placeholder="Search entities and properties" maxLength={100}
        leftSection={<IconSearch size={14} />} value={query} onChange={(e) => setQuery(e.currentTarget.value)}
        description={query.trim() ? `${hits.length} of ${dictionary.entities.length} entities match` : undefined}
      />
      <ScrollArea className="flex-1 min-h-0" type="auto">
        {hits.length === 0 ? <Text size="xs" c="dimmed" data-testid="no-entities">No entity or property matches.</Text> : null}
        <Accordion variant="separated" styles={{ control: { paddingBlock: 4, paddingInline: 8, minHeight: 34 }, content: { paddingInline: 8, paddingBlock: 4 } }} radius="sm" chevronPosition="left" multiple={false} key={query ? 'q' : 'all'} defaultValue={query && hits.length === 1 ? hits[0]!.entity.name : null}>
          {hits.map(({ entity, properties }) => (
            <Accordion.Item key={entity.name} value={entity.name} data-testid="compact-entity">
              <Accordion.Control>
                <Group justify="space-between" wrap="nowrap" gap={4}>
                  <Text size="xs" ff="monospace" fw={600} truncate>{entity.name}</Text>
                  <Badge variant="light" color="gray" size="xs" radius="sm" aria-label={`${entity.properties.length} properties`}>{entity.properties.length}</Badge>
                </Group>
                {properties.length ? <Text size="xs" c="dimmed" truncate>property: {properties.slice(0, 2).join(', ')}{properties.length > 2 ? ` +${properties.length - 2}` : ''}</Text> : null}
              </Accordion.Control>
              <Accordion.Panel>
                <Anchor size="xs" href={`${FULL_PAGE}?entity=${encodeURIComponent(entity.name)}`} target="_blank" rel="noopener noreferrer">Open in the dictionary</Anchor>
                {entity.labels.length ? <Text size="xs" c="dimmed" mt={2}>Graph: {entity.labels.join(', ')}</Text> : null}
                <ul className="m-0 mt-1 p-0 list-none">
                  {entity.properties.map((p) => (
                    <li key={p.name} className="py-1 border-t border-base-light" data-testid="compact-property">
                      <Group gap={4} wrap="nowrap" justify="space-between" align="baseline">
                        <Text size="xs" ff="monospace" fw={600} style={{ overflowWrap: 'anywhere' }}>{p.name}</Text>
                        <Group gap={3} wrap="nowrap">
                          {p.pii ? <Badge color="red" variant="light" size="xs" radius="sm">PII</Badge> : null}
                          {p.required ? <Badge color="blue" size="xs" radius="sm">req</Badge> : null}
                          <Text size="xs" c="dimmed" ff="monospace">{p.typeLabel}{p.nullable ? '?' : ''}</Text>
                        </Group>
                      </Group>
                      {p.description ? <Text size="xs" c="dimmed" lineClamp={2} title={p.description}>{p.description}</Text> : null}
                    </li>
                  ))}
                  {entity.properties.length === 0 ? <li><Text size="xs" c="dimmed">No properties.</Text></li> : null}
                </ul>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </ScrollArea>
    </Stack>
  );
};

/** The dictionary at the width of a side rail: a search box over a list of entities that expand to their properties. */
export const CompactDictionary = ({ loader }: { loader?: DictionaryLoader }) => {
  const state = useDictionary(loader);
  return <DictionaryBoundary state={state} retry={state.retry}>{(d) => <Body dictionary={d} />}</DictionaryBoundary>;
};
