import { describe, expect, it } from 'vitest';
import { SAMPLE_DICTIONARY as sample } from './sample';
import type { Dictionary } from './ddv2';
import { cleanText } from '@/lib/safe-text';
import { LIMITS, groupEntities, parseDictionary, parseDictionaryText, searchEntities, vocabularyModel } from './ddv2';

const ok = (input: unknown): Dictionary => {
  const r = parseDictionary(input);
  if (!r.ok) throw new Error(r.error);
  return r.dictionary;
};
const bad = (input: unknown): string => {
  const r = parseDictionary(input);
  if (r.ok) throw new Error('expected the dictionary to be refused');
  return r.error;
};
const tiny = (over: Record<string, unknown> = {}) => ({ version: 'v1', schema: 's', entities: { thing: { properties: { name: { type: ['string', 'null'] } } } }, ...over });

describe('a published dictionary', () => {
  const d = ok(sample);
  it('reads the version, schema and required keys', () => {
    expect(d.version).toBe('sample-ddv2-v1');
    expect(d.schema).toBe('tenant-observation-envelope');
    expect(d.required).toEqual(['tenantId', 'source', 'eventTime']);
  });
  it('reads every entity and property', () => {
    expect(d.entities).toHaveLength(8);
    expect(d.propertyCount).toBe(d.entities.reduce((n, e) => n + e.properties.length, 0));
    expect(d.entities.find((e) => e.name === 'http_activity')?.properties).toHaveLength(9);
    expect(d.entities.find((e) => e.name === 'gen3model')?.properties).toEqual([]);
  });
  it('keeps property names exactly as the dictionary names them (camelCase)', () => {
    const names = d.entities.find((e) => e.name === 'http_activity')!.properties.map((p) => p.name);
    expect(names).toContain('forwarderHost');
    expect(names.some((n) => n.includes('_'))).toBe(false);
  });
  it('reads types, nullability, enums, defaults and ranges', () => {
    const acct = d.entities.find((e) => e.name === 'account')!.properties;
    const blast = acct.find((p) => p.name === 'blastRadiusScore')!;
    expect(blast).toMatchObject({ types: ['number'], nullable: true, typeLabel: 'number', minimum: 0, maximum: 10 });
    expect(acct.find((p) => p.name === 'decommissioned')).toMatchObject({ types: ['boolean'], defaultValue: 'false' });
    expect(acct.find((p) => p.name === 'scoredAt')?.format).toBe('date-time');
    const outcome = d.entities.find((e) => e.name === 'http_activity')!.properties.find((p) => p.name === 'outcome')!;
    expect(outcome.enumValues).toEqual(['allow', 'block', 'error', 'unknown']);
    expect(d.entities.flatMap((e) => e.properties).some((p) => p.typeLabel.startsWith('array of '))).toBe(true);
  });
  it('flags required and envelope keys; nothing is marked PII because the dictionary marks nothing', () => {
    const http = d.entities.find((e) => e.name === 'http_activity')!.properties;
    expect(http.find((p) => p.name === 'tenantId')).toMatchObject({ required: true, envelope: true });
    expect(http.find((p) => p.name === 'srcIp')).toMatchObject({ required: false, pii: false });
    expect(d.entities.flatMap((e) => e.properties).some((p) => p.pii)).toBe(false);
  });
  it('reads the graph vocabulary: labels, edges, open families', () => {
    expect(d.labels).toHaveLength(9);
    expect(d.edges).toHaveLength(5);
    expect(d.families.map((f) => f.name)).toEqual(['apiOperation', 'flow', 'stixRelationship']);
    expect(d.families.find((f) => f.name === 'flow')).toMatchObject({ relation: 'flowed_to', pattern: '^flow:[A-Za-z0-9_]+(:[A-Za-z0-9_]+)?$' });
    expect(d.families.find((f) => f.name === 'stixRelationship')?.relation).toBe('');
    expect(d.entities.find((e) => e.name === 'http_activity')?.labels).toEqual(expect.arrayContaining(['WafRequest', 'Observation']));
  });
  it('matches every label-to-entity reference, including a camelCase spelling of a snake_case entity', () => {
    expect(d.notes.join(' ')).toMatch(/1 label-to-entity reference\(s\) spell the entity in camelCase/);
    expect(d.notes.join(' ')).not.toMatch(/name an entity the dictionary does not define/);
    expect(d.labels.find((l) => l.name === 'ServiceLog')?.entities).toEqual(['service_log']);
    expect(d.labels.find((l) => l.name === 'WafRequest')?.entities).toEqual(['http_activity']);
  });
  it('declares no dangling edges', () => expect(d.edges.filter((e) => e.dangling)).toEqual([]));
  it('splits the vocabulary: labels with declared edges, labels related only by an open family, isolated labels', () => {
    const m = vocabularyModel(d);
    const labelNodes = (g: { nodes: { id: string; label: string }[] }) => g.nodes.filter((n) => n.label === 'Graph label').map((n) => n.id);
    expect(labelNodes(m.declared).sort()).toEqual(['Account', 'IpAddress', 'Observation', 'Principal', 'Resource', 'WafRequest']);
    expect(m.openOnly).toHaveLength(1);
    expect(m.openOnly[0]!.family.name).toBe('stixRelationship');
    const intel = labelNodes(m.openOnly[0]!.graph).sort();
    expect(intel).toEqual(['Indicator', 'Observation', 'Technique']); // Observation also has declared edges
    expect(m.isolated).toEqual(['ServiceLog']);
    const shown = new Set([...labelNodes(m.declared), ...intel, ...m.isolated]);
    expect(shown.size).toBe(9);
    const declaredTypes = new Set(d.edges.map((e) => e.type));
    for (const e of m.declared.edges) expect(declaredTypes.has(e.edge_type) || m.declared.open.has(e.edge_type)).toBe(true);
    expect(m.declared.edges.filter((e) => declaredTypes.has(e.edge_type))).toHaveLength(5);
    expect([...m.declared.open].sort()).toEqual(['apiOperation (open)', 'flow (open)']);
    expect(m.openOnly[0]!.graph.nodes.filter((n) => n.label === 'Open edge family')).toHaveLength(1);
  });
  it('groups by graph-label coverage because the dictionary has no categories', () => {
    expect(d.entities.every((e) => e.category === null)).toBe(true);
    const groups = groupEntities(d);
    expect(groups.map((g) => g.title)).toEqual(['Carried by graph labels', 'Not carried by any graph label']);
    expect(groups.reduce((n, g) => n + g.entities.length, 0)).toBe(8);
  });
  it('is read from text as well, and is well under the byte limit', () => {
    const text = JSON.stringify(sample);
    expect(text.length).toBeLessThan(LIMITS.bytes);
    expect(parseDictionaryText(text).ok).toBe(true);
  });
});

