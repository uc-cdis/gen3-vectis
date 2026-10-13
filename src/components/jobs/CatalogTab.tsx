import React from 'react';
import { Accordion, ActionIcon, Badge, Button, Card, Code, Drawer, Group, SimpleGrid, Stack, Text, Title, Tooltip } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import type { CatalogDef } from '@/lib/jobs/jobdef/types';
import { isDagDef } from '@/lib/jobs/jobdef/types';
import type { CatalogResponse } from '@/lib/jobs/api';
import { useJobsQuery } from '@/lib/jobs/api/hooks';
import Time from '@/lib/vectis-kit/ui/Time';
import { EmptyState, LoadingState, Panel } from '@/lib/vectis-kit/ui/primitives';
import { ErrorState } from './common';
import { FlowDiagram } from './FlowDiagram';
import { flowFromDef } from './flow';
import { resourcesText } from './model';

export const useCatalog = () => useJobsQuery<CatalogResponse>('catalog', [], (a) => a.catalog());

const Dash = () => <Text span size="sm" c="dimmed">—</Text>;

const SourceLine = ({ c }: { c: CatalogResponse }) => (
  <Group gap="xs" data-testid="catalog-source">
    <Text size="sm" c="dimmed">Catalog version:</Text>
    <Code>{c.repo ?? '—'}@{c.ref ?? '—'}</Code>
    <Text size="sm" c="dimmed">commit</Text>
    <Code>{c.sha ? c.sha.slice(0, 7) : '—'}</Code>
    <Text size="sm" c="dimmed">fetched</Text>
    <Time iso={c.fetched_at} />
  </Group>
);

const SecretsLine = ({ names }: { names: readonly string[] | undefined }) => (
  <Text component="div" size="sm">
    <Text span fw={600}>Secrets needed: </Text>
    {names?.length ? names.map((n, i) => <React.Fragment key={n}>{i ? ', ' : ''}<Code>{n}</Code></React.Fragment>) : 'none'}
    {names?.length ? <Text component="div" size="xs" c="dimmed">Names only. Secret values are never shown.</Text> : null}
  </Text>
);

/** What kind of job this is, as plain text: "Container" or "Workflow · dagu". */
const kindLabel = (d: CatalogDef): string => (isDagDef(d) ? `Workflow · ${d.engine}` : 'Container');
const KindBadge = ({ def }: { def: CatalogDef }) => <Badge variant="filled" color={isDagDef(def) ? 'grape' : 'gray'} radius="sm" size="sm" data-testid="kind-badge">{kindLabel(def)}</Badge>;

