import React, { useMemo, useRef, useState } from 'react';
import { cloneDeep } from 'lodash';
import { Alert, Badge, Button, Code, Group, List, Modal, Select, SimpleGrid, Stack, Switch, Text, TextInput } from '@mantine/core';
import { compileJob } from '@/lib/jobs/jobdef/compile';
import { checkParam } from '@/lib/jobs/jobdef/params';
import { usesUserBucket } from '@/lib/jobs/jobdef/templates';
import type { CatalogDef, JobParam } from '@/lib/jobs/jobdef/types';
import { isDagDef } from '@/lib/jobs/jobdef/types';
import { checkDagParam } from '@/lib/jobs/dagu/params';
import { sanitizeText } from '@/lib/safe-text';
import type { SubmitResult } from '@/lib/jobs/api';
import { JobsApiError } from '@/lib/jobs/api';
import { useJobsApi, useJobsInvalidate, useJobsQuery } from '@/lib/jobs/api/hooks';
import { argvText, resourcesText } from './model';

type Values = Record<string, string | boolean>;


function initialValues(params: readonly JobParam[]): Values {
  return Object.fromEntries(params.map((p) => [p.name, p.type === 'boolean' ? p.default === true || p.default === 'true' : p.default === undefined ? '' : String(p.default)]));
}

/** null = fine. Empty optional values are omitted (the job's default applies). */
export function paramError(p: JobParam, v: string | boolean | undefined, dag = false): string | null {
  if (v === undefined || v === '') return p.required ? 'This field is required.' : null;
  const c = dag ? checkDagParam(p, v) : checkParam(p, v); // a workflow job also gets the strict "safe in a shell" check
  return c.ok ? null : c.error.replace(/^[^:]*:\s*/, '').replace(/^./, (x) => x.toUpperCase()) + (c.error.endsWith('.') ? '' : '.');
}

/** What is sent for each parameter: numbers as numbers, booleans as booleans, everything else as text. */
export function paramsToSend(params: readonly JobParam[], v: Values): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const p of params) {
    const x = v[p.name];
    if (x === undefined || x === '') continue;
    out[p.name] = p.type === 'integer' || p.type === 'number' ? Number(x) : p.type === 'boolean' ? x === true || x === 'true' : String(x);
  }
  return out;
}

/** The message shown for a failed submit. Server text is shown as plain text only. */
export function submitMessage(e: unknown): string {
  if (e instanceof JobsApiError) {
    if (e.status === 403) return 'You can view jobs but are not allowed to run them.';
    if (e.status >= 400 && e.status < 500) return [sanitizeText(e.message, 300), ...e.details.slice(0, 5)].join(' ');
  }
  return 'The job could not be submitted because of a problem on the server. Try again in a moment.';
}

const ParamField = ({ p, value, error, onChange, onBlur }: { p: JobParam; value: string | boolean; error: string | null; onChange: (v: string | boolean) => void; onBlur: () => void }) => {
  const common = { label: p.label, description: p.description, required: p.required, error, onBlur, 'data-param': p.name } as const;
  if (p.type === 'boolean') return <Switch label={p.label} description={p.description} checked={value === true} onChange={(e) => onChange(e.currentTarget.checked)} />;
  if (p.type === 'enum') return <Select {...common} data={p.values ?? []} value={typeof value === 'string' && value ? value : null} onChange={(v) => onChange(v ?? '')} allowDeselect={!p.required} />;
  const numeric = p.type === 'integer' || p.type === 'number';
  const hint = [p.min !== undefined ? `min ${p.min}` : null, p.max !== undefined ? `max ${p.max}` : null].filter(Boolean).join(', ');
  return (
    <TextInput
      {...common}
      description={[p.description, hint].filter(Boolean).join(' · ') || undefined}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.currentTarget.value)}
      inputMode={numeric ? 'decimal' : undefined}
      placeholder={p.type === 's3_url' ? 's3://bucket/key' : p.type === 'http_url' ? 'https://example.org/file' : undefined}
      autoComplete="off"
      spellCheck={false}
    />
  );
};

