import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_DICTIONARY as sample } from './sample';
import { LIMITS } from './ddv2';
import { LoadError, dictionaryUrl, fetchDictionary } from './load';

const signal = () => new AbortController().signal;
const stub = (impl: (url: string, init: RequestInit) => Promise<Response>) => vi.stubGlobal('fetch', vi.fn(impl));
const json = (body: unknown, init: ResponseInit = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init });
const message = async (p: Promise<unknown>) => { try { await p; } catch (e) { expect(e).toBeInstanceOf(LoadError); return (e as Error).message; } throw new Error('did not fail'); };

afterEach(() => vi.unstubAllGlobals());

describe('fetchDictionary', () => {
  it('reads the submission API dictionary URL, with the session cookie, and parses DDv2', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    stub(async (url, init) => { seen = { url, init }; return json(sample); });
    const d = await fetchDictionary(signal());
    expect(d.entities).toHaveLength(8);
    expect(seen!.url).toBe(dictionaryUrl());
    expect(dictionaryUrl()).toMatch(/\/api\/v0\/submission\/_dictionary\/_all\/$/);
    expect(seen!.init.credentials).toBe('include');
    expect(seen!.init.method).toBeUndefined(); // a plain GET
  });
  it('says so when nothing is published, and when the service errors', async () => {
    stub(async () => new Response('', { status: 404 }));
    expect(await message(fetchDictionary(signal()))).toMatch(/No dictionary has been published/);
    stub(async () => new Response('secret stack trace', { status: 502 }));
    const m = await message(fetchDictionary(signal()));
    expect(m).toMatch(/502/);
    expect(m).not.toMatch(/secret/); // the body of an error is never shown
  });
  it('says so when the service cannot be reached, and when the request is cancelled', async () => {
    stub(async () => { throw new TypeError('Failed to fetch'); });
    expect(await message(fetchDictionary(signal()))).toMatch(/could not be reached/);
    const ctl = new AbortController();
    stub(async () => { ctl.abort(); throw new DOMException('aborted', 'AbortError'); });
    expect(await message(fetchDictionary(ctl.signal))).toMatch(/cancelled or timed out/);
  });
  it('refuses a body that declares itself too large, without reading it', async () => {
    const res = json('{}', { headers: { 'content-length': String(LIMITS.bytes + 1) } });
    const text = vi.spyOn(res, 'text');
    stub(async () => res);
    expect(await message(fetchDictionary(signal()))).toMatch(/larger/);
    expect(text).not.toHaveBeenCalled();
  });
  it('stops reading a stream that grows past the limit even when it does not declare a length', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({ pull(c) { pulled += 1; c.enqueue(new Uint8Array(500_000).fill(32)); if (pulled > 100) c.close(); } });
    stub(async () => new Response(body, { status: 200 }));
    expect(await message(fetchDictionary(signal()))).toMatch(/larger/);
    expect(pulled).toBeLessThan(10);
  });
  it('refuses JSON that is not a dictionary and text that is not JSON', async () => {
    stub(async () => json({ hello: 'world' }));
    expect(await message(fetchDictionary(signal()))).toMatch(/not a DDv2 dictionary/);
    stub(async () => json('<html>login</html>'));
    expect(await message(fetchDictionary(signal()))).toMatch(/not valid JSON/);
  });
  it('decodes invalid UTF-8 without throwing', async () => {
    stub(async () => new Response(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]), { status: 200 }));
    expect(await message(fetchDictionary(signal()))).toMatch(/not valid JSON/);
  });
});
