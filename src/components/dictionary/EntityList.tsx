import React, { useMemo } from 'react';
import { Badge, Group, ScrollArea, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import type { Dictionary } from '@/lib/dictionary/ddv2';
import { groupEntities, searchEntities } from '@/lib/dictionary/ddv2';

/** Searchable list of entities, grouped by the dictionary's own category or, without one, by graph-label coverage. */
export const EntityList = ({ dictionary, query, onQuery, selected, onSelect }: {
  dictionary: Dictionary; query: string; onQuery: (q: string) => void; selected: string | null; onSelect: (name: string) => void;
}) => {
  const hits = useMemo(() => searchEntities(dictionary, query), [dictionary, query]);
  const groups = useMemo(() => {
    const keep = new Map(hits.map((h) => [h.entity.name, h.properties]));
    return groupEntities(dictionary)
      .map((g) => ({ title: g.title, entities: g.entities.filter((e) => keep.has(e.name)) }))
      .filter((g) => g.entities.length)
      .map((g) => ({ ...g, matched: keep }));
  }, [dictionary, hits]);
  return (
    <Stack gap="xs" className="h-full min-h-0">
      <TextInput
        aria-label="Search entities and properties" placeholder="Search entities and properties" maxLength={100}
        leftSection={<IconSearch size={14} />} value={query} onChange={(e) => onQuery(e.currentTarget.value)}
        description={query.trim() ? `${hits.length} of ${dictionary.entities.length} entities match` : undefined}
      />
      <ScrollArea className="flex-1 min-h-0" type="auto">
        <nav aria-label="Entities">
          {groups.length === 0 ? <Text size="sm" c="dimmed" p="xs" data-testid="no-entities">No entity or property matches.</Text> : null}
          {groups.map((g) => (
            <section key={g.title} aria-label={g.title} className="mb-3">
              <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="xs" mb={2}>{g.title} ({g.entities.length})</Text>
              <ul className="m-0 p-0 list-none">
                {g.entities.map((e) => {
                  const active = e.name === selected;
                  const via = g.matched.get(e.name) ?? [];
                  return (
                    <li key={e.name}>
                      <UnstyledButton
                        onClick={() => onSelect(e.name)} aria-current={active ? 'true' : undefined} data-testid="entity-item"
                        className={`w-full px-2 py-1.5 rounded text-left ${active ? 'bg-accent-lightest font-semibold' : 'hover:bg-base-lighter'}`}
                        style={active ? { borderLeft: '3px solid var(--mantine-primary-color-filled)' } : { borderLeft: '3px solid transparent' }}
                      >
                        <Group justify="space-between" wrap="nowrap" gap="xs">
                          <Text size="sm" ff="monospace" truncate>{e.name}</Text>
                          <Badge variant="light" color="gray" size="sm" radius="sm" aria-label={`${e.properties.length} properties`}>{e.properties.length}</Badge>
                        </Group>
                        {via.length ? <Text size="xs" c="dimmed" truncate>property: {via.slice(0, 3).join(', ')}{via.length > 3 ? ` +${via.length - 3}` : ''}</Text> : null}
                      </UnstyledButton>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </nav>
      </ScrollArea>
    </Stack>
  );
};
