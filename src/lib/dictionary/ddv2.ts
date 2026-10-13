/**
 * Strict, bounded reader for the DDv2 dictionary (the document published at config/dd/current.json and served at
 * `<GEN3_SUBMISSION_API>/_dictionary/_all/`):
 *
 *   { version, schema, required: [name], entities: { <entity>: { properties: { <name>: <schema> } } },
 *     graphContract: { envelopeKeys, internalKeys, labels: { <Label>: [entity] }, edges: [..], edgeFamilies: [..] } }
 *
 * The document is untrusted input. Everything here is bounded (bytes, counts, string lengths), reduced to plain text
 * (control, zero-width and bidirectional-override characters removed), built into arrays and Maps rather than
 * attacker-keyed objects, and refuses names that could reach Object.prototype. The shape is checked, not assumed: a
 * known key with the wrong type, or any structure that is not a dictionary, yields `{ ok: false }` and never throws.
 * A pattern from an edge family is kept as text and is never compiled into a RegExp.
 */

import { cleanText } from '@/lib/safe-text';

export const LIMITS = {
  bytes: 2_000_000,
  entities: 500,
  propertiesPerEntity: 1_000,
  totalProperties: 20_000,
  labels: 500,
  edges: 5_000,
  families: 200,
  listItems: 200,
  enumValues: 100,
  name: 128,
  text: 2_000,
  short: 128,
} as const;

export interface Property {
  name: string;
  /** JSON-schema type names without "null", in the order the dictionary gives them. Empty when it gives none. */
  types: string[];
  nullable: boolean;
  /** Display form, e.g. "string", "array of string", or "unspecified". */
  typeLabel: string;
  description: string;
  format: string;
  enumValues: string[];
  defaultValue: string | null;
  minimum: number | null;
  maximum: number | null;
  /** In the dictionary's top-level `required` list. */
  required: boolean;
  /** One of graphContract.envelopeKeys. */
  envelope: boolean;
  /** One of graphContract.internalKeys. */
  internal: boolean;
  /** True only when the dictionary itself says so (`pii: true`). Never guessed from the name. */
  pii: boolean;
}

export interface Entity {
  name: string;
  /** Only when the dictionary entity carries a `category`. */
  category: string | null;
  description: string;
  properties: Property[];
  /** Graph labels whose entry in graphContract.labels lists this entity. */
  labels: string[];
}

interface Label { name: string; entities: string[] }
interface Edge { type: string; from: string; to: string; relation: string; dangling: boolean }
interface Family { name: string; pattern: string; from: string[]; to: string[]; relation: string; note: string }

export interface Dictionary {
  version: string;
  schema: string;
  required: string[];
  envelopeKeys: string[];
  internalKeys: string[];
  /** Sorted by name. */
  entities: Entity[];
  labels: Label[];
  edges: Edge[];
  families: Family[];
  hasContract: boolean;
  propertyCount: number;
  /** Things that were dropped or flagged but did not make the document unusable. */
  notes: string[];
}

type ParseResult = { ok: true; dictionary: Dictionary } | { ok: false; error: string };

class Refused extends Error {}
const refuse = (msg: string): never => { throw new Refused(msg); };

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const snakeCase = (s: string): string => s.replace(/(?<=[a-z0-9])([A-Z])/g, (_m, c: string) => `_${c.toLowerCase()}`).toLowerCase();
const EDGE_TYPE = /^[A-Za-z0-9_:.-]+$/;

// Control characters, zero-width characters, byte-order mark and the bidirectional overrides and isolates.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: Record<string, unknown>, k: string): boolean => Object.hasOwn(o, k);
const get = (o: Record<string, unknown>, k: string): unknown => (has(o, k) ? o[k] : undefined);

/** Own keys of a record, refusing any that could reach the prototype chain. */
function keysOf(o: Record<string, unknown>, where: string): string[] {
  const keys = Object.keys(o);
  for (const k of keys) if (FORBIDDEN.has(k)) refuse(`${where}: the key "${k}" is not allowed`);
  return keys;
}

function name(v: unknown, where: string): string {
  if (typeof v !== 'string' || v.length > LIMITS.name || !NAME.test(v) || FORBIDDEN.has(v)) refuse(`${where}: not a valid name`);
  return v as string;
}

