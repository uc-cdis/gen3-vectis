import React from 'react';
import type { DictionaryLoader } from '@/lib/dictionary/load';
import { useDictionary } from '@/lib/dictionary/load';
import { DictionaryExplorer } from './DictionaryExplorer';
import { DictionaryBoundary } from './states';

/** Fetches the dictionary (or uses `loader`, for tests and the development page) and renders the page body. */
export const DictionaryScreen = ({ loader }: { loader?: DictionaryLoader }) => {
  const state = useDictionary(loader);
  return <DictionaryBoundary state={state} retry={state.retry}>{(d) => <DictionaryExplorer dictionary={d} />}</DictionaryBoundary>;
};