describe('search', () => {
  const d = ok(sample);
  it('returns everything for an empty query', () => expect(searchEntities(d, '  ')).toHaveLength(8));
  it('matches entity names, property names, descriptions and labels, case-insensitively', () => {
    expect(searchEntities(d, 'HTTP_ACT').map((h) => h.entity.name)).toContain('http_activity');
    const byProp = searchEntities(d, 'forwarderhost');
    expect(byProp.length).toBeGreaterThan(0);
    expect(byProp[0]!.properties).toContain('forwarderHost');
    expect(searchEntities(d, 'wafrequest').map((h) => h.entity.name)).toContain('http_activity');
  });
  it('finds nothing for nonsense, and bounds the query', () => {
    expect(searchEntities(d, 'zzzz-no-such-thing')).toEqual([]);
    expect(() => searchEntities(d, 'x'.repeat(100_000))).not.toThrow();
  });
});

describe('hostile documents are refused, never thrown', () => {
  it.each([
    ['null', null], ['a number', 7], ['a string', 'x'], ['an array', []], ['no entities', {}], ['entities is a list', { entities: [] }],
    ['entities is text', { entities: 'x' }], ['an entity is text', { entities: { thing: 'x' } }], ['an entity has no properties', { entities: { thing: {} } }],
    ['properties is a list', { entities: { thing: { properties: [] } } }], ['a property schema is text', { entities: { thing: { properties: { a: 'string' } } } }],
    ['wrong-typed description', { entities: { thing: { properties: { a: { description: 5 } } } } }],
    ['wrong-typed type', { entities: { thing: { properties: { a: { type: 5 } } } } }],
    ['type list is too long', { entities: { thing: { properties: { a: { type: Array(9).fill('string') } } } } }],
    ['type is not a plain name', { entities: { thing: { properties: { a: { type: '<script>' } } } } }],
    ['enum is not a list', { entities: { thing: { properties: { a: { enum: 'x' } } } } }],
    ['enum holds an object', { entities: { thing: { properties: { a: { enum: [{}] } } } } }],
    ['enum is huge', { entities: { thing: { properties: { a: { enum: Array(101).fill('x') } } } } }],
    ['default is an object', { entities: { thing: { properties: { a: { default: {} } } } } }],
    ['minimum is not finite', { entities: { thing: { properties: { a: { minimum: 'low' } } } } }],
    ['pii is a string', { entities: { thing: { properties: { a: { pii: 'yes' } } } } }],
    ['items is text', { entities: { thing: { properties: { a: { items: 'x' } } } } }],
    ['entity name has markup', { entities: { '<img onerror=1>': { properties: {} } } }],
    ['property name has markup', { entities: { thing: { properties: { '<b>': {} } } } }],
    ['entity name is too long', { entities: { ['a'.repeat(129)]: { properties: {} } } }],
    ['required is not a list', tiny({ required: 'tenantId' })],
    ['graphContract is a list', tiny({ graphContract: [] })],
    ['labels is a list', tiny({ graphContract: { labels: [] } })],
    ['a label maps to text', tiny({ graphContract: { labels: { Thing: 'thing' } } })],
    ['edges is an object', tiny({ graphContract: { edges: {} } })],
    ['an edge is text', tiny({ graphContract: { edges: ['x'] } })],
    ['an edge type has markup', tiny({ graphContract: { labels: { A: [] }, edges: [{ type: '<x>', from: 'A', to: 'A' }] } })],
    ['an edge has no ends', tiny({ graphContract: { labels: { A: [] }, edges: [{ type: 't' }] } })],
    ['a family has no pattern', tiny({ graphContract: { edgeFamilies: [{ name: 'f' }] } })],
    ['a family pattern is a list', tiny({ graphContract: { edgeFamilies: [{ name: 'f', pattern: [] }] } })],
  ])('refuses %s', (_label, doc) => {
    expect(bad(doc)).toEqual(expect.any(String));
  });

  it.each(['__proto__', 'constructor', 'prototype'])('refuses the name %s anywhere a name goes', (key) => {
    const fromJson = (s: string) => JSON.parse(s) as unknown;
    expect(bad(fromJson(`{"entities":{"${key}":{"properties":{}}}}`))).toMatch(/not allowed|not a valid/);
    expect(bad(fromJson(`{"entities":{"thing":{"properties":{"${key}":{}}}}}`))).toMatch(/not allowed|not a valid/);
    expect(bad(fromJson(`{"entities":{"thing":{"properties":{}}},"graphContract":{"labels":{"${key}":[]}}}`))).toMatch(/not allowed|not a valid/);
    expect(bad(fromJson(`{"entities":{"thing":{"properties":{}}},"graphContract":{"labels":{"A":["${key}"]}}}`))).toMatch(/invalid item/);
    expect(bad(fromJson(`{"${key}":1,"entities":{"thing":{"properties":{}}}}`))).toMatch(/not allowed/);
  });

  it('does not pollute Object.prototype when a hostile key is present', () => {
    parseDictionaryText('{"__proto__":{"polluted":"yes"},"entities":{"thing":{"properties":{}}}}');
    parseDictionaryText('{"entities":{"thing":{"properties":{"a":{"__proto__":{"polluted":"yes"},"type":"string"}}}}}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses text that is not JSON, or is too large', () => {
    expect(parseDictionaryText('{nope').ok).toBe(false);
    expect(parseDictionaryText('').ok).toBe(false);
    const big = parseDictionaryText(' '.repeat(LIMITS.bytes + 1));
    expect(big).toMatchObject({ ok: false, error: expect.stringContaining('larger') });
  });

  it('enforces the count limits', () => {
    const many = Object.fromEntries(Array.from({ length: LIMITS.entities + 1 }, (_, i) => [`e${i}`, { properties: {} }]));
    expect(bad({ entities: many })).toMatch(/entities/);
    const props = Object.fromEntries(Array.from({ length: LIMITS.propertiesPerEntity + 1 }, (_, i) => [`p${i}`, {}]));
    expect(bad({ entities: { thing: { properties: props } } })).toMatch(/properties/);
    const spread = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`e${i}`, { properties: Object.fromEntries(Array.from({ length: 700 }, (_, j) => [`p${j}`, {}])) }]));
    expect(bad({ entities: spread })).toMatch(/in all/);
    expect(bad(tiny({ graphContract: { edges: Array(LIMITS.edges + 1).fill({ type: 't', from: 'A', to: 'A' }) } }))).toMatch(/edges/);
    expect(bad(tiny({ graphContract: { edgeFamilies: Array(LIMITS.families + 1).fill({ name: 'f', pattern: 'x' }) } }))).toMatch(/edgeFamilies/);
    expect(bad(tiny({ required: Array(LIMITS.listItems + 1).fill('tenantId') }))).toMatch(/items/);
  });

  it('does not recurse into deeply nested junk under unread keys', () => {
    let deep: unknown = 'x';
    for (let i = 0; i < 5000; i += 1) deep = { a: deep };
    expect(ok({ entities: { thing: { properties: { a: { type: 'string', unknown: deep } }, junk: deep } }, extra: deep }).entities).toHaveLength(1);
  });
});