function textOf(o: Record<string, unknown>, key: string, max: number, where: string): string {
  const v = get(o, key);
  if (v === undefined) return '';
  if (typeof v !== 'string') refuse(`${where}: "${key}" must be text`);
  return cleanText(v as string, max);
}

function stringList(v: unknown, where: string, check: (s: string) => boolean = () => true): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return refuse(`${where}: must be a list`);
  if (v.length > LIMITS.listItems) refuse(`${where}: more than ${LIMITS.listItems} items`);
  return v.map((s) => {
    if (typeof s !== 'string' || s.length > LIMITS.name || !check(s) || FORBIDDEN.has(s)) refuse(`${where}: contains an invalid item`);
    return s as string;
  });
}

const finite = (v: unknown, where: string): number | null => {
  if (v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) refuse(`${where}: must be a finite number`);
  return v as number;
};

function typeNames(v: unknown, where: string): string[] {
  if (v === undefined) return [];
  const list = typeof v === 'string' ? [v] : v;
  if (!Array.isArray(list) || list.length > 8) return refuse(`${where}: "type" must be a type name or a short list of them`);
  return list.map((t) => {
    if (typeof t !== 'string' || t.length > 32 || !/^[a-z]+$/.test(t)) refuse(`${where}: invalid type name`);
    return t as string;
  });
}

function primitiveText(v: unknown, where: string): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return cleanText(v, LIMITS.short);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return refuse(`${where}: must be a plain value`);
}

function property(pname: string, raw: unknown, ctx: { required: Set<string>; envelope: Set<string>; internal: Set<string> }, where: string): Property {
  if (!isRecord(raw)) refuse(`${where}: property schema must be an object`);
  const o = raw as Record<string, unknown>;
  const all = typeNames(get(o, 'type'), where);
  const nullable = all.includes('null');
  const types = all.filter((t) => t !== 'null');
  let itemsType = '';
  const items = get(o, 'items');
  if (items !== undefined) {
    if (!isRecord(items)) refuse(`${where}: "items" must be an object`);
    itemsType = typeNames(get(items as Record<string, unknown>, 'type'), `${where}.items`).filter((t) => t !== 'null').join(' | ');
  }
  const typeLabel = types.length === 0 ? 'unspecified' : types.map((t) => (t === 'array' && itemsType ? `array of ${itemsType}` : t)).join(' | ');
  const en = get(o, 'enum');
  let enumValues: string[] = [];
  if (en !== undefined) {
    if (!Array.isArray(en) || en.length > LIMITS.enumValues) refuse(`${where}: "enum" must be a short list`);
    enumValues = (en as unknown[]).map((e) => primitiveText(e, `${where}.enum`));
  }
  const def = get(o, 'default');
  const pii = get(o, 'pii');
  if (pii !== undefined && typeof pii !== 'boolean') refuse(`${where}: "pii" must be true or false`);
  return {
    name: pname,
    types,
    nullable,
    typeLabel,
    description: textOf(o, 'description', LIMITS.text, where),
    format: textOf(o, 'format', 64, where),
    enumValues,
    defaultValue: def === undefined ? null : primitiveText(def, `${where}.default`),
    minimum: finite(get(o, 'minimum'), `${where}.minimum`),
    maximum: finite(get(o, 'maximum'), `${where}.maximum`),
    required: ctx.required.has(pname),
    envelope: ctx.envelope.has(pname),
    internal: ctx.internal.has(pname),
    pii: pii === true,
  };
}

/** Parse an already-decoded JSON value. Never throws. */
export function parseDictionary(input: unknown): ParseResult {
  try {
    return { ok: true, dictionary: build(input) };
  } catch (e) {
    return { ok: false, error: e instanceof Refused ? e.message : 'The dictionary could not be read.' };
  }
}

/** Parse the response body. The size limit is enforced here too, for callers that already hold the text. */
export function parseDictionaryText(text: string): ParseResult {
  if (text.length > LIMITS.bytes) return { ok: false, error: `The dictionary is larger than ${LIMITS.bytes / 1_000_000} MB.` };
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { ok: false, error: 'The dictionary is not valid JSON.' }; }
  return parseDictionary(json);
}

