import React, { useState } from 'react';
import { Badge, Box, Button, Code, Group, Paper, Stack, Text } from '@mantine/core';
import type { CaseNote } from '@/lib/vectis-kit/spec';
import { formatTime, relativeTime } from '@/lib/vectis-kit/ui/format';

/** Provenance of an agent note, collapsed by default. Every value is rendered as text. */
const Provenance = ({ note }: { note: CaseNote }) => {
  const [open, setOpen] = useState(false);
  const id = `prov-${note.note_id}`;
  return (
    <Box mt="xs">
      <Button variant="subtle" size="compact-xs" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide provenance' : 'Show provenance'}
      </Button>
      {open ? (
        <Stack id={id} gap={2} mt={4}>
          <Text size="xs">Model: <Code>{note.model ?? 'not recorded'}</Code></Text>
          <Text size="xs">Prompt hash: <Code>{note.prompt_hash ?? 'not recorded'}</Code></Text>
          <Text size="xs">Input digest: <Code>{note.input_digest ?? 'not recorded'}</Code></Text>
        </Stack>
      ) : null}
    </Box>
  );
};

const NoteItem = ({ note }: { note: CaseNote }) => {
  const agent = note.author_kind === 'agent';
  return (
    <Paper
      component="li" withBorder p="sm" radius="md" data-testid={agent ? 'note-agent' : 'note-analyst'}
      style={{ listStyle: 'none', borderStyle: agent ? 'dashed' : 'solid', borderColor: agent ? 'var(--mantine-color-violet-5)' : undefined,
        background: agent ? 'var(--mantine-color-violet-light)' : undefined }}
    >
      <Group gap="xs" mb={4}>
        {agent ? <Badge color="violet" variant="filled" size="sm">AI-generated</Badge> : <Badge color="gray" variant="light" size="sm">Analyst note</Badge>}
        {agent ? <Text size="xs" c="dimmed">Model <Code>{note.model ?? 'unknown'}</Code></Text> : null}
        <Text size="sm" fw={600}>{note.author}</Text>
        <Text size="xs" c="dimmed" title={formatTime(note.at)}>{relativeTime(note.at)} · {formatTime(note.at)}</Text>
      </Group>
      <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{note.body}</Text>
      {agent ? (
        <>
          <Text size="xs" c="dimmed" mt={4}>Written by an AI model, not an analyst. Check it against the alerts before relying on it.</Text>
          <Provenance note={note} />
        </>
      ) : null}
    </Paper>
  );
};

export const NotesTimeline = ({ notes }: { notes: readonly CaseNote[] }) => {
  if (notes.length === 0) return <Text size="sm" c="dimmed" data-testid="notes-empty">No notes yet.</Text>;
  const ordered = [...notes].sort((a, b) => a.at.localeCompare(b.at));
  return <Stack component="ol" gap="xs" p={0} m={0} aria-label="Case notes, oldest first">{ordered.map((n) => <NoteItem key={n.note_id} note={n} />)}</Stack>;
};
