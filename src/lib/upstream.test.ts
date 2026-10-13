import { afterEach, describe, expect, it, vi } from 'vitest';
import { callUpstream, readCapped } from './upstream';

const limits = { timeoutMs: 1000, maxBytes: 100 };
const stub = (impl: (url: string, init: RequestInit) => Promise<Response>) => vi.stubGlobal('fetch', vi.fn(impl));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('callUpstream', () => {
  it('returns the JSON payload of a 2xx answer', async () => {
    stub(async () => new Response('{"a":1}', { status: 201 }));
    expect(await callUpstream('http://x/y', {}, limits)).toEqual({ kind: 'ok', status: 201, payload: { a: 1 } });
  });
  it('treats an empty 2xx body as an empty object', async () => {
    stub(async () => new Response('', { status: 200 }));
    expect(await callUpstream('http://x/y', {}, limits)).toEqual({ kind: 'ok', status: 200, payload: {} });
  });
  it('reports a non-2xx answer with its status and parsed body, never as ok', async () => {
    stub(async () => new Response('{"error":"nope"}', { status: 409 }));
    expect(await callUpstream('http://x/y', {}, limits)).toEqual({ kind: 'rejected', status: 409, payload: { error: 'nope' } });
  });
  it('refuses a body over the cap, with or without a content-length', async () => {
    stub(async () => new Response('x'.repeat(101), { status: 200 }));
    expect(await callUpstream('http://x/y', {}, limits)).toEqual({ kind: 'too-large' });
    stub(async () => new Response('{}', { status: 200, headers: { 'content-length': '5000' } }));
    expect(await callUpstream('http://x/y', {}, limits)).toEqual({ kind: 'too-large' });
  });
  it('refuses a 2xx body that is not JSON', async () => {
    stub(async () => new Response('<html>', { status: 200 }));
    expect(await callUpstream('http://x/y', {}, limits)).toEqual({ kind: 'unreadable' });
  });
  it('never follows a redirect and ignores a caller-supplied redirect or signal', async () => {
    const seen: RequestInit[] = [];
    stub(async (_u, init) => { seen.push(init); return new Response('{}'); });
    await callUpstream('http://x/y', { method: 'POST', redirect: 'follow', signal: new AbortController().signal } as RequestInit, limits);
    expect(seen[0]?.redirect).toBe('error');
    expect(seen[0]?.method).toBe('POST');
  });
  it('aborts the request at the deadline', async () => {
    vi.useFakeTimers();
    stub((_u, init) => new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
    const pending = callUpstream('http://x/y', {}, limits);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await pending).toEqual({ kind: 'timeout' });
  });
  it('reports a network failure without its message', async () => {
    stub(async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:8000'); });
    expect(await callUpstream('http://x/y', {}, limits)).toEqual({ kind: 'unreachable' });
  });
});

describe('readCapped', () => {
  it('stops at the byte limit even without content-length', async () => {
    const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(1024).fill(97)); } });
    expect(await readCapped(new Response(stream), 10 * 1024)).toBeNull();
    expect(await readCapped(new Response('hello'), 10)).toBe('hello');
    expect(await readCapped(new Response('x'.repeat(50), { headers: { 'content-length': '999999' } }), 10)).toBeNull();
  });
});
