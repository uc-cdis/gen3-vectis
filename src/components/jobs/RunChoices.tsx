import React, { useState } from 'react';
import { Select, SimpleGrid, TextInput } from '@mantine/core';
import { useJobsQuery } from '@/lib/jobs/api/hooks';

const ME = 'me';
export const TITLE_MAX = 80;

/** What a person picks besides the job's own parameters: a name for the run, and optionally a group to run it as. */
export function useRunChoices() {
  const [title, setTitle] = useState('');
  const [group, setGroup] = useState('');
  return {
    title, setTitle, group, setGroup,
    /** the values to send; nothing is sent for a blank name or for "just me" */
    choices: { ...(title.trim() ? { title: title.trim() } : {}), ...(group ? { group } : {}) },
  };
}

const RunChoices = ({ title, group, onTitle, onGroup, disabled }: { title: string; group: string; onTitle: (v: string) => void; onGroup: (v: string) => void; disabled?: boolean }) => {
  const groups = useJobsQuery('groups', [], (a) => a.groups());
  const list = groups.data ?? [];
  return (
    <SimpleGrid cols={{ base: 1, md: list.length ? 2 : 1 }} spacing="lg" mb="md" data-testid="run-choices">
      <TextInput
        label="Name this run (optional)"
        description="Shown in the Runs list, so you can find it later. You can change it afterwards."
        value={title} onChange={(e) => onTitle(e.currentTarget.value)} maxLength={TITLE_MAX} disabled={disabled}
        autoComplete="off" data-param="run-title"
      />
      {list.length ? (
        <Select
          label="Run as"
          description={group ? `Everyone in the ${group} group will see this run and its results.` : 'Only you will see this run.'}
          data={[{ value: ME, label: 'Just me (private)' }, ...list.map((g) => ({ value: g, label: `Group: ${g}` }))]}
          value={group || ME} onChange={(v) => onGroup(!v || v === ME ? '' : v)} allowDeselect={false} disabled={disabled}
          data-param="run-as"
        />
      ) : null}
    </SimpleGrid>
  );
};
export default RunChoices;
