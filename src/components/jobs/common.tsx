import React from 'react';
import { Badge, Group, Paper, Stack, Text } from '@mantine/core';
import type { ErrorWording } from '@/lib/vectis-kit/ui/primitives';
import { CopyIcon, ErrorState as SharedErrorState } from '@/lib/vectis-kit/ui/primitives';
import type { Run } from '@/lib/jobs/model';
import type { JobsApiError } from '@/lib/jobs/api';
import { STATE_META, isTerminal } from './model';

/** Colour AND a text label (neutral state); finished runs are solid, runs that can still change are light. The runner's own state word follows as secondary text when it adds information. */
export const StateBadge = ({ run }: { run: Pick<Run, 'state' | 'backend_state'> }) => {
  const { state, backend_state: raw } = run;
  const m = STATE_META[state];
  const done = isTerminal(state);
  return (
    <Group gap={6} wrap="nowrap" component="span" display="inline-flex">
      <Badge color={m.color} variant={done ? 'filled' : 'light'} radius="sm" size="sm" title={done ? 'Finished' : 'In progress'} data-state={state} data-testid="state-badge">
        {m.label}
      </Badge>
      {raw && raw.toLowerCase() !== state ? <Text span size="xs" c="dimmed" data-testid="backend-state">{raw}</Text> : null}
    </Group>
  );
};

const JOBS_ERRORS: ErrorWording = {
  noAccess: 'You do not have access to jobs. Ask an administrator if you need it.',
  unreachable: 'The jobs service could not be reached.',
  serverError: 'The jobs service had a problem. Try again in a moment.',
};

export const ErrorState = ({ error, onRetry }: { error: JobsApiError; onRetry?: () => void }) => (
  <SharedErrorState error={error} onRetry={onRetry} wording={JOBS_ERRORS} />
);

/** A captured log or other long text: plain text in a <pre>, capped height with scroll, with Copy. */
export const TextBlock = ({ label, text, truncated }: { label: string; text: string; truncated?: boolean }) => (
  <Stack gap={4}>
    <Group justify="space-between">
      <Text size="xs" fw={600} c="dimmed" tt="uppercase">{label}</Text>
      {text ? <CopyIcon value={text} what={label} /> : null}
    </Group>
    <Paper withBorder radius="sm" bg="gray.0">
      <pre
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable output must be keyboard-focusable
        tabIndex={0}
        aria-label={label}
        style={{ margin: 0, padding: 10, maxHeight: 260, overflow: 'auto', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'var(--mantine-font-family-monospace)' }}
      >
        {text || '(empty)'}
      </pre>
    </Paper>
    {truncated ? <Text size="xs" c="orange.8">Output was truncated by the server; only the first part is shown.</Text> : null}
  </Stack>
);
