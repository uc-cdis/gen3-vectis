/**
 * What an indicator or entity value looks like. One definition for the whole console: the watchlist forms, the entity
 * search, link rendering and the "why" panel all ask these functions, so they cannot disagree. Limits mirror the backend
 * contract (value 1..512, no control characters); the server re-validates, this only gives an early, specific message.
 */
import { hasControlChars } from '@/lib/safe-text';
import type { EntityType } from './index';

export const IOC_TYPES = ['ip', 'domain', 'url', 'hash', 'email'] as const;
export type IocType = (typeof IOC_TYPES)[number];
export const isIocType = (t: string): t is IocType => (IOC_TYPES as readonly string[]).includes(t);

export const MAX_VALUE_LENGTH = 512;


const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_CHARS = /^[0-9a-f:.]{2,45}$/i;
const DOMAIN = /^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const EMAIL = /^[^\s@]{1,64}@([A-Za-z0-9-]+\.)+[A-Za-z]{2,63}$/;
const HASH = /^[A-Fa-f0-9]{32,128}$/;

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
export const matchesIocType = (type: IocType, v: string): boolean =>
  type === 'ip' ? isIpAddress(v) : type === 'domain' ? DOMAIN.test(v) : type === 'url' ? isHttpUrl(v) : type === 'hash' ? HASH.test(v) : EMAIL.test(v);

/** Best-effort type for an indicator string. Returns null rather than guessing when it is not recognisable. */
export function classifyIndicator(raw: string): IocType | null {
  const v = raw.trim();
  if (v === '' || v.length > MAX_VALUE_LENGTH || hasControlChars(v)) return null;
  return IOC_TYPES.find((t) => matchesIocType(t, v)) ?? null;
}

/** Type for display only (so a bare value can be shown as a link); unrecognisable values are shown as domains. */
export const guessEntityType = (v: string): EntityType => classifyIndicator(v) ?? 'domain';