function build(input: unknown): Dictionary {
  if (!isRecord(input)) return refuse('The document is not a dictionary object.');
  keysOf(input, 'dictionary');
  const entitiesRaw = get(input, 'entities');
  if (!isRecord(entitiesRaw)) return refuse('The document has no "entities" object, so it is not a DDv2 dictionary.');

  const notes: string[] = [];
  const required = stringList(get(input, 'required'), 'required', (s) => NAME.test(s));
  const gcRaw = get(input, 'graphContract');
  if (gcRaw !== undefined && !isRecord(gcRaw)) refuse('graphContract: must be an object');
  const gc = (gcRaw ?? {}) as Record<string, unknown>;
  if (gcRaw !== undefined) keysOf(gc, 'graphContract');
  const envelopeKeys = stringList(get(gc, 'envelopeKeys'), 'graphContract.envelopeKeys', (s) => NAME.test(s));
  const internalKeys = stringList(get(gc, 'internalKeys'), 'graphContract.internalKeys', (s) => NAME.test(s));
  const ctx = { required: new Set(required), envelope: new Set(envelopeKeys), internal: new Set(internalKeys) };

  // labels: { Label: [entity] }
  const labelsRaw = get(gc, 'labels');
  const entityNames = keysOf(entitiesRaw, 'entities');
  if (entityNames.length > LIMITS.entities) refuse(`More than ${LIMITS.entities} entities.`);
  const known = new Set(entityNames);
  const labels: Label[] = [];
  const labelsOf = new Map<string, string[]>();
  if (labelsRaw !== undefined) {
    if (!isRecord(labelsRaw)) refuse('graphContract.labels: must be an object');
    const lr = labelsRaw as Record<string, unknown>;
    const labelNames = keysOf(lr, 'graphContract.labels');
    if (labelNames.length > LIMITS.labels) refuse(`More than ${LIMITS.labels} labels.`);
    let unknownRefs = 0;
    let respelled = 0;
    for (const ln of labelNames) {
      name(ln, 'graphContract.labels');
      const ents = stringList(lr[ln], `graphContract.labels.${cleanText(ln, 40)}`, (s) => NAME.test(s));
      const kept: string[] = [];
      for (const ref of ents) {
        // The contract may spell an entity camelCase (httpActivity) where the dictionary keys it snake_case (http_activity).
        // That is the only respelling tried; anything else that does not match exactly is unknown.
        const hit = known.has(ref) ? ref : known.has(snakeCase(ref)) ? snakeCase(ref) : null;
        if (hit === null) unknownRefs += 1;
        else if (!kept.includes(hit)) { kept.push(hit); if (hit !== ref) respelled += 1; }
      }
      labels.push({ name: ln, entities: kept });
      for (const e of kept) labelsOf.set(e, [...(labelsOf.get(e) ?? []), ln]);
    }
    if (respelled) notes.push(`${respelled} label-to-entity reference(s) spell the entity in camelCase while the dictionary keys it in snake_case; they were matched by that spelling.`);
    if (unknownRefs) notes.push(`${unknownRefs} label-to-entity reference(s) name an entity the dictionary does not define; they were ignored.`);
  }
  const labelSet = new Set(labels.map((l) => l.name));

  // edges
  const edgesRaw = get(gc, 'edges');
  const edges: Edge[] = [];
  if (edgesRaw !== undefined) {
    if (!Array.isArray(edgesRaw) || edgesRaw.length > LIMITS.edges) refuse('graphContract.edges: must be a list of at most 5000');
    for (const e of edgesRaw as unknown[]) {
      if (!isRecord(e)) return refuse('graphContract.edges: each edge must be an object');
      const r = e as Record<string, unknown>;
      const type = get(r, 'type');
      if (typeof type !== 'string' || type.length > LIMITS.name || !EDGE_TYPE.test(type)) return refuse('graphContract.edges: invalid edge type');
      const from = name(get(r, 'from'), 'graphContract.edges.from');
      const to = name(get(r, 'to'), 'graphContract.edges.to');
      edges.push({ type, from, to, relation: textOf(r, 'relation', LIMITS.short, 'graphContract.edges'), dangling: !labelSet.has(from) || !labelSet.has(to) });
    }
    const dangling = edges.filter((e) => e.dangling).length;
    if (dangling) notes.push(`${dangling} edge type(s) name a label the dictionary does not declare; they are listed but not drawn.`);
  }

  // open edge families
  const famRaw = get(gc, 'edgeFamilies');
  const families: Family[] = [];
  if (famRaw !== undefined) {
    if (!Array.isArray(famRaw) || famRaw.length > LIMITS.families) refuse('graphContract.edgeFamilies: must be a list of at most 200');
    for (const f of famRaw as unknown[]) {
      if (!isRecord(f)) return refuse('graphContract.edgeFamilies: each family must be an object');
      const r = f as Record<string, unknown>;
      const fname = name(get(r, 'name'), 'graphContract.edgeFamilies.name');
      const pattern = get(r, 'pattern');
      if (typeof pattern !== 'string') return refuse('graphContract.edgeFamilies: "pattern" must be text');
      families.push({
        name: fname,
        pattern: cleanText(pattern, 200),
        from: stringList(get(r, 'from'), 'graphContract.edgeFamilies.from', (s) => NAME.test(s)),
        to: stringList(get(r, 'to'), 'graphContract.edgeFamilies.to', (s) => NAME.test(s)),
        relation: textOf(r, 'relation', LIMITS.short, 'graphContract.edgeFamilies'),
        note: textOf(r, 'note', LIMITS.text, 'graphContract.edgeFamilies'),
      });
    }
  }

  // entities
  let total = 0;
  const entities: Entity[] = [];
  for (const en of entityNames) {
    name(en, 'entities');
    const raw = entitiesRaw[en];
    if (!isRecord(raw)) return refuse(`Entity ${cleanText(en, 40)}: must be an object`);
    const eo = raw as Record<string, unknown>;
    const propsRaw = get(eo, 'properties');
    if (!isRecord(propsRaw)) return refuse(`Entity ${cleanText(en, 40)}: has no "properties" object`);
    const pn = keysOf(propsRaw as Record<string, unknown>, `entity ${cleanText(en, 40)}`);
    if (pn.length > LIMITS.propertiesPerEntity) refuse(`Entity ${cleanText(en, 40)}: more than ${LIMITS.propertiesPerEntity} properties.`);
    total += pn.length;
    if (total > LIMITS.totalProperties) refuse(`More than ${LIMITS.totalProperties} properties in all.`);
    const where = `entity ${cleanText(en, 40)}`;
    const properties = pn.map((p) => property(name(p, where), (propsRaw as Record<string, unknown>)[p], ctx, `${where}.${cleanText(p, 40)}`));
    const category = textOf(eo, 'category', 64, where);
    entities.push({ name: en, category: category || null, description: textOf(eo, 'description', LIMITS.text, where), properties, labels: labelsOf.get(en) ?? [] });
  }
  entities.sort((a, b) => a.name.localeCompare(b.name));

  return {
    version: cleanText(typeof get(input, 'version') === 'string' ? (get(input, 'version') as string) : '', LIMITS.short),
    schema: cleanText(typeof get(input, 'schema') === 'string' ? (get(input, 'schema') as string) : '', LIMITS.short),
    required,
    envelopeKeys,
    internalKeys,
    entities,
    labels,
    edges,
    families,
    hasContract: gcRaw !== undefined,
    propertyCount: total,
    notes,
  };
}

