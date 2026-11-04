import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ExpandableText, SHOW_FULL_LIMIT } from './ExpandableText';

const U = (...cps: number[]): string => String.fromCodePoint(...cps);
/** Any character of Unicode category C, or a line or paragraph separator. */
const HIDDEN_RE = /[\p{C}\u2028\u2029]/u;
const show = (props: React.ComponentProps<typeof ExpandableText>) => render(<MantineProvider><ExpandableText {...props} /></MantineProvider>);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('ExpandableText', () => {
  it('shows a short value as is, with no length and no button', () => {
    show({ value: '/api/v1/ping' });
    expect(screen.getByTestId('expandable-text')).toHaveTextContent('/api/v1/ping');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('expandable-length')).toBeNull();
  });

  it('cuts a long value to the preview, states the true length, and opens it in place', () => {
    const value = `/a/${'b'.repeat(4809)}`;
    show({ value, previewChars: 50 });
    expect(screen.getByTestId('expandable-preview').textContent).toBe(`${value.slice(0, 50)}…`);
    expect(screen.getByTestId('expandable-length')).toHaveTextContent('4,812 characters');
    const button = screen.getByRole('button', { name: /show full/i });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveTextContent('Show less');
    expect(screen.getByTestId('expandable-full').textContent).toBe(value);
    fireEvent.click(button);
    expect(screen.queryByTestId('expandable-full')).toBeNull();
  });

  it('works from the keyboard: the control is a button that can be focused and activated', () => {
    show({ value: 'x'.repeat(500), previewChars: 20 });
    const button = screen.getByRole('button', { name: /show full/i });
    button.focus();
    expect(document.activeElement).toBe(button);
    // a real browser turns Enter or Space on a focused button into a click
    fireEvent.click(button);
    expect(screen.getByTestId('expandable-full')).toBeInTheDocument();
    expect(screen.getByTestId('expandable-full')).toHaveAttribute('tabindex', '0');
  });

  it('says how much reached the console when the value was cut upstream and the true length is known', () => {
    show({ value: 'y'.repeat(80), totalLength: 9000, previewChars: 200 });
    expect(screen.getByTestId('expandable-length')).toHaveTextContent('9,000 characters; 80 reached the console');
    expect(screen.queryByRole('button', { name: /show full/i })).toBeNull();
  });

  it('ignores a totalLength that is not larger than the value', () => {
    show({ value: 'short', totalLength: 3 });
    expect(screen.queryByTestId('expandable-length')).toBeNull();
    show({ value: 'short', totalLength: Number.NaN });
  });

  it('renders a megabyte inside a scroll box, capped at 64 KiB, with the note and a download of the whole value', () => {
    const value = 'z'.repeat(1024 * 1024);
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const blobs: Blob[] = [];
    create.mockImplementation(((b: Blob) => { blobs.push(b); return 'blob:x'; }) as never);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    show({ value, label: 'request path' });
    expect(screen.getByTestId('expandable-length')).toHaveTextContent('1,048,576 characters');
    fireEvent.click(screen.getByRole('button', { name: /show full/i }));
    const box = screen.getByTestId('expandable-full');
    expect(box.textContent?.length).toBe(SHOW_FULL_LIMIT);
    expect(box).toHaveStyle({ maxHeight: '320px', overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
    expect(screen.getByTestId('expandable-capped')).toHaveTextContent('Showing the first 64 KiB of 1,048,576 characters: download for the rest.');
    fireEvent.click(screen.getByRole('button', { name: 'Download as text' }));
    expect(click).toHaveBeenCalledOnce();
    expect(blobs[0]?.size).toBe(1024 * 1024);
  });

  it('shows no download below the cap', () => {
    show({ value: 'q'.repeat(1000), previewChars: 10 });
    fireEvent.click(screen.getByRole('button', { name: /show full/i }));
    expect(screen.queryByRole('button', { name: 'Download as text' })).toBeNull();
    expect(screen.queryByTestId('expandable-capped')).toBeNull();
  });

  it('copies the whole escaped value', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const value = `a${U(0x202e)}${'b'.repeat(300)}`;
    show({ value, previewChars: 10 });
    fireEvent.click(screen.getByRole('button', { name: /show full/i }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^copy/i })); });
    expect(writeText).toHaveBeenCalledWith(`a<U+202E>${'b'.repeat(300)}`);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied'));
  });

  it('does not throw when the clipboard is missing, refuses, or throws', async () => {
    for (const nav of [{}, { clipboard: { writeText: () => Promise.reject(new Error('denied')) } }, { clipboard: { writeText: () => { throw new Error('boom'); } } }]) {
      vi.stubGlobal('navigator', nav);
      const { unmount } = show({ value: 'c'.repeat(300), previewChars: 10 });
      fireEvent.click(screen.getByRole('button', { name: /show full/i }));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^copy/i })); });
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not copy'));
      unmount();
    }
  });

  it('shows the value as a text node, never as markup', () => {
    const value = `<img src=x onerror=alert(1)>${'<b>'.repeat(100)}`;
    const { container } = show({ value, previewChars: 20 });
    fireEvent.click(screen.getByRole('button', { name: /show full/i }));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByTestId('expandable-full').textContent).toBe(value);
  });

  it('calls onShowFull when opened', () => {
    const onShowFull = vi.fn();
    show({ value: 'v'.repeat(300), previewChars: 10, onShowFull });
    fireEvent.click(screen.getByRole('button', { name: /show full/i }));
    expect(onShowFull).toHaveBeenCalledOnce();
  });
});

