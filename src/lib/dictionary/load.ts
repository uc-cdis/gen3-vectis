import { useApiQuery } from '@/lib/api-query';
import { GEN3_SUBMISSION_API } from '@gen3/core';
import type { Dictionary } from './ddv2';
import { LIMITS, parseDictionaryText } from './ddv2';

/**
 * The one URL the dictionary is served from: the commons' existing `lambda-dictionary.conf` rule, which proxies the
 * published DDv2 object. The portal holds no AWS credentials and never reads S3; it reads this URL and nothing else.
 */
export const dictionaryUrl = (): string => `${GEN3_SUBMISSION_API}/_dictionary/_all/`;

export type DictionaryState =
  | { status: 'loading' }
  | { status: 'ready'; dictionary: Dictionary }
  | { status: 'error'; message: string };

export type DictionaryLoader = (signal: AbortSignal) => Promise<Dictionary>;

export class LoadError extends Error {}

/** Read at most LIMITS.bytes of the response body; anything larger is refused rather than buffered. */
async function readBounded(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > LIMITS.bytes) throw new LoadError('The dictionary is larger than the portal will read.');
  if (!res.body) {
    const t = await res.text();
    if (t.length > LIMITS.bytes) throw new LoadError('The dictionary is larger than the portal will read.');
    return t;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMITS.bytes) {
      await reader.cancel().catch(() => undefined);
      throw new LoadError('The dictionary is larger than the portal will read.');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder('utf-8', { fatal: false }).decode(all);
}

/** Fetch and parse the dictionary. Throws LoadError with a message that is safe to show. */
export const fetchDictionary: DictionaryLoader = async (signal) => {
  let res: Response;
  try {
    res = await fetch(dictionaryUrl(), { credentials: 'include', headers: { Accept: 'application/json' }, signal });
  } catch {
    if (signal.aborted) throw new LoadError('Loading the dictionary was cancelled or timed out.');
    throw new LoadError('The dictionary could not be reached.');
  }
  if (!res.ok) throw new LoadError(res.status === 404 ? 'No dictionary has been published yet.' : `The dictionary service answered with an error (${res.status}).`);
  const parsed = parseDictionaryText(await readBounded(res));
  if (!parsed.ok) throw new LoadError(parsed.error);
  return parsed.dictionary;
};

const TIMEOUT_MS = 20_000;

// The cache key includes the loader, so the page and the workspace drawer share one request and one cache entry.
const loaderIds = new WeakMap<DictionaryLoader, number>();
let lastLoaderId = 0;
const loaderId = (l: DictionaryLoader): number => {
  const known = loaderIds.get(l);
  if (known !== undefined) return known;
  lastLoaderId += 1;
  loaderIds.set(l, lastLoaderId);
  return lastLoaderId;
};

/** Loads the dictionary through the shared query core, with a timeout, and offers a retry. `loader` is injectable for tests and dev pages. */
export function useDictionary(loader: DictionaryLoader = fetchDictionary): DictionaryState & { retry: () => void } {
  const q = useApiQuery<Dictionary, LoadError>({
    mode: 'live',
    scope: 'dictionary',
    name: 'all',
    key: [loaderId(loader)],
    fetcher: () => loader(AbortSignal.timeout(TIMEOUT_MS)),
    toError: (e) => (e instanceof LoadError ? e : new LoadError('The dictionary could not be loaded.')),
  });
  const retry = () => { void q.refresh(); };
  if (q.data) return { status: 'ready', dictionary: q.data, retry };
  if (q.error && !q.loading) return { status: 'error', message: q.error.message, retry };
  return { status: 'loading', retry };
}
