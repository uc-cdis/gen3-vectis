import React, { useCallback, useState } from 'react';
import { Alert, Badge, Group, Tabs, Text, Title } from '@mantine/core';
import { useRouter } from 'next/router';
import type { Dictionary } from '@/lib/dictionary/ddv2';
import { cleanText } from '@/lib/safe-text';
import { EntityDetail } from './EntityDetail';
import { EntityList } from './EntityList';
import { RelationshipsView } from './RelationshipsView';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The Dictionary page body: entities with their properties, and the graph vocabulary. Deep links:
 * ?entity=<name>, ?view=relationships, ?label=<graph label>. Values from the URL are only ever compared with names
 * from the dictionary, never used as markup or as a path.
 */
export const DictionaryExplorer = ({ dictionary }: { dictionary: Dictionary }) => {
  const router = useRouter();
  const q = router.query;
  const asked = first(q.entity);
  const known = asked ? dictionary.entities.find((e) => e.name === asked) : undefined;
  const entity = known ?? dictionary.entities[0]!;
  const view = first(q.view) === 'relationships' ? 'relationships' : 'entities';
  const label = first(q.label) ?? null;
  const [search, setSearch] = useState('');

  const go = useCallback((patch: Record<string, string | undefined>) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...router.query, ...patch })) { const s = first(v as string | string[] | undefined); if (s) next[k] = s; }
    void router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true });
  }, [router]);

  return (
    <div className="flex flex-col w-full h-full min-h-0" data-testid="dictionary-explorer">
      <Group justify="space-between" align="center" className="bg-base-max px-6 pt-3 border-b border-base-light" wrap="wrap">
        <Group align="baseline" gap="sm">
          <Title order={2}>Data dictionary</Title>
          <Text size="sm" c="dimmed" data-testid="dictionary-counts">{dictionary.entities.length} entities, {dictionary.propertyCount} properties, {dictionary.labels.length} graph labels</Text>
        </Group>
        <Group gap="xs" data-testid="dictionary-version">
          {dictionary.schema ? <Badge variant="outline" color="gray" radius="sm" tt="none">schema: {dictionary.schema}</Badge> : null}
          {dictionary.version ? <Badge variant="light" radius="sm" tt="none">version: {dictionary.version}</Badge> : null}
        </Group>
        <Tabs value={view} onChange={(v) => go({ view: v === 'relationships' ? 'relationships' : undefined, label: undefined })} className="w-full" keepMounted={false}>
          <Tabs.List aria-label="Dictionary sections" style={{ borderBottom: 0 }}>
            <Tabs.Tab value="entities">Entities</Tabs.Tab>
            <Tabs.Tab value="relationships">Relationships</Tabs.Tab>
          </Tabs.List>
        </Tabs>
      </Group>
      {view === 'entities' ? (
        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
          <aside className="md:w-80 md:shrink-0 p-3 border-b md:border-b-0 md:border-r border-base-light bg-base-lightest max-h-64 md:max-h-none min-h-0">
            <EntityList dictionary={dictionary} query={search} onQuery={setSearch} selected={entity.name} onSelect={(name) => go({ entity: name })} />
          </aside>
          <main className="flex-1 min-w-0 overflow-auto p-4 bg-base-lightest" aria-label="Entity details">
            {asked && !known ? <Alert color="yellow" variant="light" mb="sm">No entity named “{cleanText(asked, 40)}” in this dictionary. Showing {entity.name}.</Alert> : null}
            <EntityDetail key={entity.name} entity={entity} onOpenLabel={(l) => go({ view: 'relationships', label: l })} />
          </main>
        </div>
      ) : (
        <main className="flex-1 min-h-0 overflow-auto p-4 bg-base-lightest" aria-label="Relationships">
          <RelationshipsView dictionary={dictionary} label={label} onLabel={(l) => go({ label: l ?? undefined })} onOpenEntity={(e) => go({ view: undefined, label: undefined, entity: e })} />
        </main>
      )}
    </div>
  );
};
