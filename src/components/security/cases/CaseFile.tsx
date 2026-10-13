import React, { useState } from 'react';
import { Alert, Anchor, Badge, Button, Group, Select, SimpleGrid, Stack, TagsInput, Text, TextInput, Textarea, Title, Tooltip } from '@mantine/core';
import { ApiError } from '@/lib/vectis-kit/api';
import { useSiemMutation, useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { CasePatch, CaseRecord } from '@/lib/vectis-kit/spec';
import { useSecurity } from '../context';
import { formatTime, relativeTime } from '@/lib/vectis-kit/ui/format';
import { describeError, Panel, QueryBoundary } from '@/lib/vectis-kit/ui/primitives';
import type { CaseStatus, FieldErrors, Priority } from './caseModel';
import {
  CASE_STATUS_COLOR, CASE_STATUS_LABEL, LIMITS, PRIORITIES, PRIORITY_COLOR, PRIORITY_LABEL, STATUSES, buildPatch, validateCaseFields, validateNote,
} from './caseModel';
import { NotesTimeline } from './CaseNotes';

const INVALIDATE = ['cases', 'caseGet'] as const;

/** Shared by the edit form and the add-note form: send a conditional patch, and turn a 412 into a visible conflict. */
function useCasePatch(onConflict: () => void) {
  const patch = useSiemMutation('casePatch');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (id: string, body: CasePatch): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await patch({ params: { id }, body }, [...INVALIDATE]);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 412) onConflict();
      else setError(e instanceof ApiError ? describeError(e).message : 'The change could not be saved.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { send, busy, error };
}

const EditForm = ({ rec, onConflict, onSaved }: { rec: CaseRecord; onConflict: () => void; onSaved: () => void }) => {
  const [title, setTitle] = useState(rec.title);
  const [description, setDescription] = useState(rec.description);
  const [priority, setPriority] = useState<Priority>(rec.priority);
  const [status, setStatus] = useState<CaseStatus>(rec.status);
  const [assignee, setAssignee] = useState(rec.assignee ?? '');
  const [tags, setTags] = useState<string[]>(rec.tags);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [info, setInfo] = useState<string | null>(null);
  const { send, busy, error } = useCasePatch(onConflict);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setInfo(null);
    const found = validateCaseFields({ title, description, tags, assignee });
    setErrors(found);
    if (Object.keys(found).length) return;
    const body = buildPatch(rec, { title, description, tags, assignee, priority, status });
    if (!body) { setInfo('Nothing to save: no field has changed.'); return; }
    if (await send(rec.case_id, body)) onSaved();
  };

  return (
    <form onSubmit={(e) => void save(e)} noValidate aria-label="Edit case">
      <Stack gap="sm">
        <TextInput label="Title" required value={title} onChange={(e) => setTitle(e.currentTarget.value)} error={errors.title} />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select label="Status" allowDeselect={false} data={STATUSES.map((s) => ({ value: s, label: CASE_STATUS_LABEL[s] }))} value={status} onChange={(v) => v && setStatus(v as CaseStatus)} />
          <Select label="Priority" allowDeselect={false} data={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} value={priority} onChange={(v) => v && setPriority(v as Priority)} />
          <TextInput label="Assignee" description={rec.assignee ? 'Clearing is not supported; enter a new assignee to reassign.' : undefined}
            value={assignee} onChange={(e) => setAssignee(e.currentTarget.value)} error={errors.assignee} />
        </SimpleGrid>
        <TagsInput label="Tags" description={`Up to ${LIMITS.tagsMax}`} value={tags} onChange={setTags} error={errors.tags} />
        <Textarea label="Description" rows={3} styles={{ input: { resize: 'vertical' } }} value={description} onChange={(e) => setDescription(e.currentTarget.value)} error={errors.description} />
        {error ? <Text role="alert" size="sm" c="red">{error}</Text> : null}
        {info ? <Text component="output" display="block" size="sm" c="dimmed">{info}</Text> : null}
        <Group><Button type="submit" loading={busy}>Save changes</Button></Group>
      </Stack>
    </form>
  );
};

const AddNote = ({ rec, onConflict }: { rec: CaseRecord; onConflict: () => void }) => {
  const [body, setBody] = useState('');
  const [err, setErr] = useState<string | undefined>();
  const { send, busy, error } = useCasePatch(onConflict);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validateNote(body);
    setErr(v);
    if (v) return;
    if (await send(rec.case_id, { expected_etag: rec.etag, add_note: body.trim() })) setBody('');
  };
  return (
    <form onSubmit={(e) => void add(e)} noValidate aria-label="Add note">
      <Stack gap="xs">
        <Textarea label="Add a note" description={`${body.trim().length}/${LIMITS.noteMax}. Plain text; markup is shown as typed.`} rows={3} styles={{ input: { resize: 'vertical' } }}
          value={body} onChange={(e) => setBody(e.currentTarget.value)} error={err} />
        {error ? <Text role="alert" size="sm" c="red">{error}</Text> : null}
        <Group><Button type="submit" size="xs" loading={busy}>Add note</Button></Group>
      </Stack>
    </form>
  );
};

