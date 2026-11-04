/**
 * "Who was on this machine?" for an event that carries only a machine: a role session named after a jump host (its session name
 * is the instance id, so the event says the machine acted and not which person). The person is whoever had a Session Manager
 * session open on that machine at that moment, so the link opens the session summaries for the machine in a window that ends at
 * the event. A machine's address and its transcripts' host name are the same fact: ip-10-128-4-44 is 10.128.4.44.
 */
import type { FilterClause } from '@/lib/vectis-kit/spec';
import { parseRange, writeDeepLink } from '../hunt/huntModel';

/** A session still open at the event began before it: how far back to look. A session longer than this is not found. */
export const LOOK_BACK_HOURS = 12;
const PRIVATE_V4 = /^(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;
const OCTETS = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** The host name Linux gives a machine from its address (what a session's prompt shows), or null for anything but a private IPv4. */
export function hostNameForAddress(address: unknown): string | null {
  if (typeof address !== 'string' || !PRIVATE_V4.test(address)) return null;
  const m = OCTETS.exec(address);
  if (!m || m.slice(1).some((o) => Number(o) > 255)) return null;
  return `ip-${m.slice(1).map(Number).join('-')}`;
}

/** The query that opens the Data tab on the sessions that were on this event's machine, or null when the row names no private machine or time. */
export function machineSessionsLink(row: Record<string, unknown>): Record<string, string> | null {
  const host = hostNameForAddress(row.src_ip);
  const when = typeof row.event_time === 'string' ? Date.parse(row.event_time) : NaN;
  if (!host || !Number.isFinite(when)) return null;
  const range = parseRange(new Date(when - LOOK_BACK_HOURS * 3_600_000).toISOString(), new Date(when + 60_000).toISOString());
  if (!range) return null;
  const filters: FilterClause[] = [
    { field: 'activity', op: 'eq', value: 'ssm_session' },
    { field: 'hostname', op: 'eq', value: host },
  ];
  return writeDeepLink({}, { index: 'process_activity', range, filters });
}