const JobCard = ({ def, onRun, onDetails }: { def: CatalogDef; onRun: () => void; onDetails: () => void }) => (
  <Card withBorder radius="md" padding="md" component="article" aria-label={def.name} data-testid="job-card" style={{ display: 'flex', flexDirection: 'column' }}>
    <Stack gap="xs" style={{ flex: 1 }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Title order={4} style={{ overflowWrap: 'anywhere' }}>{def.name}</Title>
        {def.owner ? <Badge variant="outline" color="gray" radius="sm" size="sm" title="Owner">{def.owner}</Badge> : null}
      </Group>
      <Group gap={4}><KindBadge def={def} /></Group>
      <Text size="sm" c="dimmed" lineClamp={3}>{def.description || 'No description.'}</Text>
      {def.tags?.length ? <Group gap={4}>{def.tags.map((t) => <Badge key={t} variant="light" radius="sm" size="sm">{t}</Badge>)}</Group> : null}
      {isDagDef(def) ? (
        <Text size="sm"><Text span fw={600}>Steps: </Text>{def.graph?.length ?? 0}</Text>
      ) : (
        <>
          <Text size="sm"><Text span fw={600}>Image: </Text><Code style={{ overflowWrap: 'anywhere' }}>{def.image}</Code></Text>
          <Text size="sm"><Text span fw={600}>Resources: </Text>{resourcesText(def.resources)}</Text>
          <SecretsLine names={def.secrets} />
        </>
      )}
    </Stack>
    <Group mt="md" gap="xs">
      <Button size="xs" onClick={onRun} aria-label={`Run ${def.name}`}>Run</Button>
      <Button size="xs" variant="default" onClick={onDetails} aria-label={`Details of ${def.name}`}>Details</Button>
    </Group>
  </Card>
);

export const JobDetailsDrawer = ({ def, onClose, onRun }: { def: CatalogDef; onClose: () => void; onRun: () => void }) => (
  <Drawer opened onClose={onClose} position="right" size="xl" returnFocus title={<Title order={4} component="span">{def.name}</Title>}>
    <Stack gap="md">
      <Text size="sm">{def.description || 'No description.'}</Text>
      <Panel title="How it runs">
        <FlowDiagram nodes={flowFromDef(def)} label={`Steps of ${def.name}`} />
      </Panel>
      <Panel title="Parameters">
        {def.params?.length ? (
          <Stack gap={4}>
            {def.params.map((p) => (
              <Text size="sm" key={p.name}><Code>{p.name}</Code> {p.label} <Text span c="dimmed">({p.type}{p.required ? ', required' : ''})</Text></Text>
            ))}
          </Stack>
        ) : <Text size="sm" c="dimmed">This job takes no parameters.</Text>}
      </Panel>
      <Panel title="Details">
        <Stack gap={4}>
          <Text size="sm">Kind: {kindLabel(def)}</Text>
          {isDagDef(def) ? (
            <Text size="sm">Executors: {[...new Set((def.graph ?? []).map((g) => g.executor).filter(Boolean))].map((e, i) => <React.Fragment key={e}>{i ? ', ' : ''}<Code>{e}</Code></React.Fragment>)}</Text>
          ) : (
            <>
              <Text size="sm">Image: <Code>{def.image}</Code></Text>
              <Text size="sm">Resources: {resourcesText(def.resources)}</Text>
            </>
          )}
          <Text size="sm">Owner: {def.owner || <Dash />}</Text>
          {isDagDef(def) ? null : <SecretsLine names={def.secrets} />}
        </Stack>
      </Panel>
      <Group><Button onClick={onRun}>Run</Button></Group>
    </Stack>
  </Drawer>
);

const CatalogTab = ({ onRun, onDetails }: { onRun: (id: string) => void; onDetails: (id: string) => void }) => {
  const q = useCatalog();
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refresh()} />;
  if (!q.data) return <LoadingState rows={3} />;
  const c = q.data;
  if (!c.configured) {
    return (
      <div data-testid="catalog-unconfigured">
        <EmptyState
          title="The job catalog is not configured"
          hint="An administrator sets the catalog repository (the TES_CATALOG_REPO setting, plus optionally TES_CATALOG_PATH, TES_CATALOG_REF and, for private repositories, TES_CATALOG_GITHUB_TOKEN) on the portal. Until then there are no jobs to run."
        />
      </div>
    );
  }
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <SourceLine c={c} />
        <Tooltip label="Reload the catalog" withArrow>
          <ActionIcon variant="default" aria-label="Reload catalog" onClick={() => void q.refresh()} loading={q.stale}><IconRefresh size={16} /></ActionIcon>
        </Tooltip>
      </Group>
      {c.errors.length ? (
        <Accordion variant="contained" data-testid="catalog-errors">
          <Accordion.Item value="errors">
            <Accordion.Control>{c.errors.length} {c.errors.length === 1 ? 'definition' : 'definitions'} could not be loaded</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                {c.errors.map((e, i) => (
                  <div key={`${e.file}-${i}`}>
                    <Text size="sm" fw={600} ff="monospace">{e.file}</Text>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>{e.errors.map((m, j) => <li key={j}><Text span size="sm">{m}</Text></li>)}</ul>
                  </div>
                ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      ) : null}
      {c.jobs.length === 0 ? <EmptyState title="No job definitions" hint="The catalog is configured but contains no valid definitions." /> : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {c.jobs.map(({ def, file }) => <JobCard key={`${file}-${def.id}`} def={def} onRun={() => onRun(def.id)} onDetails={() => onDetails(def.id)} />)}
        </SimpleGrid>
      )}
    </Stack>
  );
};

export default CatalogTab;
