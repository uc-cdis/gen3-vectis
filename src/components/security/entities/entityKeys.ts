import type { EntitySeed, EntityType, GraphNode } from '@/lib/vectis-kit/spec';
import { MAX_VALUE_LENGTH, isIpAddress, matchesIocType, parseStixLookup } from '@/lib/vectis-kit/spec/indicator';
import { hasControlChars } from '@/lib/safe-text';

export const ENTITY_TYPES: readonly EntityType[] = ['ip', 'domain', 'url', 'hash', 'email', 'path', 'host', 'user', 'session', 'arn'];
/** What the search box accepts: an entity type, or a STIX pattern naming one. */
export const ENTITY_INPUT_TYPES: readonly string[] = [...ENTITY_TYPES, 'stix'];
export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  ip: 'IP address', domain: 'Domain', url: 'URL', hash: 'File hash', email: 'Email address', path: 'URI path',
  host: 'Host', user: 'User', session: 'Session', arn: 'AWS ARN',
};
export const ENTITY_INPUT_LABEL: Record<string, string> = { ...ENTITY_TYPE_LABEL, stix: 'STIX pattern' };
/** Validate what a person typed into the entity search. Returns an error message, or null when it is acceptable. */
export function validateEntityInput(type: string, rawValue: string): { error: string } | { seed: EntitySeed } {
  if (!ENTITY_INPUT_TYPES.includes(type)) return { error: 'Choose a type.' };
  const value = rawValue.trim();
  if (value === '') return { error: 'Enter a value to look up.' };
  if (value.length > MAX_VALUE_LENGTH) return { error: `Too long: ${value.length} characters (maximum ${MAX_VALUE_LENGTH}).` };
  if (hasControlChars(value)) return { error: 'The value contains control characters.' };
  if (type === 'stix') {
    const parsed = parseStixLookup(value);
    if ('error' in parsed) return parsed;
    return validateEntityInput(parsed.type, parsed.value);
  }
  if (type === 'ip' && !isIpAddress(value)) return { error: 'That is not a valid IPv4 or IPv6 address.' };
  if (type === 'path' && !matchesIocType('path', value)) return { error: 'A URI path starts with / and has no query string.' };
  return { seed: { type: type as EntityType, value } };
}

/**
 * Graph labels per entity type, used ONLY to turn a clicked graph node back into an entity to open. Only `IpAddress`
 * is confirmed (it is the label in the contract fixture); the rest follow the same naming. A wrong guess here is
 * harmless: the entity drawer simply finds nothing. The graph START id is never guessed: the profile carries it.
 */
const GRAPH_LABEL_BY_TYPE: Record<EntityType, string> = {
  ip: 'IpAddress', domain: 'Domain', url: 'Url', hash: 'FileHash', email: 'EmailAddress', path: 'UriPath',
  host: 'Host', user: 'User', session: 'Session', arn: 'Arn',
};
const TYPE_BY_GRAPH_LABEL = new Map<string, EntityType>(Object.entries(GRAPH_LABEL_BY_TYPE).map(([t, l]) => [l, t as EntityType]));

// eslint-disable-next-line no-control-regex
const NODE_ID = /^[^\x00-\x20\x7f]{1,256}$/; // contract.py NodeId

/** The profile's graph node id if it is a legal NodeId (contract.py), else null. Never constructed from parts. */
export function validNodeId(id: string | null | undefined): string | null {
  return id && NODE_ID.test(id) ? id : null;
}

/** The reverse: which entity does a graph node stand for, if it is one of the entity labels. */
export function seedFromGraphNode(node: GraphNode): EntitySeed | null {
  const type = TYPE_BY_GRAPH_LABEL.get(node.label);
  if (!type) return null;
  const parts = node.id.split(':');
  if (parts.length < 3 || parts[1] !== node.label) return null;
  const value = parts.slice(2).join(':');
  return value && value.length <= MAX_VALUE_LENGTH ? { type, value } : null;
}
