import React, { useState } from 'react';
import { Alert, Button, Group, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import type { ApiError } from '@/lib/vectis-kit/api';
import { useSiemMutation } from '@/lib/vectis-kit/api/hooks';
import type { AlertBulkResponse, AlertPatch, TriageStatus } from '@/lib/vectis-kit/spec';
import { STATUS_LABEL } from '@/lib/vectis-kit/spec';
import { ErrorState } from '@/lib/vectis-kit/ui/primitives';
import NoiseReasonModal from './NoiseReasonModal';
import { LIMITS, validateAssignee } from './validate';

const SETTABLE: TriageStatus[] = ['new', 'triaged', 'investigating', 'resolved'];

/** Bulk actions for the selected alerts. One request per action, then the alert list is revalidated. */
const BulkBar = ({ ids, onClear }: { ids: string[]; onClear: () => void }) => {
  const bulk = useSiemMutation('alertBulk');
  const [status, setStatus] = useState<string | null>(null);
  const [assignee, setAssignee] = useState('');
  const [assigneeError, setAssigneeError] = useState<string | null>(null);
  const [noiseOpen, setNoiseOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<AlertBulkResponse | null>(null);

  const tooMany = ids.length > LIMITS.bulk;

  async function run(patch: AlertPatch): Promise<boolean> {
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await bulk({ body: { group_ids: [...new Set(ids)], patch } }, ['alerts']);
      setResult(res);
      if (Object.keys(res.failed).length === 0) onClear();
      return true;
    } catch (e) {
      setError(e as ApiError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const failed = result ? Object.entries(result.failed) : [];
  return (
    <Stack gap="xs">
      {ids.length > 0 ? (
        <Paper withBorder p="xs" radius="md" role="region" aria-label="Bulk actions">
          <Group gap="sm" align="flex-end" wrap="wrap">
            <Text size="sm" fw={600} data-testid="bulk-count">{ids.length} selected</Text>
            <Select label="Set status" size="xs" w={160} placeholder="Choose status" data={SETTABLE.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} value={status} onChange={setStatus} />
            <Button size="xs" variant="default" disabled={!status || busy || tooMany} onClick={() => status && void run({ status: status as TriageStatus })}>Apply status</Button>
            <TextInput
              label="Assign to" size="xs" w={180} maxLength={LIMITS.assignee} value={assignee} error={assigneeError ?? undefined}
              onChange={(e) => { setAssignee(e.currentTarget.value); setAssigneeError(null); }}
            />
            <Button
              size="xs" variant="default" disabled={busy || tooMany}
              onClick={() => {
                const err = validateAssignee(assignee);
                setAssigneeError(err);
                if (!err) void run({ assignee: assignee.trim() }).then((ok) => ok && setAssignee(''));
              }}
            >
              Assign
            </Button>
            <Button size="xs" color="gray" variant="light" disabled={busy || tooMany} onClick={() => setNoiseOpen(true)}>Mark as noise…</Button>
            <Button size="xs" variant="subtle" onClick={onClear}>Clear selection</Button>
          </Group>
          {tooMany ? <Text size="xs" c="red" mt="xs" role="alert">Select at most {LIMITS.bulk} alerts at a time.</Text> : null}
        </Paper>
      ) : null}
      {error ? <ErrorState error={error} /> : null}
      {result ? (
        <Alert color={failed.length ? 'orange' : 'green'} title={failed.length ? 'Some alerts were not updated' : 'Updated'} role="status">
          {result.updated.length} updated{failed.length ? `, ${failed.length} failed.` : '.'}
          {failed.length ? <ul>{failed.slice(0, 10).map(([id, why]) => <li key={id}><code>{id}</code>: {why}</li>)}</ul> : null}
        </Alert>
      ) : null}
      <NoiseReasonModal
        opened={noiseOpen}
        count={ids.length}
        busy={busy}
        onCancel={() => setNoiseOpen(false)}
        onConfirm={(reason, disposition) => void run({ noise: true, status: 'noise', disposition, reason }).then(() => setNoiseOpen(false))}
      />
    </Stack>
  );
};
export default BulkBar;
