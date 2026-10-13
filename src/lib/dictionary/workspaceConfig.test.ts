import { describe, expect, it } from 'vitest';
import workspaces from '../../../config/gen3/workspaces.json';
import { withoutFrameworkDictionary } from './workspaceConfig';

describe('withoutFrameworkDictionary', () => {
  it('disables the rail in every tier and keeps the rest of the tier', () => {
    const input = { workspaces: {}, tierConfiguration: { free: { dataAndTools: { enabled: true, width: 300 }, toolbar: { tierLabel: 'lite' } }, remote: { toolbar: {} } } };
    const out = withoutFrameworkDictionary(input);
    expect(out.tierConfiguration.free).toEqual({ dataAndTools: { enabled: false, width: 300 }, toolbar: { tierLabel: 'lite' } });
    expect(out.tierConfiguration.remote).toEqual({ toolbar: {}, dataAndTools: { enabled: false } });
    expect(input.tierConfiguration.free.dataAndTools.enabled).toBe(true); // input untouched
  });
  it('copes with a configuration that has no tiers', () => {
    expect(withoutFrameworkDictionary({})).toEqual({ tierConfiguration: {} });
  });
  it('agrees with the committed config/gen3/workspaces.json, which also turns the rail off', () => {
    for (const tier of Object.values(workspaces.tierConfiguration)) expect(tier.dataAndTools.enabled).toBe(false);
  });
});
