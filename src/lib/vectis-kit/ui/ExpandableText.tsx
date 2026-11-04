import React, { useId, useMemo, useState } from 'react';
import { Button, Group, Text } from '@mantine/core';
import { escapeHidden } from '@/lib/safe-text';
import { formatNumber } from './format';

/** Most characters the in-place box renders. A larger value is shown up to here and can be downloaded whole. */
export const SHOW_FULL_LIMIT = 64 * 1024;
const BOX_MAX_HEIGHT = 320;
// A token the cut may have split: "<U+", "<U+E00"
const PARTIAL_TOKEN = /<(?:U(?:\+[0-9A-F]{0,6})?)?$/;

/** Number of code points, without allocating an array (the value may be a megabyte). */
function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) n += 1; // eslint-disable-line @typescript-eslint/no-unused-vars
  return n;
}

/** The first `max` UTF-16 units, never ending in half a surrogate pair or half an escape token. */
function head(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = max;
  const c = s.charCodeAt(cut - 1);
  if (c >= 0xd800 && c <= 0xdbff) cut -= 1;
  return s.slice(0, cut).replace(PARTIAL_TOKEN, '');
}

/** The preview: tab and newline become spaces, at most `max` code points. Reads only as much of the value as it needs. */
function preview(text: string, max: number): { text: string; cut: boolean } {
  const limit = Math.max(1, Math.floor(max));
  if (text.length <= limit) return { text: text.replace(/[\t\n]/g, ' '), cut: false };
  const sample = Array.from(text.slice(0, limit * 2).replace(/[\t\n]/g, ' '));
  const cut = text.length > limit * 2 || sample.length > limit;
  return { text: cut ? sample.slice(0, limit).join('') : sample.join(''), cut };
}

/** Copy to the clipboard. A missing clipboard, a refused permission or a thrown error all give `false`; nothing throws. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Offer `text` as a .txt file. The file holds the escaped text, never the raw value. Returns false when the browser cannot. */
function downloadText(text: string, filename: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}

export interface ExpandableTextProps {
  /** The text, already escaped by the safe-text helpers. It is escaped again here (idempotent), so a value that skipped them is still safe. */
  value: string;
  /** Characters shown before the cut. Default 120. */
  previewChars?: number;
  /** The true length in characters, when the value was already cut before it reached the console and the real length is known. */
  totalLength?: number | null;
  /** Monospace (paths, queries, headers). */
  mono?: boolean;
  /** Text size, as in Mantine. */
  size?: string;
  /** Names the value for assistive technology and for the download file ("request path"). */
  label?: string;
  /** Called when the analyst opens the full value. */
  onShowFull?: () => void;
}

/**
 * Text that is cut for the layout but never lost. Short text is shown as is. Longer text shows a preview, the TRUE length, and a
 * "Show full" button that opens the whole value in place: a scroll box of plain text (a text node, never HTML) so a megabyte value cannot
 * stretch the page. Above 64 KiB the box shows the first 64 KiB and says so, and "Download as text" gives the whole value.
 * "Copy" puts the whole escaped value on the clipboard. Never throws, whatever the string holds.
 */
export const ExpandableText = ({ value, previewChars = 120, totalLength, mono = false, size = 'sm', label = 'value', onShowFull }: ExpandableTextProps): React.ReactElement => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const text = useMemo(() => escapeHidden(typeof value === 'string' ? value : ''), [value]);
  const view = useMemo(() => preview(text, previewChars), [text, previewChars]);
  const length = useMemo(() => (view.cut || text.length > SHOW_FULL_LIMIT ? codePointLength(text) : text.length), [text, view.cut]);
  const known = typeof totalLength === 'number' && Number.isFinite(totalLength) && totalLength > length ? Math.floor(totalLength) : null;
  const shown = open ? head(text, SHOW_FULL_LIMIT) : '';
  const overBox = open && text.length > SHOW_FULL_LIMIT;
  const font = mono ? 'monospace' : undefined;

  if (!view.cut && known === null) {
    return <Text span size={size} ff={font} data-testid="expandable-text" style={{ overflowWrap: 'anywhere' }}>{view.text}</Text>;
  }

  const toggle = () => {
    if (!open) onShowFull?.();
    setOpen((o) => !o);
    setStatus(null);
  };
  const copy = () => { void copyText(text).then((ok) => setStatus(ok ? 'Copied' : 'Could not copy: select the text and copy it')); };
  const download = () => { setStatus(downloadText(text, `${label.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'value'}.txt`) ? null : 'Could not start the download'); };
  const total = known ?? length;

  return (
    <span data-testid="expandable-text" style={{ overflowWrap: 'anywhere' }}>
      <Text span size={size} ff={font} data-testid="expandable-preview">{view.text}{view.cut ? '…' : ''}</Text>
      <Text span size="xs" c="dimmed" ml={6} data-testid="expandable-length">
        {known !== null
          ? `${formatNumber(total)} characters; ${formatNumber(length)} reached the console`
          : `${formatNumber(total)} characters`}
      </Text>
      {view.cut ? (
        <Button
          size="compact-xs" variant="subtle" ml={4} aria-expanded={open} aria-controls={`${id}-full`} aria-label={`${open ? 'Show less' : 'Show full'} ${label}`}
          onClick={toggle}
        >
          {open ? 'Show less' : 'Show full'}
        </Button>
      ) : null}
      {open ? (
        <span id={`${id}-full`} style={{ display: 'block', marginTop: 4 }} data-testid="expandable-full-wrap">
          <span
            role="region" tabIndex={0} aria-label={`Full ${label}`} data-testid="expandable-full"
            style={{
              display: 'block', maxHeight: BOX_MAX_HEIGHT, overflow: 'auto', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', padding: 6,
              border: '1px solid var(--mantine-color-gray-4)', borderRadius: 4, background: 'var(--mantine-color-gray-0)',
              fontFamily: mono ? 'var(--mantine-font-family-monospace)' : undefined, fontSize: 'var(--mantine-font-size-xs)',
            }}
          >{shown}</span>
          {overBox ? (
            <Text span size="xs" c="dimmed" display="block" data-testid="expandable-capped">
              Showing the first 64 KiB of {formatNumber(total)} characters: download for the rest.
            </Text>
          ) : null}
          <Group component="span" gap={4} mt={2}>
            <Button size="compact-xs" variant="subtle" onClick={copy} aria-label={`Copy ${label}`}>Copy</Button>
            {overBox ? <Button size="compact-xs" variant="subtle" onClick={download}>Download as text</Button> : null}
            {status ? <Text span size="xs" c="dimmed" role="status">{status}</Text> : null}
          </Group>
        </span>
      ) : null}
    </span>
  );
};

export default ExpandableText;