describe('text is reduced to plain, bounded text', () => {
  it('truncates huge strings and strips control, zero-width and bidi characters', () => {
    const long = 'A'.repeat(1_000_000);
    const d = ok({ version: long, schema: long, entities: { thing: { description: long, properties: { a: { type: 'string', description: `ok‮​\u0000\u0007evil${long}`, enum: [long] } } } } });
    expect(Array.from(d.version).length).toBeLessThanOrEqual(LIMITS.short);
    expect(Array.from(d.entities[0]!.description).length).toBeLessThanOrEqual(LIMITS.text);
    const p = d.entities[0]!.properties[0]!;
    expect(p.description).not.toMatch(/[\p{Cc}‮​]/u);
    expect(p.description.startsWith('ok')).toBe(true);
    expect(Array.from(p.description).length).toBeLessThanOrEqual(LIMITS.text);
    expect(p.enumValues[0]!.length).toBeLessThanOrEqual(LIMITS.short);
  });
  it('keeps HTML as inert text (React renders it as text)', () => {
    const d = ok({ entities: { thing: { properties: { a: { type: 'string', description: '<img src=x onerror=alert(1)><script>boom()</script>' } } } } });
    expect(d.entities[0]!.properties[0]!.description).toBe('<img src=x onerror=alert(1)><script>boom()</script>');
  });
  it('does not split a surrogate pair when truncating', () => {
    const s = cleanText('😀'.repeat(50), 10);
    expect(Array.from(s)).toHaveLength(10);
    expect(s.endsWith('…')).toBe(true);
  });
  it('never compiles a family pattern: a catastrophic pattern is just text', () => {
    const d = ok(tiny({ graphContract: { edgeFamilies: [{ name: 'evil', pattern: '^(a+)+$', from: [], to: [] }] } }));
    expect(d.families[0]!.pattern).toBe('^(a+)+$');
  });
});

