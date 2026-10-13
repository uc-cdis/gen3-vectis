import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from './generated/contract.schema.json';
import { FIXTURES } from '../api/fixtureApi';

// fixture name (or prefix) -> contract model it must satisfy
const MODEL: Array<[RegExp, string]> = [
  [/^alerts\.response$/, 'AlertsResponse'], [/^overview\.response$/, 'OverviewResponse'],
  [/^timeline\.response$/, 'TimelineResponse'], [/^triage\.response$/, 'TriageResponse'],
  [/^cases\.list$/, 'CaseList'], [/^catalog\.response$/, 'CatalogResponse'], [/^rows\.response$/, 'RowsResponse'],
  [/^facets\.response$/, 'FacetsResponse'], [/^entity\.profile$/, 'EntityProfileResponse'],
  [/^graph\.response$/, 'GraphTraverseResponse'], [/^similar\.response$/, 'SimilarResponse'],
  [/^find-similar\.response$/, 'FindSimilarResponse'], [/^health\./, 'HealthResponse'],
  [/^quarantine\./, 'QuarantineResponse'], [/^indicators\.resolve$/, 'IndicatorResolveResponse'], [/^coverage\.response$/, 'CoverageResponse'],
  [/^views\.list$/, 'SavedViewList'], [/^hunts\.list$/, 'HuntList'], [/^ai\./, 'AiSummaryResponse'],
  [/^watchlist\.response$/, 'WatchlistResponse'], [/^why\./, 'WhyResponse'],
];

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(schema, 'contract');

describe('fixtures match the siem-app contract', () => {
  const names = Object.keys(FIXTURES);

  it('has fixtures', () => expect(names.length).toBeGreaterThan(20));

  it.each(names)('%s validates against its model', (name) => {
    const model = MODEL.find(([re]) => re.test(name))?.[1];
    expect(`${name}:${Boolean(model)}`).toBe(`${name}:true`);
    const validate = ajv.getSchema(`contract#/$defs/${model}`);
    expect(`${model}:${Boolean(validate)}`).toBe(`${model}:true`);
    const ok = validate!(FIXTURES[name]);
    expect(ok ? [] : validate!.errors).toEqual([]);
  });

  it('uses only reserved documentation addresses', () => {
    const text = JSON.stringify(FIXTURES);
    const ips = [...text.matchAll(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g)].map((m) => m.slice(1, 5).map(Number));
    const reserved = (p: number[]) => (p[0] === 192 && p[1] === 0 && p[2] === 2) || (p[0] === 198 && p[1] === 51 && p[2] === 100)
      || (p[0] === 203 && p[1] === 0 && p[2] === 113) || p[0] === 0;
    const bad = ips.filter((p) => !reserved(p) && !(p.every((n) => n <= 255) && /* version strings like 8.4.0.0 */ p[0] < 20 && p[3] === 0));
    expect(bad.slice(0, 5)).toEqual([]);
  });
});