interface VocabNode { id: string; label: 'Graph label' | 'Open edge family'; properties?: { name: string } }
interface VocabEdge { src_id: string; dst_id: string; edge_type: string }
export interface VocabGraph { nodes: VocabNode[]; edges: VocabEdge[]; /** Edge types that are open (drawn dashed). */ open: Set<string> }
interface VocabularyModel {
  /** Labels joined by declared edge types, plus open families whose members are all in that graph. */
  declared: VocabGraph;
  /** Labels with no declared edge that are related only through an open edge family, with that family's hub. */
  openOnly: { family: Family; graph: VocabGraph }[];
  /** Labels in no declared edge and no open family. */
  isolated: string[];
}

/**
 * What the graph contract says about how labels relate, split three ways. Nothing is invented: an edge is drawn only
 * where the contract declares one, and an open family is drawn as a hub (diamond, dashed lines) rather than one arrow
 * per pair of member labels. A family whose two ends are one label each is drawn as a single dashed edge.
 */
export function vocabularyModel(d: Dictionary): VocabularyModel {
  const declaredEdges = d.edges.filter((e) => !e.dangling);
  const inDeclared = new Set(declaredEdges.flatMap((e) => [e.from, e.to]));
  const labelNode = (id: string): VocabNode => ({ id, label: 'Graph label' });
  const hubOf = (f: Family): VocabNode => ({ id: `open:${f.name}`, label: 'Open edge family', properties: { name: `${f.name} (open)` } });
  const labelSet = new Set(d.labels.map((l) => l.name));
  const familyGraph = (f: Family, open: Set<string>): { hub: VocabNode | null; edges: VocabEdge[]; members: string[] } => {
    const from = f.from.filter((l) => labelSet.has(l));
    const to = f.to.filter((l) => labelSet.has(l));
    const type = `${f.name} (open)`;
    open.add(type);
    const members = [...new Set([...from, ...to])];
    if (from.length === 1 && to.length === 1) return { hub: null, members, edges: [{ src_id: from[0]!, dst_id: to[0]!, edge_type: type }] };
    const hub = hubOf(f);
    const same = from.length === to.length && from.every((l) => to.includes(l));
    const edges = same
      ? members.map((m) => ({ src_id: m, dst_id: hub.id, edge_type: type }))
      : [...from.map((m) => ({ src_id: m, dst_id: hub.id, edge_type: type })), ...to.map((m) => ({ src_id: hub.id, dst_id: m, edge_type: type }))];
    return { hub, members, edges };
  };

  const declared: VocabGraph = { nodes: [], edges: declaredEdges.map((e) => ({ src_id: e.from, dst_id: e.to, edge_type: e.type })), open: new Set() };
  const openOnly: VocabularyModel['openOnly'] = [];
  const inFamily = new Set<string>();
  for (const f of d.families) {
    const g = familyGraph(f, new Set());
    for (const m of g.members) inFamily.add(m);
    if (g.members.length === 0) continue;
    if (g.members.every((m) => inDeclared.has(m))) {
      const o = familyGraph(f, declared.open);
      declared.edges.push(...o.edges);
      if (o.hub) declared.nodes.push(o.hub);
    } else {
      const open = new Set<string>();
      const o = familyGraph(f, open);
      openOnly.push({ family: f, graph: { nodes: [...(o.hub ? [o.hub] : []), ...o.members.map(labelNode)], edges: o.edges, open } });
    }
  }
  declared.nodes.push(...[...inDeclared].map(labelNode));
  const isolated = d.labels.map((l) => l.name).filter((l) => !inDeclared.has(l) && !inFamily.has(l));
  return { declared, openOnly, isolated };
}

