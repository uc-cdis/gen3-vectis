import React from 'react';
import type { NavPageLayoutProps } from '@gen3/frontend';
import { NavPageLayout, getNavPageLayoutPropsFromConfig } from '@gen3/frontend';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import { DictionaryScreen } from '@/components/dictionary/DictionaryScreen';
import { parseDictionary } from '@/lib/dictionary/ddv2';
import type { DictionaryLoader } from '@/lib/dictionary/load';
import { LoadError } from '@/lib/dictionary/load';

// DEVELOPMENT ONLY. The Dictionary page body against a small synthetic DDv2 dictionary, with no login.
//   ?source=fixture (default)  the synthetic dictionary in src/lib/dictionary/sample.ts
//   ?source=network            the page's real fetch of <submission API>/_dictionary/_all/ (tests answer that URL themselves)
//   ?source=error|empty|loading|hostile   the page's other states
// In a production build getServerSideProps returns 404 and nothing links here. The fixture is loaded with a guarded require
// so a production build drops it with the dead branch.
const fixture = (): unknown => (process.env.NODE_ENV === 'production' ? undefined : require('@/lib/dictionary/sample').SAMPLE_DICTIONARY);
const decode = (doc: unknown) => { const r = parseDictionary(doc); if (!r.ok) throw new LoadError(r.error); return r.dictionary; };

const LOADERS: Record<string, DictionaryLoader | undefined> = {
  fixture: async () => decode(fixture()),
  error: async () => { throw new LoadError('The dictionary could not be reached.'); },
  empty: async () => decode({ entities: {} }),
  hostile: async () => decode(JSON.parse('{"entities":{"__proto__":{"properties":{}}}}')),
  loading: (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new LoadError('Loading the dictionary was cancelled or timed out.')))),
  network: undefined,
};

const DevDictionary = ({ headerProps, footerProps }: NavPageLayoutProps) => {
  const source = useRouter().query.source;
  const key = typeof source === 'string' && Object.hasOwn(LOADERS, source) ? source : 'fixture';
  return (
    <NavPageLayout {...{ headerProps, footerProps }} mainProps={{ fixed: true }} headerMetadata={{ title: 'Vectis Dictionary (dev)', content: 'Development fixtures', key: 'vectis-dictionary-dev' }}>
      <DictionaryScreen key={key} loader={LOADERS[key]} />
    </NavPageLayout>
  );
};

export const getServerSideProps: GetServerSideProps<NavPageLayoutProps> = async () => {
  if (process.env.NODE_ENV === 'production') return { notFound: true };
  return { props: { ...(await getNavPageLayoutPropsFromConfig()) } };
};

export default DevDictionary;
