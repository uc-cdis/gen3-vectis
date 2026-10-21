/**
 * What an indicator or entity value looks like. One definition for the whole console: the watchlist forms, the entity
 * search, link rendering and the "why" panel all ask these functions, so they cannot disagree. Limits mirror the backend
 * contract (value 1..512, no control characters); the server re-validates, this only gives an early, specific message.
 */
import { hasControlChars } from '@/lib/safe-text';
import type { EntityType } from './index';

export const IOC_TYPES = ['ip', 'domain', 'url', 'hash', 'email', 'path', 'stix'] as const;
export type IocType = (typeof IOC_TYPES)[number];
export const IOC_LABEL: Record<IocType, string> = {
  ip: 'IP address', domain: 'Domain', url: 'URL', hash: 'File hash', email: 'Email address', path: 'URI path', stix: 'STIX pattern',
};
export const isIocType = (t: string): t is IocType => (IOC_TYPES as readonly string[]).includes(t);

export const MAX_VALUE_LENGTH = 512;


const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_CHARS = /^[0-9a-f:.]{2,45}$/i;
const DOMAIN = /^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const EMAIL = /^[^\s@]{1,64}@([A-Za-z0-9-]+\.)+[A-Za-z]{2,63}$/;
const HASH = /^[A-Fa-f0-9]{32,128}$/;
const URI_PATH = /^\/[\x21-\x7e]{0,511}$/;
const STIX_PATTERN = /^\[[a-z0-9-]+:[\x20-\x7e]+\]$/;

/** A literal IPv4 or IPv6 address. Masked values ("203.0.xxx.xxx") and names are not addresses. */
export function isIpAddress(v: string): boolean {
  if (IPV4.test(v)) return true;
  if (!v.includes(':') || !IPV6_CHARS.test(v)) return false;
  try { new URL(`http://[${v}]/`); return true; } catch { return false; } // the URL parser is a complete IPv6 grammar
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** True when `v` is well formed as an indicator of the given type. */
export const matchesIocType = (type: IocType, v: string): boolean => {
  switch (type) {
    case 'ip': return isIpAddress(v);
    case 'domain': return DOMAIN.test(v);
    case 'url': return isHttpUrl(v);
    case 'hash': return HASH.test(v);
    case 'path': return URI_PATH.test(v) && !/[?#]/.test(v);
    case 'stix': return STIX_PATTERN.test(v);   // the service parses it; this only catches what is plainly not a pattern
    default: return EMAIL.test(v);
  }
};

/** Best-effort type for an indicator string. Returns null rather than guessing when it is not recognisable. */
export function classifyIndicator(raw: string): IocType | null {
  const v = raw.trim();
  if (v === '' || v.length > MAX_VALUE_LENGTH || hasControlChars(v)) return null;
  return IOC_TYPES.find((t) => matchesIocType(t, v)) ?? null;   // a pattern and a path cannot look like the other types
}

/** Type for display only (so a bare value can be shown as a link); unrecognisable values are shown as domains. */
/** The entity type an indicator type stands for; a STIX pattern is a way of writing values, not an entity. */
export const entityTypeOf = (t: IocType | null | undefined): EntityType | null => (t == null || t === 'stix' ? null : t);

export const guessEntityType = (v: string): EntityType => entityTypeOf(classifyIndicator(v)) ?? 'domain';

const STIX_OBSERVABLE: Record<string, EntityType> = {
  'ipv4-addr:value': 'ip', 'ipv6-addr:value': 'ip', 'domain-name:value': 'domain', 'url:value': 'url',
  'email-addr:value': 'email', 'x-http-request:uri_path': 'path',
};
const STIX_COMPARISON = /^\[\s*([a-z0-9-]+):([A-Za-z0-9_.'-]+)\s*=\s*'([^'\\\x00-\x1f]+)'\s*\]$/;

/** One simple STIX comparison as the entity it names, for looking it up. The service accepts more (comparisons joined by OR). */
export function parseStixLookup(raw: string): { type: EntityType; value: string } | { error: string } {
  const m = STIX_COMPARISON.exec(raw.trim());
  if (!m) return { error: "Give one comparison in brackets, like [domain-name:value = 'example.com']." };
  const [, object, property, value] = m as unknown as [string, string, string, string];
  const type = object === 'file' && /^hashes\.(?:'(?:MD5|SHA-1|SHA-256)'|MD5|SHA1|SHA256)$/.test(property) ? 'hash' : STIX_OBSERVABLE[`${object}:${property}`];
  return type ? { type, value } : { error: `${object}:${property} is not an observable that can be looked up.` };
}
