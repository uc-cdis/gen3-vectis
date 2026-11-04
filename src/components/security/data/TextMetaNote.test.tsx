import React from 'react';
import { describe, expect, it } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { parseTextMeta } from '@/lib/text-meta';
import { TextMetaNote, textMetaOf } from './TextMetaNote';

const SHA = 'a'.repeat(64);
const RSHA = 'b'.repeat(64);
const show = (value: unknown) => render(<MantineProvider><TextMetaNote value={value} /></MantineProvider>);

describe('TextMetaNote', () => {
  it('says which fields were cut, redacted or had hidden characters, with the original length and sha256', () => {
    show(JSON.stringify({
      uriPath: { len: 70000, sha256: SHA, truncated: true },
      uriQuery: { len: 120, sha256: SHA, redacted: true, redacted_sha256: RSHA },
      userAgent: { len: 40, sha256: SHA, hidden: 3 },
    }));
    const note = screen.getByTestId('text-meta-note');
    expect(note).toHaveTextContent('uriPath: cut at the storage limit. Original 70,000 characters, sha256 ' + SHA);
    expect(note).toHaveTextContent('uriQuery: secret redacted. Original 120 characters');
    expect(note).toHaveTextContent(`redacted sha256 ${RSHA}`);
    expect(note).toHaveTextContent('userAgent: 3 hidden characters shown as <U+XXXX>');
  });
  it('shows nothing when the row has no record', () => {
    for (const v of [null, undefined, '', '{}']) {
      const { unmount } = show(v);
      expect(screen.queryByTestId('text-meta-note')).toBeNull();
      unmount();
    }
  });
  it('says unreadable for malformed values, and never throws', () => {
    for (const v of ['{not json', '[1,2]', '"text"', '42', 'null', '{"uriPath": 7}', '{"uriPath": null}', 7, [], true]) {
      const { unmount } = show(v);
      expect(screen.getByTestId('text-meta-note')).toHaveTextContent('unreadable');
      unmount();
    }
  });
  it('does not trust a bad length or hash; it says they are unknown', () => {
    show(JSON.stringify({ uriPath: { len: 'many', sha256: '<script>', truncated: true } }));
    const note = screen.getByTestId('text-meta-note');
    expect(note).toHaveTextContent('length unknown');
    expect(note).toHaveTextContent('sha256 not recorded');
    expect(note.innerHTML).not.toContain('<script>');
  });
  it('shows a hostile field name as escaped text', () => {
    const { container } = show(JSON.stringify({ [`x${String.fromCodePoint(0x202e)}<img src=x>`]: { len: 1, sha256: SHA, truncated: true } }));
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<U+202E>');
  });
  it('caps the list of fields', () => {
    const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`f${i}`, { len: 1, sha256: SHA, truncated: true }]));
    expect(parseTextMeta(many)).toMatchObject({ kind: 'fields', more: 30 });
  });
  it('finds the column under either name', () => {
    expect(textMetaOf({ text_meta: 'a' })).toBe('a');
    expect(textMetaOf({ textMeta: 'b' })).toBe('b');
    expect(textMetaOf({ textMeta: null, other: 1 })).toBeNull();
    expect(textMetaOf(JSON.parse('{"__proto__": 1}') as Record<string, unknown>)).toBeNull();
  });
});
