/**
 * Every server-side call from the portal to a backend (siem-service, TES, Dagu) goes through callUpstream, so the same
 * limits hold everywhere: a deadline, no redirects (the request carries a credential), a hard cap on the body, and no
 * upstream detail in the result. Callers turn a result into their own public message.
 */

/** Read a response body with a hard byte limit (does not trust content-length, which may be absent or wrong). */
export async function readCapped(r: Response, maxBytes: number): Promise<string | null> {
  if (Number(r.headers.get('content-length') ?? 0) > maxBytes) return null;
  if (!r.body) return '';
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.byteLength; }
  return new TextDecoder().decode(buf);
}

type UpstreamResult =
  | { kind: 'ok'; status: number; payload: unknown }
  /** The service answered with a non-2xx status. `payload` is its JSON body, or null. Callers must not forward it unfiltered. */
  | { kind: 'rejected'; status: number; payload: unknown }
  | { kind: 'too-large' | 'unreadable' | 'timeout' | 'unreachable' };

export async function callUpstream(url: string, init: Omit<RequestInit, 'redirect' | 'signal'>, limits: { timeoutMs: number; maxBytes: number }): Promise<UpstreamResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), limits.timeoutMs);
  try {
    const r = await fetch(url, { ...init, redirect: 'error', signal: ctrl.signal });
    const text = await readCapped(r, limits.maxBytes);
    if (text === null) return { kind: 'too-large' };
    let payload: unknown = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    if (!r.ok) return { kind: 'rejected', status: r.status, payload };
    if (payload === null && text) return { kind: 'unreadable' };
    return { kind: 'ok', status: r.status, payload: payload ?? {} };
  } catch (e) {
    return { kind: (e as Error)?.name === 'AbortError' ? 'timeout' : 'unreachable' };
  } finally { clearTimeout(timer); }
}
