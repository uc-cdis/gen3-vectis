import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Anchor, Group, Paper, Stack, Table, Tabs, Text, Title } from '@mantine/core';
import type { ResultFile } from '@/lib/jobs/api';
import type { Run } from '@/lib/jobs/model';
import { useJobsApi, useJobsQuery } from '@/lib/jobs/api/hooks';
import { formatBytes } from '@/lib/vectis-kit/ui/format';
import { LoadingState, Panel } from '@/lib/vectis-kit/ui/primitives';
import { ErrorState, TextBlock } from './common';
import { isTerminal } from './model';

/** A file larger than this is offered for download only; the page does not try to draw it. */
const PREVIEW_MAX = 2 * 1024 * 1024;

type Kind = 'markdown' | 'html' | 'json' | 'other';
const kindOf = (name: string): Kind => (/\.md$/i.test(name) ? 'markdown' : /\.html?$/i.test(name) ? 'html' : /\.json$/i.test(name) ? 'json' : 'other');
const RANK: Record<Kind, number> = { markdown: 0, html: 1, json: 2, other: 3 };
const LABEL: Record<Kind, string> = { markdown: 'Report', html: 'Report (page)', json: 'Data', other: 'File' };

/** Report files first (a name ending in report.md leads), then pages, then data. */
export function previewable(files: readonly ResultFile[]): ResultFile[] {
  return files
    .filter((f) => kindOf(f.name) !== 'other' && f.size <= PREVIEW_MAX)
    .sort((a, b) => RANK[kindOf(a.name)] - RANK[kindOf(b.name)] || Number(/report\.md$/i.test(b.name)) - Number(/report\.md$/i.test(a.name)) || a.name.localeCompare(b.name));
}

/** Markdown as a document. react-markdown draws no raw HTML and drops unsafe link schemes, so a report cannot inject anything. */
const MarkdownView = ({ text }: { text: string }) => (
  <Paper withBorder radius="sm" p="md" data-testid="result-markdown" style={{ overflowX: 'auto' }}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <Title order={2} mt="sm" mb="xs">{children}</Title>,
        h2: ({ children }) => <Title order={3} mt="md" mb="xs">{children}</Title>,
        h3: ({ children }) => <Title order={4} mt="sm" mb={4}>{children}</Title>,
        p: ({ children }) => <Text size="sm" my={6}>{children}</Text>,
        li: ({ children }) => <li style={{ fontSize: 'var(--mantine-font-size-sm)' }}>{children}</li>,
        a: ({ href, children }) => <Anchor href={href} target="_blank" rel="noopener noreferrer" size="sm">{children}</Anchor>,
        code: ({ children }) => <code style={{ fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 12 }}>{children}</code>,
        table: ({ children }) => <Table withTableBorder withColumnBorders striped my="sm" fz="sm">{children}</Table>,
        thead: ({ children }) => <Table.Thead>{children}</Table.Thead>,
        tbody: ({ children }) => <Table.Tbody>{children}</Table.Tbody>,
        tr: ({ children }) => <Table.Tr>{children}</Table.Tr>,
        th: ({ children }) => <Table.Th>{children}</Table.Th>,
        td: ({ children }) => <Table.Td>{children}</Table.Td>,
      }}
    >
      {text}
    </ReactMarkdown>
  </Paper>
);

/** An HTML report in a frame with every restriction on: no scripts, no forms, no access to this site, no referrer. */
const HtmlView = ({ text, title }: { text: string; title: string }) => (
  <iframe
    title={title} sandbox="" referrerPolicy="no-referrer" srcDoc={text} data-testid="result-html"
    style={{ width: '100%', height: 640, border: '1px solid var(--mantine-color-gray-3)', borderRadius: 4, background: '#fff' }}
  />
);

const JsonView = ({ text, name }: { text: string; name: string }) => {
  const pretty = useMemo(() => { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } }, [text]);
  return <TextBlock label={name} text={pretty} />;
};

const Preview = ({ run, file }: { run: Run; file: ResultFile }) => {
  const q = useJobsQuery<string>('result-text', [run.id, file.name], (a) => a.resultText(run.id, file.name));
  if (q.error && q.data === undefined) return <ErrorState error={q.error} onRetry={() => void q.refresh()} what={file.name} />;
  if (q.data === undefined) return <LoadingState rows={3} />;
  const kind = kindOf(file.name);
  return kind === 'markdown' ? <MarkdownView text={q.data} /> : kind === 'html' ? <HtmlView text={q.data} title={file.name} /> : <JsonView text={q.data} name={file.name} />;
};

/**
 * What a finished run wrote, drawn on the page: the Markdown report as a document, the HTML report in a locked-down frame, JSON as
 * readable text, and every file (including the executed notebook) as a download. Shown only when the run left files.
 */
const ResultsPanel = ({ run }: { run: Run }) => {
  const api = useJobsApi();
  const files = useJobsQuery<ResultFile[]>('results', isTerminal(run.state) ? [run.id] : null, (a) => a.runResults(run.id));
  const shown = useMemo(() => previewable(files.data ?? []), [files.data]);
  const [picked, setPicked] = useState<string | null>(null);
  if (!isTerminal(run.state)) return null;
  if (files.error) {
    // a runner without results answers 404: nothing to show, nothing to complain about
    return files.error.status === 404 ? null : <ErrorState error={files.error} onRetry={() => void files.refresh()} what="Results" />;
  }
  if (files.data === undefined) return null;
  if (files.data.length === 0) return null;
  const active = shown.find((f) => f.name === picked) ?? shown[0];
  return (
    <Panel title="Results">
      <Stack gap="sm" data-testid="results-panel">
        {active ? (
          <Tabs value={active.name} onChange={(v) => setPicked(v)} keepMounted={false}>
            <Tabs.List mb="sm" aria-label="Result files">
              {shown.map((f) => <Tabs.Tab key={f.name} value={f.name}>{f.name} <Text span size="xs" c="dimmed">({LABEL[kindOf(f.name)]})</Text></Tabs.Tab>)}
            </Tabs.List>
            <Tabs.Panel value={active.name}><Preview run={run} file={active} /></Tabs.Panel>
          </Tabs>
        ) : <Text size="sm" c="dimmed">These files are not shown on the page; download them below.</Text>}
        <Stack gap={2}>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">All files</Text>
          {files.data.map((f) => (
            <Group key={f.name} gap="xs">
              <Anchor href={api.resultUrl(run.id, f.name)} size="sm" download>{f.name}</Anchor>
              <Text size="xs" c="dimmed">{formatBytes(f.size)}</Text>
            </Group>
          ))}
        </Stack>
      </Stack>
    </Panel>
  );
};

export default ResultsPanel;
