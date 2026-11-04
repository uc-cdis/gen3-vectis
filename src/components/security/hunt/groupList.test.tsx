import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderSecurity } from '../testing/render';
import { GroupList } from './FindSimilar';

describe('GroupList', () => {
  it('shows the name the graph records for a hashed request kind, the hash only on hover', async () => {
    const sig = { id: 't:RequestSignature:9f3a0c5b', label: 'RequestSignature', properties: { name: 'GET /index/{id}' } };
    const bare = { id: 't:RequestSignature:77aa11bb', label: 'RequestSignature', properties: {} };
    renderSecurity(<GroupList groups={[{ title: 'Kinds of request it sent', nodes: [sig, bare] }]} />);
    const named = await screen.findByText('GET /index/{id}');
    expect(named).toHaveAttribute('title', '9f3a0c5b');
    expect(screen.getByText('77aa11bb')).toBeInTheDocument();
  });
});
