import React, { useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Paper, Stack, Text } from '@mantine/core';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import { formatTime } from '@/lib/vectis-kit/ui/format';
import { ErrorState, LoadingState, Unmeasured } from '@/lib/vectis-kit/ui/primitives';

const POLL_MS = 5000;

/**
 * The AI analyst slot. Every state is rendered. Output is plain text, labelled as machine-generated with the
 * model id, prompt hash and input digest, and is never styled like an analyst's note.
 */
const AiAnalystSlot = ({ groupId }: { groupId: string }) => {
  const [poll, setPoll] = useState(false);
  const q = useSiemQuery('alertAiSummary', { params: { id: groupId } }, { refreshMs: poll ? POLL_MS : undefined });
  const state = q.data?.state;
  // Poll only while the summary is running. Adjusting state during render is React's pattern for derived state.
  if (poll !== (state === 'running')) setPoll(state === 'running');

  let body: React.ReactNode;
  if (q.error && !q.data) body = <ErrorState error={q.error} onRetry={() => void q.refresh()} />;
  else if (!q.data) body = <LoadingState rows={2} />;
  else if (q.data.state === 'not_configured') {
    body = (
      <Stack gap="xs">
        <Text size="sm">{q.data.detail || 'The AI analyst is not configured for this tenant.'}</Text>
        <Text size="xs" c="dimmed">Nothing is generated or sent to a model until an administrator enables it.</Text>
        <Button size="xs" variant="default" disabled w="fit-content" aria-describedby={`ai-off-${groupId}`}>Summarise this alert</Button>
        <span id={`ai-off-${groupId}`} hidden>Unavailable: the AI analyst is not configured.</span>
      </Stack>
    );
  } else if (q.data.state === 'running') {
    body = (
      <Group gap="xs" role="status" aria-live="polite">
        <Loader size="xs" />
        <Text size="sm">The AI analyst is working on this alert. This page checks again every few seconds.</Text>
      </Group>
    );
  } else if (q.data.state === 'failed') {
    body = <Alert color="red" title="The AI summary failed" role="alert">{q.data.detail || 'No further detail was given.'}</Alert>;
  } else {
    const n = q.data.note;
    body = n ? (
      <Stack gap="xs">
        <Badge color="violet" variant="outline" radius="sm" w="fit-content">AI-generated. Not written by an analyst.</Badge>
        <Paper withBorder p="sm" radius="sm" bg="var(--mantine-color-gray-0)">
          <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} data-testid="ai-note-body">{n.body}</Text>
        </Paper>
        <Group gap="lg" wrap="wrap">
          <Text size="xs" c="dimmed">Model: {n.model ? <Text span ff="monospace" size="xs">{n.model}</Text> : <Unmeasured />}</Text>
          <Text size="xs" c="dimmed">Prompt hash: {n.prompt_hash ? <Text span ff="monospace" size="xs">{n.prompt_hash}</Text> : <Unmeasured />}</Text>
          <Text size="xs" c="dimmed">Input digest: {n.input_digest ? <Text span ff="monospace" size="xs">{n.input_digest}</Text> : <Unmeasured />}</Text>
          <Text size="xs" c="dimmed">Generated {formatTime(n.at)}</Text>
        </Group>
        <Text size="xs" c="dimmed">Check this against the evidence before acting. It has not changed the alert or any case.</Text>
      </Stack>
    ) : <Text size="sm" c="dimmed">The AI analyst reported ready but returned no note.</Text>;
  }
  return <section aria-label="AI analyst" data-testid="ai-slot" data-state={state ?? 'loading'}>{body}</section>;
};
export default AiAnalystSlot;
