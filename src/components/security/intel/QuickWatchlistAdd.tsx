import React, { useState } from 'react';
import { Button, Group, NumberInput, Stack, Text, TextInput } from '@mantine/core';
import { useSiemMutation } from '@/lib/vectis-kit/api/hooks';
import { ApiError } from '@/lib/vectis-kit/api';
import type { EntitySeed, WatchlistResponse } from '@/lib/vectis-kit/spec';
import { ErrorState } from '@/lib/vectis-kit/ui/primitives';
import { isIocType } from '@/lib/vectis-kit/spec/indicator';
import { PUBLISH_NOTE, WatchlistResult } from '@/components/security/intel/WatchlistForm';
import { MAX_NOTE, validateWatchlistEntry } from './watchlist';

/** Add the one entity in front of you to the watchlist. Same validation as the Intel form. */
export const QuickWatchlistAdd = ({ seed }: { seed: EntitySeed }) => {
  const post = useSiemMutation('watchlist');
  const [confidence, setConfidence] = useState<number | string>(75);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<WatchlistResponse | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    setApiError(null);
    const r = validateWatchlistEntry({ type: seed.type, value: seed.value, confidence, note });
    if (!r.ok) { setProblem(r.error); return; }
    setProblem(null);
    setBusy(true);
    try {
      setResult(await post({ body: { entries: [r.entry] } }));
    } catch (err) {
      setApiError(err instanceof ApiError ? err : new ApiError(0, 'The request failed.', 'watchlist'));
    } finally {
      setBusy(false);
    }
  };

  if (!isIocType(seed.type)) return <Text size="sm" c="dimmed">Only addresses, domains, URLs, hashes and email addresses can be watched.</Text>;
  return (
    <form onSubmit={(e) => void submit(e)} noValidate aria-label="Add to watchlist">
      <Stack gap="xs">
        <Text size="xs" c="dimmed">{PUBLISH_NOTE}</Text>
        <Group align="flex-start" gap="sm">
          <NumberInput label="Confidence (0 to 100)" min={0} max={100} allowDecimal={false} clampBehavior="none" value={confidence} onChange={setConfidence} w={170} size="xs" />
          <TextInput label="Note (optional)" value={note} onChange={(e) => setNote(e.currentTarget.value)} maxLength={MAX_NOTE + 1} size="xs" style={{ flex: 1 }} />
          <Button type="submit" size="xs" mt={25} loading={busy}>Publish</Button>
        </Group>
        {problem ? <Text size="sm" c="red" role="alert">{problem}</Text> : null}
        {apiError ? <ErrorState error={apiError} /> : null}
        {result ? <WatchlistResult result={result} /> : null}
      </Stack>
    </form>
  );
};
