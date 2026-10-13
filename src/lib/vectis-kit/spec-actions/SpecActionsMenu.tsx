import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { Button, Menu, Modal, Text, Textarea } from '@mantine/core';
import { IconChevronDown, IconCode } from '@tabler/icons-react';
import type { QuerySpec } from '../spec';
import { copyText, downloadText } from './clipboard';
import { manifestJson, toDrsManifest } from './drs';
import { openInNotebook } from './notebook';
import { toCurl, toGraphql, toPython } from './snippets';

interface SpecActionsMenuProps {
  /** The query the user is looking at. `null` disables the menu (nothing to render yet). */
  spec: QuerySpec | null;
  /** The rows currently shown; only their drs:// ids are used. */
  rows: readonly Record<string, unknown>[];
  /** The index's time field, needed to express the window in GraphQL. */
  timeField?: string;
}

/** Copy as Python / curl / GraphQL, download a DRS manifest, open in notebook. Generated text never holds a credential. */
export const SpecActionsMenu = ({ spec, rows, timeField }: SpecActionsMenuProps) => {
  const router = useRouter();
  const [status, setStatus] = useState<string>('');
  const [manual, setManual] = useState<{ title: string; text: string } | null>(null);
  const drs = useMemo(() => toDrsManifest(rows), [rows]);

  const run = async (title: string, make: () => string) => {
    let text: string;
    try {
      text = make();
    } catch (e) {
      setStatus(`Could not create ${title}: ${(e as Error).message}`);
      return;
    }
    const result = await copyText(text);
    if (result === 'failed') {
      setManual({ title, text });
      setStatus(`Could not copy ${title} automatically. It is shown so you can copy it by hand.`);
    } else {
      setStatus(`Copied ${title} to the clipboard.`);
    }
  };

  const noSpec = spec === null;
  return (
    <>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <Button variant="default" size="xs" leftSection={<IconCode size={14} />} rightSection={<IconChevronDown size={14} />} disabled={noSpec} aria-label="Use this query elsewhere">
            Use this query
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Copy (no credentials included)</Menu.Label>
          <Menu.Item disabled={noSpec} onClick={() => spec && void run('Python', () => toPython(spec))}>Copy as Python</Menu.Item>
          <Menu.Item disabled={noSpec} onClick={() => spec && void run('curl', () => toCurl(spec))}>Copy as curl</Menu.Item>
          <Menu.Item
            disabled={noSpec || !timeField}
            onClick={() => spec && timeField && void run('GraphQL query', () => toGraphql(spec, timeField).query)}
          >
            Copy as GraphQL query
          </Menu.Item>
          <Menu.Item
            disabled={noSpec || !timeField}
            onClick={() => spec && timeField && void run('GraphQL variables', () => toGraphql(spec, timeField).variables)}
          >
            Copy GraphQL variables
          </Menu.Item>
          <Menu.Divider />
          <Menu.Label>Export</Menu.Label>
          <Menu.Item
            disabled={drs.included === 0}
            onClick={() => {
              downloadText('vectis-drs-manifest.json', manifestJson(drs));
              setStatus(`Downloaded a manifest of ${drs.included} objects. ${drs.skipped} rows were skipped (no drs:// id).`);
            }}
          >
            Download DRS manifest
            <Text size="xs" c="gray.7">
              {drs.included === 0 ? 'No row on this page has a drs:// id' : `${drs.included} objects, ${drs.skipped} rows skipped`}
            </Text>
          </Menu.Item>
          <Menu.Item
            disabled={noSpec}
            onClick={() => {
              if (!spec) return;
              const r = openInNotebook(spec, { storage: window.sessionStorage, navigate: (p) => router.push(p) });
              setStatus(r.ok ? 'Opening your workspace with this query.' : r.error);
            }}
          >
            Open in notebook
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Text size="xs" c="gray.7" role="status" aria-live="polite" data-testid="spec-actions-status">{status}</Text>
      <Modal opened={manual !== null} onClose={() => setManual(null)} title={manual ? `Copy ${manual.title}` : ''} size="lg">
        {manual ? <Textarea readOnly autosize minRows={6} maxRows={20} value={manual.text} aria-label={`${manual.title} text`} onFocus={(e) => e.currentTarget.select()} /> : null}
      </Modal>
    </>
  );
};
