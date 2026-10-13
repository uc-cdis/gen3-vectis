import React, { useState } from 'react';
import { Alert, Button, Collapse, Group, NumberInput, Select, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { ApiError } from '@/lib/vectis-kit/api';
import { useSiemMutation, useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { AlertGroup, CaseCreate, DecisionRequest, TriageStatus } from '@/lib/vectis-kit/spec';
import { STATUS_LABEL } from '@/lib/vectis-kit/spec';
import { useSecurity } from '../context';
import { ErrorState } from '@/lib/vectis-kit/ui/primitives';
import NoiseReasonModal from './NoiseReasonModal';
import type { IocType } from '@/lib/vectis-kit/spec/indicator';
import { LIMITS, validateAssignee, validateComment, validateConfidence, validateIndicator, validateNote } from './validate';
import { IOC_TYPES } from '@/lib/vectis-kit/spec/indicator';

const SETTABLE: TriageStatus[] = ['new', 'triaged', 'investigating', 'resolved'];
const DISPOSITIONS = [
  { value: 'true_positive', label: 'True positive' },
  { value: 'false_positive', label: 'False positive' },
  { value: 'benign', label: 'Benign' },
  { value: 'true_negative', label: 'True negative' },
  { value: 'false_negative', label: 'False negative' },
  { value: 'unknown', label: 'Unknown' },
];
const PRIORITY: Record<AlertGroup['severity'], NonNullable<CaseCreate['priority']>> = { critical: 'critical', high: 'high', medium: 'medium', low: 'low', info: 'low' };

/** Runs one write, tracks busy/error/success so every action reports its outcome the same way. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(true); setError(null); setDone(null);
    try { await fn(); setDone(success); return true; } catch (e) { setError(e as ApiError); return false; } finally { setBusy(false); }
  }
  return { busy, error, done, run };
}

/** Everything an analyst can do to one alert. Each write revalidates the alert list. */
const AlertActions = ({ group }: { group: AlertGroup }) => {
  const { goTab, openEntity } = useSecurity();
  const patch = useSiemMutation('alertPatch');
  const decide = useSiemMutation('decision');
  const createCase = useSiemMutation('caseCreate');
  const watch = useSiemMutation('watchlist');
  const cases = useSiemQuery('cases', {});
  const act = useAction();
  const id = group.group_id;
  const params = { id };

  const [status, setStatus] = useState<string | null>(null);
  const [assignee, setAssignee] = useState('');
  const [assigneeErr, setAssigneeErr] = useState<string | null>(null);
  const [noiseOpen, setNoiseOpen] = useState(false);
  const [disp, setDisp] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [caseId, setCaseId] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);

  const [wlOpen, setWlOpen] = useState(false);
  const [wlType, setWlType] = useState<IocType>('ip');
  const [wlValue, setWlValue] = useState(group.matched_indicators?.[0] ?? '');
  const [wlConf, setWlConf] = useState('75');
  const [wlNote, setWlNote] = useState('');
  const [wlErrs, setWlErrs] = useState<Record<string, string | null>>({});

  const shownCase = caseId ?? group.case_id ?? null;

  return (
    <Stack gap="sm">
      <Group align="flex-end" gap="xs" wrap="wrap">
        <Select label="Status" size="xs" w={170} placeholder="Choose status" data={SETTABLE.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} value={status} onChange={setStatus} />
        <Button size="xs" variant="default" disabled={!status || act.busy} onClick={() => status && void act.run(() => patch({ params, body: { status: status as TriageStatus } }, ['alerts']), `Status set to ${STATUS_LABEL[status as TriageStatus]}.`)}>Set status</Button>
      </Group>
      <Group align="flex-end" gap="xs" wrap="wrap">
        <TextInput label="Assign to" size="xs" w={220} maxLength={LIMITS.assignee} value={assignee} error={assigneeErr ?? undefined} onChange={(e) => { setAssignee(e.currentTarget.value); setAssigneeErr(null); }} />
        <Button size="xs" variant="default" disabled={act.busy} onClick={() => {
          const err = validateAssignee(assignee); setAssigneeErr(err);
          if (!err) void act.run(() => patch({ params, body: { assignee: assignee.trim() } }, ['alerts']), `Assigned to ${assignee.trim()}.`);
        }}>Assign</Button>
        <Button size="xs" variant="light" color="gray" disabled={act.busy} onClick={() => setNoiseOpen(true)}>Mark as noise…</Button>
      </Group>

      <Stack gap="xs">
        <Group align="flex-end" gap="xs" wrap="wrap">
          <Select label="Disposition" size="xs" w={200} placeholder="Choose disposition" data={DISPOSITIONS} value={disp} onChange={setDisp} />
          <Button size="xs" variant="default" disabled={!disp || act.busy || validateComment(comment) !== null} onClick={() => disp && void act.run(() => decide({ body: { group_id: id, disposition: disp as DecisionRequest['disposition'], comment: comment.trim() } }, ['alerts']), 'Disposition recorded.')}>Record disposition</Button>
        </Group>
        <Textarea label="Comment (optional)" size="xs" rows={2} maxLength={LIMITS.comment} value={comment} error={validateComment(comment) ?? undefined} onChange={(e) => setComment(e.currentTarget.value)} />
      </Stack>

      {(group.top_sources ?? []).length > 0 ? (
        <Group gap="xs" wrap="wrap" aria-label="Investigate">
          <Text size="xs" c="dimmed">Investigate</Text>
          {(group.top_sources ?? []).slice(0, 3).map((src) => (
            <Button key={`${src.type}:${src.value}`} size="compact-xs" variant="default" ff="monospace" onClick={() => openEntity(src)}>{src.value.slice(0, 60)}</Button>
          ))}
        </Group>
      ) : null}

      <Group gap="xs" wrap="wrap">
        <Button size="xs" disabled={act.busy || shownCase !== null} onClick={() => void act.run(async () => {
          const rec = await createCase({ body: { title: group.title.slice(0, LIMITS.caseTitle), group_ids: [id], priority: PRIORITY[group.severity] } }, ['alerts', 'cases']);
          setCaseId(rec.case_id);
        }, 'Case created.')}>Create case</Button>
        {shownCase ? <Button size="xs" variant="light" data-testid="case-id" onClick={() => goTab('cases', { case: shownCase })}>Open case {shownCase}</Button> : null}
        <Button size="xs" variant="default" onClick={() => goTab('hunt', { similar: id })}>Find similar</Button>
        {shownCase === null && (cases.data?.cases ?? []).some((c) => c.status !== 'closed' && c.status !== 'resolved') ? (
          <Group gap={4} wrap="nowrap">
            <Select size="xs" w={200} aria-label="Add to an existing case" placeholder="Add to existing case" data={(cases.data?.cases ?? []).filter((c) => c.status !== 'closed' && c.status !== 'resolved').map((c) => ({ value: c.case_id, label: c.title.slice(0, 60) }))} value={existing} onChange={setExisting} />
            <Button size="xs" variant="default" disabled={!existing || act.busy} onClick={() => existing && void act.run(async () => { await patch({ params, body: { case_id: existing } }, ['alerts', 'alertGet', 'cases']); setCaseId(existing); }, 'Added to the case.')}>Add</Button>
          </Group>
        ) : null}
        <Button size="xs" variant="default" aria-expanded={wlOpen} onClick={() => setWlOpen((o) => !o)}>Add indicator to watchlist</Button>
      </Group>

      <Collapse expanded={wlOpen}>
        <Stack gap="xs" p="xs" aria-label="Add indicator to watchlist" role="group">
          <Group gap="xs" align="flex-start" wrap="wrap">
            <Select label="Type" size="xs" w={110} allowDeselect={false} data={[...IOC_TYPES]} value={wlType} onChange={(v) => v && setWlType(v as IocType)} />
            <TextInput label="Value" size="xs" w={260} maxLength={LIMITS.value} value={wlValue} error={wlErrs.value ?? undefined} onChange={(e) => setWlValue(e.currentTarget.value)} />
            <NumberInput label="Confidence" size="xs" w={110} min={0} max={100} allowDecimal={false} value={wlConf} error={wlErrs.conf ?? undefined} onChange={(v) => setWlConf(String(v))} />
          </Group>
          <TextInput label="Note (optional)" size="xs" maxLength={LIMITS.note} value={wlNote} error={wlErrs.note ?? undefined} onChange={(e) => setWlNote(e.currentTarget.value)} />
          <Button size="xs" w="fit-content" disabled={act.busy} onClick={() => {
            const errs = { value: validateIndicator(wlType, wlValue), conf: validateConfidence(wlConf), note: validateNote(wlNote) };
            setWlErrs(errs);
            if (errs.value || errs.conf || errs.note) return;
            void act.run(async () => {
              const r = await watch({ body: { entries: [{ type: wlType, value: wlValue.trim(), confidence: Number(wlConf), note: wlNote }] } });
              const why = Object.values(r.rejected)[0];
              if (r.accepted < 1) throw new ApiError(422, why ?? 'The watchlist rejected this indicator.', 'watchlist');
            }, 'Indicator added to the watchlist.');
          }}>Add to watchlist</Button>
        </Stack>
      </Collapse>

      {act.error ? <ErrorState error={act.error} /> : null}
      {act.done ? <Alert color="green" role="status" py={6}>{act.done}</Alert> : null}

      <NoiseReasonModal
        opened={noiseOpen}
        count={1}
        busy={act.busy}
        onCancel={() => setNoiseOpen(false)}
        onConfirm={(reason, disposition) => void act.run(() => patch({ params, body: { noise: true, status: 'noise', disposition, reason, expected_etag: group.etag ?? undefined } }, ['alerts', 'alertGet']), 'Marked as noise.').then(() => setNoiseOpen(false))}
      />
    </Stack>
  );
};
export default AlertActions;