/** There is no endpoint to request a case summary, so this is a labelled placeholder, never a working control. */
const AiSlot = ({ rec }: { rec: CaseRecord }) => {
  const agentNotes = rec.notes.filter((n) => n.author_kind === 'agent').length;
  return (
    <Panel title="AI analyst">
      <Stack gap="xs">
        <Text size="sm">{agentNotes === 0 ? 'No AI-generated notes on this case.' : `${agentNotes} AI-generated ${agentNotes === 1 ? 'note' : 'notes'} in the timeline below.`}</Text>
        <Group gap="sm">
          <Tooltip label="The AI gateway is not configured">
            <Button size="xs" variant="default" disabled data-disabled aria-describedby="ai-slot-reason">Generate summary</Button>
          </Tooltip>
          <Text id="ai-slot-reason" size="xs" c="dimmed">The AI gateway is not configured, so summaries cannot be generated here.</Text>
        </Group>
      </Stack>
    </Panel>
  );
};

const CaseBody = ({ rec, onReload }: { rec: CaseRecord; onReload: () => void }) => {
  const { openAlert } = useSecurity();
  const [conflict, setConflict] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [saved, setSaved] = useState(false);
  const reload = () => { setConflict(false); setSaved(false); setResetKey((k) => k + 1); onReload(); };
  return (
    <Stack gap="md">
      {conflict ? (
        <Alert color="orange" title="Not saved" role="alert" data-testid="conflict">
          <Group justify="space-between">
            <Text size="sm">This case changed since you opened it. Your edit was not saved so nobody's work is overwritten.</Text>
            <Button size="xs" variant="default" onClick={reload}>Reload case</Button>
          </Group>
        </Alert>
      ) : null}
      <Group gap="xs">
        <Badge color={CASE_STATUS_COLOR[rec.status]} variant="light">{CASE_STATUS_LABEL[rec.status]}</Badge>
        <Badge color={PRIORITY_COLOR[rec.priority]} variant="filled">Priority: {PRIORITY_LABEL[rec.priority]}</Badge>
        <Text size="xs" c="dimmed">{rec.case_id} · created {formatTime(rec.created_at)} · updated {relativeTime(rec.updated_at)}</Text>
      </Group>
      <Panel title="Details">{saved ? <Text component="output" display="block" size="sm" c="green" mb="xs">Changes saved.</Text> : null}
        <EditForm key={`${rec.etag}:${resetKey}`} rec={rec} onConflict={() => setConflict(true)} onSaved={() => setSaved(true)} /></Panel>
      <Panel title={`Linked alerts (${rec.group_ids.length})`}>
        {rec.group_ids.length === 0 ? <Text size="sm" c="dimmed">No alerts are linked to this case.</Text> : (
          <Group gap="xs" component="ul" p={0} m={0} style={{ listStyle: 'none' }}>
            {rec.group_ids.map((g) => (
              <li key={g}><Anchor component="button" type="button" size="sm" ff="monospace" onClick={() => openAlert(g)} aria-label={`Open alert ${g}`}>{g}</Anchor></li>
            ))}
          </Group>
        )}
      </Panel>
      <AiSlot rec={rec} />
      <Panel title={`Notes (${rec.notes.length})`}>
        <Stack gap="md">
          <NotesTimeline notes={rec.notes} />
          <AddNote key={`n${rec.etag}`} rec={rec} onConflict={() => setConflict(true)} />
        </Stack>
      </Panel>
    </Stack>
  );
};

export const CaseFile = ({ caseId, onClose }: { caseId: string; onClose: () => void }) => {
  const query = useSiemQuery('caseGet', { params: { id: caseId } });
  const current = query.data?.case_id === caseId ? query.data : undefined;
  return (
    <Stack gap="md" data-testid="case-file">
      <Group>
        <Button variant="default" size="xs" onClick={onClose}>Back to cases</Button>
        <Title order={4}>{current ? current.title : 'Case'}</Title>
      </Group>
      <QueryBoundary query={{ ...query, data: current }} rows={6}>
        {(rec) => <CaseBody rec={rec} onReload={() => void query.refresh()} />}
      </QueryBoundary>
    </Stack>
  );
};
