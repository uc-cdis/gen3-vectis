import React, { useState } from 'react';
import { Button, Group, Modal, Select, Stack, TagsInput, Text, TextInput, Textarea } from '@mantine/core';
import { ApiError } from '@/lib/vectis-kit/api';
import { useSiemMutation } from '@/lib/vectis-kit/api/hooks';
import type { CaseRecord } from '@/lib/vectis-kit/spec';
import { describeError } from '@/lib/vectis-kit/ui/primitives';
import type { FieldErrors, Priority } from './caseModel';
import { LIMITS, PRIORITIES, PRIORITY_LABEL, toCaseCreate, validateCaseFields } from './caseModel';

export const CreateCaseModal = ({ opened, onClose, onCreated }: { opened: boolean; onClose: () => void; onCreated: (c: CaseRecord) => void }) => {
  const create = useSiemMutation('caseCreate');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [assignee, setAssignee] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateCaseFields({ title, description, tags, assignee });
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const rec = await create({ body: toCaseCreate({ title, description, tags, assignee, priority }) }, ['cases']);
      setTitle(''); setDescription(''); setAssignee(''); setTags([]); setPriority('medium');
      onCreated(rec);
    } catch (err) {
      setServerError(err instanceof ApiError ? describeError(err).message : 'The case could not be created.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Create case" transitionProps={{ duration: 0 }}>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <Stack gap="sm">
          <TextInput label="Title" required value={title} onChange={(e) => setTitle(e.currentTarget.value)} error={errors.title} description={`${title.trim().length}/${LIMITS.titleMax}`} />
          <Select label="Priority" allowDeselect={false} data={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} value={priority} onChange={(v) => v && setPriority(v as Priority)} />
          <TextInput label="Assignee (optional)" value={assignee} onChange={(e) => setAssignee(e.currentTarget.value)} error={errors.assignee} />
          <TagsInput label="Tags (optional)" description={`Up to ${LIMITS.tagsMax}. Press Enter or comma after each.`} value={tags} onChange={setTags} error={errors.tags} />
          <Textarea label="Description (optional)" rows={3} styles={{ input: { resize: 'vertical' } }} value={description} onChange={(e) => setDescription(e.currentTarget.value)} error={errors.description} />
          {serverError ? <Text role="alert" size="sm" c="red">{serverError}</Text> : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>Create case</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
};