describe('ExpandableText with hostile strings', () => {
  const CORPUS: Record<string, string> = {
    tagCharacters: `ok${U(0xe0049, 0xe0067, 0xe006e)}`,
    bidiOverride: `inv${U(0x202e)}oice${U(0x202c)}.exe`,
    zeroWidth: `a${U(0x200b, 0x200c, 0x200d, 0x2060, 0xfeff)}b`,
    lineSeparators: `a${U(0x2028, 0x2029)}b`,
    controls: `a${U(0x0000, 0x0007, 0x001b, 0x007f, 0x0085)}b`,
    loneHighSurrogate: `a${String.fromCharCode(0xd83d)}b`,
    endsInHighSurrogate: `abc${String.fromCharCode(0xd83d)}`,
    megabyteOfTags: U(0xe0041).repeat(64 * 1024),
    astral: U(0x1f600).repeat(500),
    protoKey: '__proto__',
    emptyString: '',
  };
  for (const [name, value] of Object.entries(CORPUS)) {
    it(`never throws and never shows a hidden character: ${name}`, () => {
      const { unmount } = show({ value, previewChars: 8 });
      const open = screen.queryByRole('button', { name: /show full/i });
      if (open) fireEvent.click(open);
      expect(HIDDEN_RE.test(screen.getByTestId('expandable-text').textContent ?? '')).toBe(false);
      unmount();
    });
  }
  it('gives an empty text for a value that is not a string', () => {
    show({ value: undefined as unknown as string });
    expect(screen.getByTestId('expandable-text').textContent).toBe('');
  });
  it('shows a tab or newline as a space in the preview and keeps them in the full value', () => {
    show({ value: `line1\nline2\tend${'.'.repeat(200)}`, previewChars: 30 });
    expect(screen.getByTestId('expandable-preview').textContent).toBe(`line1 line2 end${'.'.repeat(15)}…`);
    fireEvent.click(screen.getByRole('button', { name: /show full/i }));
    expect(screen.getByTestId('expandable-full').textContent).toContain('line1\nline2\tend');
  });
  it('does not split a surrogate pair or an escape token at the 64 KiB cap', () => {
    const value = `${'a'.repeat(SHOW_FULL_LIMIT - 1)}${U(0x1f600)}tail`;
    show({ value, previewChars: 10 });
    fireEvent.click(screen.getByRole('button', { name: /show full/i }));
    const shown = screen.getByTestId('expandable-full').textContent ?? '';
    expect(shown.endsWith(String.fromCharCode(0xd83d))).toBe(false);
  });
});
