import { describe, expect, it } from 'vitest';
import { filtersFromQuery } from './AlertsTab';

describe('filtersFromQuery', () => {
  it('opens exactly what the Overview linked to', () => {
    expect(filtersFromQuery({ status: 'new' }).status).toBe('new');
    expect(filtersFromQuery({ floor: 'high' }).floor).toBe('high');
    expect(filtersFromQuery({ all: '1' }).showLowInfo).toBe(true);
  });
  it('ignores anything it does not recognise and falls back to the defaults', () => {
    const f = filtersFromQuery({ status: "x' OR 1=1", floor: '<script>', all: 'yes' });
    expect(f).toMatchObject({ status: '', floor: 'medium', showLowInfo: false });
    expect(filtersFromQuery({}).includeNoise).toBe(false);
  });
});
