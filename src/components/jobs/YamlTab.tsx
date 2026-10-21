import React, { useState } from 'react';
import { Alert, Button, Group, List, Stack, Text, Textarea } from '@mantine/core';
import RunChoices, { useRunChoices } from './RunChoices';
import { JobsApiError } from '@/lib/jobs/api';
import { useJobsApi, useJobsInvalidate, useJobsQuery } from '@/lib/jobs/api/hooks';
import { sanitizeText } from '@/lib/safe-text';

const DAG_EXAMPLE = `name: hello
steps:
  - id: say_hello
    action: k8s.run
    with:
      image: busybox
      command: echo hello from Vectis
`;

const JOB_EXAMPLE = `schema_version: 1
id: hello
name: Hello
description: Prints a greeting and exits.
image: busybox
command: [echo, "hello from Vectis"]
resources:
  cpu_cores: 1
  ram_gb: 0.5
`;

type Result = { kind: 'ok'; text: string } | { kind: 'error'; message: string; details: string[] } | null;

const failure = (e: unknown): Result => {
  if (e instanceof JobsApiError) {
    if (e.status === 403) return { kind: 'error', message: 'You can view jobs but are not allowed to run them.', details: [] };
    if (e.status >= 400 && e.status < 500) return { kind: 'error', message: sanitizeText(e.message, 300), details: e.details.slice(0, 20) };
    if (e.status === 0) return { kind: 'error', message: 'The jobs service could not be reached.', details: [] };
    return { kind: 'error', message: `The workflow could not be submitted: ${sanitizeText(e.message, 300)}`, details: [] };
  }
  return { kind: 'error', message: 'The workflow could not be submitted because of a problem on the server.', details: [] };
};

/** Run a workflow you paste. It does not use the job catalog, so it works when the catalog is unavailable. The server lints it with the same rules as a catalog definition. */
const YamlTab = ({ onSubmitted }: { onSubmitted: (id: string) => void }) => {
  const api = useJobsApi();
  const invalidate = useJobsInvalidate();
  // Dagu takes a workflow definition; TES takes a container job in the catalog's job format.
  const info = useJobsQuery('service-info', [], (a) => a.serviceInfo());
  const isDagu = /dagu/i.test(info.data?.name ?? '') || (!info.data && !info.error);
  const EXAMPLE = isDagu ? DAG_EXAMPLE : JOB_EXAMPLE;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'check' | 'run' | null>(null);
  const [result, setResult] = useState<Result>(null);
  const pick = useRunChoices();

  const check = async () => {
    setBusy('check'); setResult(null);
    try {
      const r = await api.checkYaml(text);
      setResult({ kind: 'ok', text: `Accepted: workflow "${r.name}" with ${r.steps} ${r.steps === 1 ? 'step' : 'steps'}. Nothing was run.` });
    } catch (e) { setResult(failure(e)); } finally { setBusy(null); }
  };
  const run = async () => {
    setBusy('run'); setResult(null);
    try {
      const r = await api.submitYaml(text, undefined, pick.choices);
      invalidate();
      onSubmitted(r.id);
    } catch (e) { setResult(failure(e)); } finally { setBusy(null); }
  };

  return (
    <Stack gap="sm" data-testid="yaml-tab">
      <Text size="sm" c="dimmed">
        {isDagu
          ? 'Paste a workflow definition to run it.'
          : 'Paste a job definition (the same format as a catalog job) to run it.'}{' '}
        It runs as you, and it must pass the same checks as a catalog entry (allowed images, no literal secrets{isDagu ? ', allowed step types' : ''}).
        Parameters keep the defaults written in the definition.
      </Text>
      <Textarea
        aria-label="Definition (YAML)"
        value={text}
        onChange={(e) => { setText(e.currentTarget.value); setResult(null); }}
        placeholder={EXAMPLE}
        autosize minRows={14} maxRows={32}
        spellCheck={false} autoComplete="off"
        styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 13 } }}
      />
      {isDagu ? <RunChoices title={pick.title} group={pick.group} onTitle={pick.setTitle} onGroup={pick.setGroup} disabled={busy !== null} /> : null}
      <Group gap="xs">
        <Button variant="default" onClick={() => void check()} loading={busy === 'check'} disabled={!text.trim() || busy !== null}>Check</Button>
        <Button onClick={() => void run()} loading={busy === 'run'} disabled={!text.trim() || busy !== null}>Run</Button>
        <Button variant="subtle" onClick={() => { setText(EXAMPLE); setResult(null); }} disabled={busy !== null}>Insert example</Button>
      </Group>
      {result?.kind === 'ok' ? <Alert color="green" role="status">{result.text}</Alert> : null}
      {result?.kind === 'error' ? (
        <Alert color="red" role="alert" title={result.message}>
          {result.details.length ? <List size="sm" spacing={2}>{result.details.map((d, i) => <List.Item key={i}>{sanitizeText(d, 300)}</List.Item>)}</List> : null}
        </Alert>
      ) : null}
    </Stack>
  );
};
export default YamlTab;