/** Entities grouped by their own `category` when the dictionary gives one; otherwise by whether a graph label carries them. */
export function groupEntities(d: Dictionary): { title: string; entities: Entity[] }[] {
  const byCategory = d.entities.some((e) => e.category);
  const buckets = new Map<string, Entity[]>();
  for (const e of d.entities) {
    const key = byCategory ? (e.category ?? 'Uncategorised') : d.hasContract ? (e.labels.length ? 'Carried by graph labels' : 'Not carried by any graph label') : 'Entities';
    buckets.set(key, [...(buckets.get(key) ?? []), e]);
  }
  return [...buckets.entries()].map(([title, entities]) => ({ title, entities }));
}

/** Case-insensitive substring search over entity names and descriptions, property names and descriptions, and labels. */
export function searchEntities(d: Dictionary, query: string): { entity: Entity; properties: string[] }[] {
  const q = cleanText(query, 100).toLowerCase();
  if (!q) return d.entities.map((entity) => ({ entity, properties: [] }));
  const out: { entity: Entity; properties: string[] }[] = [];
  for (const entity of d.entities) {
    const props = entity.properties.filter((p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)).map((p) => p.name);
    const own = entity.name.toLowerCase().includes(q) || entity.description.toLowerCase().includes(q) || entity.labels.some((l) => l.toLowerCase().includes(q));
    if (own || props.length) out.push({ entity, properties: own ? [] : props });
  }
  return out;
}
