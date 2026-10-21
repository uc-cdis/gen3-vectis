import React, { useState, useMemo } from 'react';
import { Alert, Button, Group, NumberInput, Select, Stack, Text, Textarea, TextInput, Code } from '@mantine/core';
import { useSiemMutation } from '@/lib/vectis-kit/api/hooks';
import { ApiError } from '@/lib/vectis-kit/api';
import type { WatchlistResponse } from '@/lib/vectis-kit/spec';
import { ErrorState, Panel } from '@/lib/vectis-kit/ui/primitives';
import { IOC_LABEL, IOC_TYPES, MAX_VALUE_LENGTH } from '@/lib/vectis-kit/spec/indicator';
import { MAX_NOTE, MAX_WATCHLIST, parseWatchlistLines } from './watchlist';
import type { MRT_ColumnDef } from 'mantine-react-table-open';
import { SimpleTable } from '@/lib/vectis-kit/entity-card/blocks';
import { safeText } from '@/lib/safe-text';

const TYPE_OPTIONS = IOC_TYPES.map((t) => ({ value: t, label: IOC_LABEL[t] }));

/** Add indicators, one value per line, up to 1000 at a time. Every field is checked against the contract before anything is sent. */
export const WatchlistForm = () => {
  const post = useSiemMutation('watchlist');
  const [type, setType] = useState<string>('ip');
  const [text, setText] = useState('');
  const [confidence, setConfidence] = useState<number | string>(75);
  const [expires, setExpires] = useState('');
  const [note, setNote] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<WatchlistResponse | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    setApiError(null);
    const parsed = parseWatchlistLines(text, { type, confidence, expires, note });
    const found = parsed.errors.map((x) => (x.line === 0 ? x.error : `Line ${x.line} (${x.value}): ${x.error}`));
    if (parsed.tooMany) found.push(`Too many entries: the limit is ${MAX_WATCHLIST} per submission. Nothing was sent.`);
    if (!parsed.tooMany && parsed.entries.length === 0 && found.length === 0) found.push('Enter at least one value.');
    setProblems(found);
    // A partly valid paste is not sent: fix the listed lines so what was submitted is exactly what was pasted.
    if (found.length > 0) return;
    setBusy(true);
    try {
      setResult(await post({ body: { entries: parsed.entries } }));
    } catch (err) {
      setApiError(err instanceof ApiError ? err : new ApiError(0, 'The request failed.', 'watchlist'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Add to the watchlist">
      <form onSubmit={(e) => void submit(e)} noValidate aria-label="Add indicators to the watchlist">
        <Stack gap="sm">
          <Text size="sm" c="dimmed">{PUBLISH_NOTE}</Text>
          <Group align="flex-start" gap="sm">
            <Select label="Type" data={TYPE_OPTIONS} value={type} onChange={(v) => v && setType(v)} allowDeselect={false} w={140} />
            <NumberInput label="Confidence (0 to 100)" min={0} max={100} step={5} allowDecimal={false} clampBehavior="none" value={confidence} onChange={setConfidence} w={180} />
            <TextInput label="Expires (optional)" type="datetime-local" value={expires} onChange={(e) => setExpires(e.currentTarget.value)} description="Must be in the future" />
          </Group>
          <Textarea
            label="Values, one per line"
            description={`Up to ${MAX_WATCHLIST} per submission. Each value up to ${MAX_VALUE_LENGTH} characters. All lines get the same type, confidence, expiry and note.`}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            autosize minRows={4} maxRows={12}
            spellCheck={false}
            styles={{ input: { fontFamily: 'monospace' } }}
          />
          <TextInput label="Note (optional)" value={note} onChange={(e) => setNote(e.currentTarget.value)} maxLength={MAX_NOTE + 1} description={`${note.length} of ${MAX_NOTE}`} />
          {problems.length ? (
            <Alert color="red" variant="light" title="Fix these before publishing" role="alert" data-testid="watchlist-problems">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {problems.slice(0, 10).map((p, i) => <li key={i}>{p}</li>)}
              </ul>
              {problems.length > 10 ? <Text size="xs">and {problems.length - 10} more.</Text> : null}
            </Alert>
          ) : null}
          <Group><Button type="submit" loading={busy}>Publish to watchlist</Button></Group>
        </Stack>
      </form>
      {apiError ? <ErrorState error={apiError} /> : null}
      {result ? <WatchlistResult result={result} /> : null}
    </Panel>
  );
};

export const PUBLISH_NOTE =
  'Publishing writes a STIX bundle to this tenant\'s storage. The next detection run reads it and starts matching traffic against the new indicators. It does not block anything and does not change alerts that already exist.';

interface Row { value: string; reason: string }

/** What the service accepted and rejected, with the reason for each rejection, and where the bundle was written. */
export const WatchlistResult = ({ result }: { result: WatchlistResponse }) => {
  const rows = useMemo<Row[]>(() => Object.entries(result.rejected).map(([value, reason]) => ({ value: safeText(value, 120), reason: safeText(reason, 200) })), [result.rejected]);
  const columns = useMemo<MRT_ColumnDef<Row>[]>(() => [{ accessorKey: 'value', header: 'Rejected value' }, { accessorKey: 'reason', header: 'Reason' }], []);
  return (
    <Stack gap="xs" data-testid="watchlist-result" aria-live="polite">
      <Alert color={result.accepted > 0 ? 'teal' : 'yellow'} variant="light">
        {result.accepted} accepted, {rows.length} rejected. Bundle: <Code>{safeText(result.bundle_key, 300)}</Code>
      </Alert>
      {rows.length ? <SimpleTable columns={columns} data={rows} caption="Rejected watchlist entries" pageSize={10} /> : <Text size="sm" c="dimmed">Nothing was rejected.</Text>}
    </Stack>
  );
};