describe('graph vocabulary edge cases', () => {
  const contract = {
    labels: { A: ['thing'], B: ['thing', 'ghost'] },
    edges: [{ type: 'a_to_b', from: 'A', to: 'B' }, { type: 'b_to_a', from: 'B', to: 'A', relation: 'back' }, { type: 'self', from: 'A', to: 'A' }, { type: 'lost', from: 'A', to: 'Nowhere' }],
  };
  const d = ok(tiny({ graphContract: contract }));
  it('accepts cycles and self-loops', () => {
    expect(vocabularyModel(d).declared.edges.map((e) => e.edge_type)).toEqual(['a_to_b', 'b_to_a', 'self']);
  });
  it('lists an edge to an undeclared label as dangling and does not draw it', () => {
    expect(d.edges.find((e) => e.type === 'lost')?.dangling).toBe(true);
    expect(d.notes.join(' ')).toMatch(/1 edge type/);
  });
  it('ignores a label that names an entity the dictionary does not define, and says so', () => {
    expect(d.labels.find((l) => l.name === 'B')?.entities).toEqual(['thing']);
    expect(d.notes.join(' ')).toMatch(/1 label-to-entity/);
    expect(d.entities[0]!.labels).toEqual(['A', 'B']);
  });
  it('matches a camelCase reference only to its snake_case entity, nothing looser', () => {
    const x = ok({ entities: { http_activity: { properties: {} }, other: { properties: {} } }, graphContract: { labels: { W: ['httpActivity', 'HTTPACTIVITY', 'httpactivity', 'othr'] } } });
    expect(x.labels[0]!.entities).toEqual(['http_activity']);
    expect(x.notes.join(' ')).toMatch(/3 label-to-entity reference\(s\) name an entity the dictionary does not define/);
  });
  it('treats a dictionary without a graphContract as valid with an empty vocabulary', () => {
    const none = ok(tiny());
    expect(none).toMatchObject({ hasContract: false, labels: [], edges: [], families: [] });
    expect(groupEntities(none).map((g) => g.title)).toEqual(['Entities']);
  });
  it('uses the dictionary category for grouping when it carries one', () => {
    const c = ok({ entities: { a: { category: 'Alpha', properties: {} }, b: { properties: {} } } });
    expect(groupEntities(c).map((g) => g.title)).toEqual(['Alpha', 'Uncategorised']);
  });
  it('shows PII only when the dictionary says so', () => {
    const p = ok({ entities: { a: { properties: { x: { type: 'string', pii: true }, y: { type: 'string' } } } } }).entities[0]!.properties;
    expect(p.map((q) => q.pii)).toEqual([true, false]);
  });
});
