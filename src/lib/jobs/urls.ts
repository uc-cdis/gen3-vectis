/** URL rules shared by param validation and task validation. */
const S3_KEY = /^[A-Za-z0-9._\-/=+,@:~]*$/;
const BUCKET = /^[A-Za-z0-9][A-Za-z0-9.-]{1,61}[A-Za-z0-9]$/;
const DOTDOT = /(^|\/)\.\.(\/|$)/;

/** s3:// or gs:// bucket URL. `keyRequired` demands a non-empty key. */
function isObjectUrl(u: unknown, keyRequired = false, schemes: readonly string[] = ['s3']): boolean {
  if (typeof u !== 'string' || u.length > 2048) return false;
  const m = /^([a-z0-9]+):\/\/([^/]*)\/?(.*)$/.exec(u);
  if (!m || !schemes.includes(m[1])) return false;
  const [, , bucket, key] = m;
  if (!BUCKET.test(bucket) || bucket.includes('..')) return false;
  if (!S3_KEY.test(key) || DOTDOT.test(key) || key.length > 1024) return false;
  if (keyRequired && key.length === 0) return false;
  return true;
}
export const isS3Url = (u: unknown, keyRequired = true): boolean => isObjectUrl(u, keyRequired, ['s3']);

const DENY_SUFFIX = /\.(internal|local|localhost|localdomain|svc|cluster\.local|home\.arpa|lan|corp)$/;
const hostMatches = (host: string, list: string[]): boolean =>
  list.some((p) => (p.startsWith('*.') ? host.endsWith(p.slice(1)) && host.length > p.length - 1 : host === p));
/** Parsed TES_ALLOWED_URL_HOSTS (exact hosts or *.suffix), or null when unset. When set it is the ONLY accepted set. */
function allowedUrlHosts(env: Record<string, string | undefined> = process.env): string[] | null {
  const l = (env.TES_ALLOWED_URL_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean);
  return l.length ? l : null;
}

/**
 * https only; no credentials, no IP literal, no single-label or internal-looking name, no whitespace or control characters.
 * A denylist is INCOMPLETE (public DNS can point anywhere): set TES_ALLOWED_URL_HOSTS and enforce egress controls on the workers.
 */
export function isHttpsUrl(u: unknown, env: Record<string, string | undefined> = process.env): boolean {
  // eslint-disable-next-line no-control-regex
  if (typeof u !== 'string' || u.length === 0 || u.length > 2048 || /[\u0000-\u0020\u007f-\u009f\\]/.test(u)) return false;
  if (!u.startsWith('https://')) return false;
  let url: URL;
  try { url = new URL(u); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const h = url.hostname.toLowerCase().replace(/\.$/, ''); // "localhost." is localhost
  if (!h || h.endsWith('.') || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(h) || h.includes('..')) return false;
  const labels = h.split('.');
  if (labels.length < 2 || h === 'localhost' || DENY_SUFFIX.test(h)) return false;
  if (labels.some((l) => /^(0x[0-9a-f]*|[0-9]+)$/.test(l))) return false; // numeric-looking labels: IPs, nip.io style tricks
  const allow = allowedUrlHosts(env);
  return allow ? hostMatches(h, allow) : true;
}

/** Any URL a task may carry: s3 or https (https further limited by TES_ALLOWED_URL_HOSTS when set). */
export const isTaskUrl = (u: unknown): boolean => isObjectUrl(u, false, ['s3']) || isHttpsUrl(u);
export const URL_SAFE_SEGMENT = /^[A-Za-z0-9._\-/=+,@:~]*$/;
export const hasDotDot = (s: string): boolean => DOTDOT.test(s);
