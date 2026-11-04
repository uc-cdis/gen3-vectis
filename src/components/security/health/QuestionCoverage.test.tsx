import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { GraphCoveragePath } from '@/lib/vectis-kit/spec';
import { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';
import { renderSecurity } from '../testing/render';
import { QuestionCoverage, blockedBy } from './QuestionCoverage';

const path = (id: string, state: GraphCoveragePath['state'], relation: string, first: number | null = 0): GraphCoveragePath => ({
  id, scenario: 'S8', title: id, start: 'Host', state, first_missing: first, ends_in_events: false,
  steps: [{ relation, layer: 'graph', edges: state === 'missing' ? 0 : 5 }],
});

describe('blockedBy', () => {
  it('names each relation with no edges once, the one that stops the most questions first', () => {
    const found = blockedBy([path('A', 'missing', 'has_address'), path('B', 'missing', 'has_address'), path('C', 'missing', 'spawned'), path('D', 'answerable', 'asked_for')]);
    expect(found).toEqual([{ relation: 'has_address', ids: ['A', 'B'] }, { relation: 'spawned', ids: ['C'] }]);
  });
  it('ignores questions that can be answered or start in the events', () => {
    expect(blockedBy([path('A', 'answerable', 'x', null), path('B', 'events', 'y', null)])).toEqual([]);
  });
});

describe('QuestionCoverage', () => {
  it('counts the questions by state and lists what has no edges', async () => {
    renderSecurity(<QuestionCoverage />, { api: createFixtureApi(0) });
    const panel = await screen.findByTestId('question-coverage');
    expect(within(panel).getByText('2 can be answered')).toBeInTheDocument();
    expect(within(panel).getByText('1 wait for data')).toBeInTheDocument();
    const table = within(panel).getByRole('table', { name: 'Relations with no edges' });
    expect(within(table).getByText('has_address')).toBeInTheDocument();
    expect(within(table).getByText('B8')).toBeInTheDocument();
  });
});
