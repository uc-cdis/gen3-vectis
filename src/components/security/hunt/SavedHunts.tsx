import React, { useState } from 'react';
import { Badge, Button, Group, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { useSiemMutation, useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import { ApiError } from '@/lib/vectis-kit/api';
import type { Hunt, QuerySpec } from '@/lib/vectis-kit/spec';
import { EmptyState, ErrorState, Panel, QueryBoundary } from '@/lib/vectis-kit/ui/primitives';
import { relativeTime } from '@/lib/vectis-kit/ui/format';
import { validateHypothesis, validateTitle } from './huntModel';

const VERDICTS = [
  { value: 'open', label: 'Open' },
  { value: 'proven', label: 'Proven' },
  { value: 'disproven', label: 'Disproven' },
  { value: 'inconclusive', label: 'Inconclusive' },
] as const;
type Verdict = Hunt['verdict'];

const toApiError = (e: unknown, route: 'huntCreate' | 'huntPatch'): ApiError =>
  e instanceof ApiError ? e : new ApiError(0, 'The security service could not be reached.', route);

const HuntCard = ({ hunt, onOpen, reload }: { hunt: Hunt; onOpen: (h: Hunt) => void; reload: () => Promise<unknown> }) => {
  const patch = useSiemMutation('huntPatch');
  const [verdict, setVerdict] = useState<Verdict>(hunt.verdict);
  const [hypothesis, setHypothesis] = useState(hunt.hypothesis);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const hypothesisError = validateHypothesis(hypothesis);
  const dirty = verdict !== hunt.verdict || hypothesis !== hunt.hypothesis;

  const save = async () => {
    if (hypothesisError || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      await patch({
        params: { id: hunt.hunt_id },
        body: { expected_etag: hunt.etag, ...(verdict !== hunt.verdict ? { verdict } : {}), ...(hypothesis !== hunt.hypothesis ? { hypothesis } : {}) },
      });
      await reload();
    } catch (e) {
      setError(toApiError(e, 'huntPatch'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="xs" component="li" style={{ listStyle: 'none' }} aria-label={`Hunt ${hunt.title}`}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <div>
          <Text fw={500} size="sm">{hunt.title}</Text>
          <Text size="xs" c="dimmed">{hunt.spec.index_name}, by {hunt.created_by}, updated {relativeTime(hunt.updated_at)}</Text>
        </div>
        <Group gap={6}>
          <Badge variant="light" size="sm">{hunt.verdict}</Badge>
          <Button size="compact-xs" variant="default" onClick={() => onOpen(hunt)} aria-label={`Open hunt ${hunt.title}`}>Open</Button>
        </Group>
      </Group>
      <Select size="xs" label="Verdict" aria-label={`Verdict for ${hunt.title}`} data={[...VERDICTS]} value={verdict} allowDeselect={false}
        onChange={(v) => v && setVerdict(v as Verdict)} />
      <Textarea size="xs" label="Hypothesis" aria-label={`Hypothesis for ${hunt.title}`} rows={3} resize="vertical" value={hypothesis}
        onChange={(e) => setHypothesis(e.currentTarget.value)} error={hypothesisError} />
      <Group>
        <Button size="compact-xs" onClick={() => void save()} disabled={!dirty || hypothesisError !== null} loading={busy} aria-label={`Save changes to ${hunt.title}`}>Save changes</Button>
      </Group>
      {error ? (
        <ErrorState error={error} onRetry={() => { setError(null); setVerdict(hunt.verdict); setHypothesis(hunt.hypothesis); void reload(); }} />
      ) : null}
    </Stack>
  );
};

/** Saved hunts: title, hypothesis and a verdict. Edits are conditional on the etag; a 412 is shown, never overwritten. */
export const SavedHunts = ({ currentSpec, onOpen }: { currentSpec: QuerySpec; onOpen: (h: Hunt) => void }) => {
  const q = useSiemQuery('hunts', {});
  const create = useSiemMutation('huntCreate');
  const [title, setTitle] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const titleError = touched ? validateTitle(title) : null;
  const hypothesisError = validateHypothesis(hypothesis);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (validateTitle(title) || hypothesisError) return;
    setBusy(true);
    setError(null);
    try {
      await create({ body: { title: title.trim(), hypothesis: hypothesis.trim(), spec: currentSpec } });
      await q.refresh();
      setTitle(''); setHypothesis(''); setTouched(false);
    } catch (err) {
      setError(toApiError(err, 'huntCreate'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Saved hunts">
      <Stack gap="md">
        <form noValidate onSubmit={(e) => void submit(e)} aria-label="Save the current view as a hunt">
          <Stack gap="xs">
            <TextInput size="xs" label="Title" withAsterisk maxLength={256} value={title} onChange={(e) => setTitle(e.currentTarget.value)} error={titleError} />
            <Textarea size="xs" label="Hypothesis" rows={3} resize="vertical" value={hypothesis} onChange={(e) => setHypothesis(e.currentTarget.value)} error={hypothesisError} />
            <Group>
              <Button type="submit" size="xs" loading={busy}>Save as hunt</Button>
              <Text size="xs" c="dimmed">Saves {currentSpec.index_name} and the current time window.</Text>
            </Group>
          </Stack>
        </form>
        {error ? <ErrorState error={error} /> : null}
        <QueryBoundary query={q} isEmpty={(d) => d.hunts.length === 0} empty={<EmptyState title="No saved hunts yet" hint="Save the current view with a hypothesis to start one." />} rows={2}>
          {(d) => (
            <Stack gap="md" component="ul" m={0} p={0}>
              {d.hunts.map((h) => <HuntCard key={`${h.hunt_id}:${h.etag}:${h.updated_at}`} hunt={h} onOpen={onOpen} reload={q.refresh} />)}
            </Stack>
          )}
        </QueryBoundary>
      </Stack>
    </Panel>
  );
};
