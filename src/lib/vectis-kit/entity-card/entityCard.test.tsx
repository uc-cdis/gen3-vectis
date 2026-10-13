import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { CopyValue, FactList } from './blocks';
import { escapeHtml, neutraliseBraces, safeText, truncateText } from '@/lib/safe-text';

describe('text helpers', () => {
  it('truncates by code point with an ellipsis', () => {
    expect(truncateText('abcdef', 4)).toBe('abc…');
    expect(truncateText('abc', 4)).toBe('abc');
    expect(Array.from(truncateText('😀'.repeat(10), 5))).toHaveLength(5);
  });
  it('strips control and bidi characters and stringifies objects', () => {
    expect(safeText('a\u0000b‮c')).toBe('a b c');
    expect(safeText({ a: 1 })).toBe('{"a":1}');
    expect(safeText(null)).toBe('');
  });
  it('escapes HTML and braces', () => {
    expect(escapeHtml('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
    expect(neutraliseBraces('{a|b}')).not.toMatch(/[{}]/);
  });
});

describe('primitives', () => {
  it('renders facts and a copyable value as text', () => {
    const { container } = render(<MantineProvider><FactList facts={[{ label: 'Org', value: '<b>x</b>' }]} /><CopyValue value="ip:1.2.3.4" what="entity key" /></MantineProvider>);
    expect(screen.getByText('<b>x</b>')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy entity key' })).toBeInTheDocument();
  });
});
