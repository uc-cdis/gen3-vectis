import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { TimelinePoint } from '@/lib/vectis-kit/spec';

const captured: { props: Record<string, unknown> | null } = { props: null };
vi.mock('@gen3/frontend', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ReactECharts: (p: Record<string, unknown>) => { captured.props = p; return <div data-testid="echart" />; },
}));

import { RollupChart } from './RollupChart';

const pts: TimelinePoint[] = [
  { bucket_start: '2026-10-09T10:00:00Z', event_count: 4, distinct_src_ips: 2, bytes_out_max: null, dims: {} },
  { bucket_start: '2026-10-09T10:05:00Z', event_count: 9, distinct_src_ips: 3, bytes_out_max: 1000, dims: {} },
];
const mount = (ui: React.ReactElement) => render(<MantineProvider>{ui}</MantineProvider>);

describe('RollupChart', () => {
  beforeEach(() => { captured.props = null; });

  it('shows the empty message and no chart when there are no points', () => {
    mount(<RollupChart points={[]} grain="5m" label="Traffic" empty={<p>nothing here</p>} />);
    expect(screen.getByText('nothing here')).toBeInTheDocument();
    expect(captured.props).toBeNull();
  });

  it('passes the built option, a text alternative and a data table', () => {
    mount(<RollupChart points={pts} grain="5m" label="Traffic" />);
    expect((captured.props!.option as { series: unknown[] }).series.length).toBe(3);
    expect(screen.getByRole('figure', { name: /Traffic\. 2 buckets/ })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Traffic, data table' })).toBeInTheDocument();
    expect(screen.getByText('not recorded')).toBeInTheDocument();
  });

  it('reports a brushed range as ISO start/end and a cleared selection as null', () => {
    const onRange = vi.fn();
    mount(<RollupChart points={pts} grain="5m" label="Traffic" onRangeSelect={onRange} />);
    expect((captured.props!.option as { brush: unknown }).brush).toBeDefined();
    const ev = captured.props!.events as Record<string, (e: unknown) => void>;
    ev.brushEnd!({ areas: [{ coordRange: [Date.parse('2026-10-09T10:01:00Z'), Date.parse('2026-10-09T10:06:00Z')] }] });
    expect(onRange).toHaveBeenLastCalledWith({ start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T10:10:00.000Z' });
    ev.brush!({ areas: [] });
    expect(onRange).toHaveBeenLastCalledWith(null);
  });

  it('has no brush when no handler is given', () => {
    mount(<RollupChart points={pts} grain="5m" label="Traffic" />);
    expect((captured.props!.option as { brush?: unknown }).brush).toBeUndefined();
    expect(captured.props!.events).toBeUndefined();
  });

  it('offers a keyboard route and rejects an inverted range', async () => {
    const onRange = vi.fn();
    mount(<RollupChart points={pts} grain="5m" label="Traffic" onRangeSelect={onRange} />);
    await userEvent.click(screen.getByText('Choose a time range with the keyboard'));
    await userEvent.type(screen.getByLabelText('From (local time)'), '2026-10-09T11:00');
    await userEvent.type(screen.getByLabelText('To (local time)'), '2026-10-09T10:00');
    await userEvent.click(screen.getByRole('button', { name: 'Use this range' }));
    expect(screen.getByText('The start must be before the end.')).toBeInTheDocument();
    expect(onRange).not.toHaveBeenCalled();
  });
});