/** What will be sent, exactly as the server will build it (the runner-neutral launch spec). Environment values are never shown. */
export function previewSpec(spec: unknown): { json: string; secrets: string[] } {
  const t = cloneDeep(spec) as { steps?: Array<{ env?: Record<string, string> }>; warnings?: string[] };
  delete t.warnings; // shown separately
  const secrets: string[] = [];
  for (const ex of t.steps ?? []) {
    if (!ex.env) continue;
    for (const k of Object.keys(ex.env)) {
      if (ex.env[k].startsWith('secret://')) { secrets.push(k); ex.env[k] = '[secret reference]'; } else ex.env[k] = '[hidden]';
    }
  }
  return { json: JSON.stringify(t, null, 2), secrets };
}

interface Props { job: CatalogDef; repo: string; sha: string; onClose: () => void; onSubmitted: (r: SubmitResult) => void }

const RunDialog = ({ job, repo, sha, onClose, onSubmitted }: Props) => {
  const api = useJobsApi();
  const invalidate = useJobsInvalidate();
  const params = useMemo(() => job.params ?? [], [job.params]);
  const [values, setValues] = useState<Values>(() => initialValues(params));
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const dag = isDagDef(job);
  const needsBucket = !dag && usesUserBucket(job);
  const storage = useJobsQuery('storage-setup', needsBucket ? [] : null, (a) => a.storageSetup());
  const bucket = storage.data?.bucket ?? undefined;

  const errors = useMemo(() => Object.fromEntries(params.map((p) => [p.name, paramError(p, values[p.name], dag)])), [params, values, dag]);
  const invalid = params.some((p) => errors[p.name] !== null);
  const compiled = useMemo(
    () => (invalid || isDagDef(job) ? null : compileJob(job, paramsToSend(params, values), { repo, sha, userBucket: bucket })),
    [invalid, job, params, values, repo, sha, bucket],
  );
  const bucketMissing = needsBucket && !bucket;
  const canSubmit = !invalid && !pending && !bucketMissing && (dag ? true : compiled?.ok === true);
  const shown = compiled?.ok ? previewSpec(compiled.spec) : null;

  const submit = async () => {
    if (!canSubmit || inFlight.current) return; // double-submit guard, independent of the disabled button
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    try {
      const r = await api.submitJob({ job: job.id, params: paramsToSend(params, values) });
      setWarnings(r.warnings);
      await invalidate('runs');
      onSubmitted(r);
    } catch (e) {
      setFailure(submitMessage(e));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <Modal opened onClose={onClose} size="xl" title={<Text fw={700}>Run: {job.name}</Text>} closeOnClickOutside={!pending} closeOnEscape={!pending} returnFocus>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate aria-label={`Run ${job.name}`}>
        <SimpleGrid cols={{ base: 1, md: params.length ? 2 : 1 }} spacing="lg">
          {params.length ? (
            <Stack gap="sm">
              <Text fw={600} size="sm">Parameters</Text>
              {params.map((p) => (
                <ParamField
                  key={p.name}
                  p={p}
                  value={values[p.name] ?? ''}
                  error={touched.has(p.name) ? errors[p.name] : null}
                  onChange={(v) => { setValues((s) => ({ ...s, [p.name]: v })); setTouched((s) => new Set(s).add(p.name)); }}
                  onBlur={() => setTouched((s) => new Set(s).add(p.name))}
                />
              ))}
            </Stack>
          ) : null}
          <Stack gap="sm" data-testid="preview">
            <Text fw={600} size="sm">What will run</Text>
            {needsBucket ? (
              storage.error || (storage.data && !bucket)
                ? <Alert color="red" role="alert" title="Your storage bucket is unavailable">This job writes to your personal storage bucket, which could not be looked up. It cannot be run right now.</Alert>
                : <Text size="sm" data-testid="bucket-line">Your storage bucket: {bucket ? <Code>{bucket}</Code> : 'looking up…'}</Text>
            ) : null}
            {dag && !invalid ? (
              <>
                <Group gap="xs"><Badge variant="light" color="grape" radius="sm">{`Workflow · ${job.engine}`}</Badge><Text size="sm">{job.graph?.length ?? 0} steps</Text></Group>
                <Text size="sm">Parameters sent: {Object.keys(paramsToSend(params, values)).length ? <Code>{JSON.stringify(paramsToSend(params, values))}</Code> : 'none'}</Text>
                <Text size="xs" c="dimmed">The workflow runs on the workflow server exactly as written in the catalog; only these parameter values are yours. The run is tagged with your identity and only you can see it.</Text>
              </>
            ) : null}
            {!dag && !compiled ? <Text size="sm" c="dimmed">Fix the highlighted fields to see exactly what will run.</Text> : null}
            {dag && invalid ? <Text size="sm" c="dimmed">Fix the highlighted fields to continue.</Text> : null}
            {compiled && !compiled.ok ? (
              <Alert color="red" role="alert" title="This job cannot be built from these values">
                <List size="sm" spacing={2}>{compiled.errors.map((m, i) => <List.Item key={i}>{sanitizeText(m, 300)}</List.Item>)}</List>
              </Alert>
            ) : null}
            {compiled?.ok && shown ? (
              <>
                <Group gap="xs"><Badge variant="light" color="gray" radius="sm">Image</Badge><Code>{compiled.spec.steps[0]?.image}</Code></Group>
                <Text size="sm">Command: <Code>{argvText(compiled.spec.steps[0]?.command ?? [])}</Code></Text>
                <Text size="sm">Resources: {resourcesText(compiled.spec.resources)}</Text>
                <Text size="sm" style={{ overflowWrap: 'anywhere' }}>Tags: {Object.entries(compiled.spec.tags ?? {}).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}</Text>
                {shown.secrets.length ? (
                  <Alert color="yellow" title="Uses secrets">
                    <List size="sm" spacing={2}>{shown.secrets.map((k) => <List.Item key={k}><Code>{k}</Code>: secret reference (value never shown)</List.Item>)}</List>
                  </Alert>
                ) : null}
                {compiled.spec.warnings.length ? (
                  <Alert color="yellow" title="Warnings" data-testid="warnings">
                    <List size="sm" spacing={2}>{compiled.spec.warnings.map((w, i) => <List.Item key={i}>{w}</List.Item>)}</List>
                  </Alert>
                ) : null}
                <Text size="xs" c="dimmed">Environment values are hidden. This is exactly what will be sent.</Text>
                {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable preview must be keyboard-focusable */}
                <pre tabIndex={0} aria-label="What will be sent" style={{ margin: 0, padding: 10, maxHeight: 260, overflow: 'auto', fontSize: 12, background: 'var(--mantine-color-gray-0)', border: '1px solid var(--mantine-color-gray-3)', borderRadius: 4, fontFamily: 'var(--mantine-font-family-monospace)' }}>{shown.json}</pre>
              </>
            ) : null}
          </Stack>
        </SimpleGrid>
        {failure ? <Alert mt="md" color="red" role="alert" title="Not submitted" data-testid="submit-error">{failure}</Alert> : null}
        {warnings.length ? <Text size="xs" mt="xs">{warnings.join(' ')}</Text> : null}
        <Group justify="space-between" mt="lg">
          <Text size="xs" c="dimmed">{invalid ? 'Fill in the required fields correctly to continue.' : ''}</Text>
          <Group>
            <Button variant="default" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" loading={pending} disabled={!canSubmit}>Run job</Button>
          </Group>
        </Group>
      </form>
    </Modal>
  );
};

export default RunDialog;
