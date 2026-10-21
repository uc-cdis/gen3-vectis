import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { Button, Menu, Modal, Text, Textarea } from '@mantine/core';
import { IconChevronDown, IconCode } from '@tabler/icons-react';
import type { QuerySpec } from '../spec';
import { GatewayError } from '../api/gatewayGraph';
import { downloadViaGateway } from '../api/gatewayDownload';
import type { DownloadFormat } from '../api/gatewayDownload';
import { copyText, downloadText } from './clipboard';
import { SHOW_DRS_EVIDENCE, manifestJson, toDrsManifest } from './drs';
import { NOTEBOOK_PATH } from './notebook';
import { toCurl, toGraphql, toPython } from './snippets';

interface SpecActionsMenuProps {
  /** The query the user is looking at. `null` disables the menu (nothing to render yet). */
  spec: QuerySpec | null;
  /** The rows currently shown; only their drs:// ids are used. */
  rows: readonly Record<string, unknown>[];
  /** The index's time field, needed to express the window in GraphQL. */
  timeField?: string;
}

/** Copy the query as Python, curl or GraphQL, or open Workspaces. Generated text never holds a credential. */
export const SpecActionsMenu = ({ spec, rows, timeField }: SpecActionsMenuProps) => {
  const router = useRouter();
  const [status, setStatus] = useState<string>('');
  const [manual, setManual] = useState<{ title: string; text: string } | null>(null);
  const drs = useMemo(() => toDrsManifest(rows), [rows]);

  /** Resolves true only when the text reached the clipboard; otherwise it is shown to copy by hand. */
  const run = async (title: string, make: () => string, done = `Copied ${title} to the clipboard.`): Promise<boolean> => {
    let text: string;
    try {
      text = make();
    } catch (e) {
      setStatus(`Could not create ${title}: ${(e as Error).message}`);
      return false;
    }
    const result = await copyText(text);
    if (result === 'failed') {
      setManual({ title, text });
      setStatus(`Could not copy ${title} automatically. It is shown so you can copy it by hand.`);
      return false;
    }
    setStatus(done);
    return true;
  };
  const downloadAll = async (s: QuerySpec, format: DownloadFormat) => {
    setStatus('Preparing the download. Large exports can take a few minutes.');
    try {
      const done = await downloadViaGateway({ index_name: s.index_name, window: s.window, filters: s.filters ?? [], columns: s.columns ?? [] }, format, (...a) => fetch(...a));
      if (done.url) {
        const a = document.createElement('a');
        a.href = done.url; a.rel = 'noopener'; a.download = done.filename;
        document.body.appendChild(a); a.click(); a.remove();
        setStatus(`Downloading ${done.total?.toLocaleString('en-US') ?? 'all'} rows.`);
      } else {
        downloadText(done.filename, done.text ?? '', format === 'csv' ? 'text/csv' : 'application/json');
        setStatus(done.truncated ? `Downloaded the first rows only (of ${done.total?.toLocaleString('en-US') ?? 'more'}). Narrow the filters or use the Python export for all of them.` : `Downloaded ${done.total?.toLocaleString('en-US') ?? 'all'} rows.`);
      }
    } catch (e) {
      setStatus(e instanceof GatewayError ? e.message : 'The download failed.');
    }
  };
  const canDownload = spec !== null && spec.index_name !== 'all_events' && (spec.columns?.length ?? 0) > 0;
  const python = (s: QuerySpec, tf: string) => toPython(s, { endpoint: window.location.origin, timeField: tf });

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
          <Menu.Item disabled={noSpec || !timeField} onClick={() => spec && timeField && void run('Python', () => python(spec, timeField))}>Copy as Python (for Jupyter)</Menu.Item>
          <Menu.Item disabled={noSpec || !timeField} onClick={() => spec && timeField && void run('curl', () => toCurl(spec, { timeField }))}>Copy as curl</Menu.Item>
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
          <Menu.Label>Download every matching row</Menu.Label>
          <Menu.Item disabled={!canDownload} onClick={() => spec && void downloadAll(spec, 'csv')}>Download all as CSV</Menu.Item>
          <Menu.Item disabled={!canDownload} onClick={() => spec && void downloadAll(spec, 'json')}>Download all as JSON lines</Menu.Item>
          <Menu.Divider />
          {SHOW_DRS_EVIDENCE ? (
            <>
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
            </>
          ) : null}
          <Menu.Item
            disabled={noSpec || !timeField}
            onClick={() => {
              if (!spec || !timeField) return;
              void run('Python', () => python(spec, timeField), 'Copied the Python. Launch a workspace, then paste it into a notebook cell.').then((copied) => {
                if (copied) void router.push(NOTEBOOK_PATH);
              });
            }}
          >
            Copy Python and open Workspaces
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
