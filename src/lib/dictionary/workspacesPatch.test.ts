import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPatches, BUNDLES, MARK, PATCHES } from '../../../scripts/patch-gen3-workspaces.mjs';

const pkg = path.resolve(import.meta.dirname, '../../../node_modules/@gen3/workspaces');
const installed = fs.existsSync(pkg);

/** The upstream parser, taken from the installed (patched) bundle so the test exercises the real code. */
const upstreamParser = (): ((schema: unknown) => Array<Record<string, any>>) => {
  const text = fs.readFileSync(path.join(pkg, BUNDLES[0]), 'utf8');
  const start = text.indexOf('function parseSchemaNodes(');
  const end = text.indexOf('// ── Build compact dictionary context');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return new Function(`${text.slice(start, end)}\nreturn parseSchemaNodes;`)();
};

const ddv2 = {
  version: 'x',
  schema: 'https://json-schema.org/draft/2020-12/schema',
  required: ['id'],
  entities: {
    account: { properties: { accountId: { type: ['string', 'null'], description: 'The account.' }, region: { type: 'string', enum: ['a', 'b'] } } },
    api_activity: { properties: { time: { type: ['integer', 'null'] } } },
  },
  graphContract: { labels: { Account: ['account'] }, edges: [] },
};

describe.skipIf(!installed)('the Data & Tools panel against the DDv2 dictionary', () => {
  it('lists the entities, not the document sections', () => {
    const nodes = upstreamParser()(ddv2);
    expect(nodes.map((n) => n.id)).toEqual(['account', 'api_activity']);
  });

  it('shows ["string","null"] as string and keeps descriptions and enums', () => {
    const account = upstreamParser()(ddv2).find((n) => n.id === 'account')!;
    expect(account.properties.accountId).toMatchObject({ type: 'string', description: 'The account.' });
    expect(account.properties.region).toMatchObject({ type: 'string', enum: ['a', 'b'] });
    expect(upstreamParser()(ddv2).find((n) => n.id === 'api_activity')!.properties.time.type).toBe('integer');
  });

  it('still reads a classic node-keyed dictionary', () => {
    const nodes = upstreamParser()({ person: { title: 'Person', properties: { age: { type: 'integer' } }, links: [{ name: 'x', target_type: 'y' }] } });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ id: 'person', title: 'Person', links: [{ name: 'x', target_type: 'y' }] });
  });

  it('every bundle carries the patch and shows the AI Assistant tab', () => {
    for (const rel of BUNDLES) {
      const text = fs.readFileSync(path.join(pkg, rel), 'utf8');
      expect(text, rel).toContain(MARK);
      expect(text, rel).toContain("label: 'AI Assistant'");
      expect(text, rel).toContain('/api/v0/submission/${schemaUrl}');
    }
  });
});

describe('applyPatches', () => {
  const sample = PATCHES.map((p) => p.from).join('\n/* between */\n');

  it('applies every edit once and is idempotent', () => {
    const once = applyPatches(sample);
    expect(once).toContain(MARK);
    expect(applyPatches(once)).toBe(once);
  });

  it('fails loudly when upstream code no longer matches', () => {
    expect(() => applyPatches(sample.replace(PATCHES[2]!.from, 'changed upstream'))).toThrow(/AI Assistant tab/);
  });

  it('fails when an edit would match more than once', () => {
    expect(() => applyPatches(`${sample}\n${PATCHES[1]!.from}`)).toThrow(/array property types/);
  });
});
