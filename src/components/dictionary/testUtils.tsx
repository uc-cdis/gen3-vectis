import React from 'react';
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { SWRConfig } from 'swr';
import { SAMPLE_DICTIONARY as sample } from '@/lib/dictionary/sample';
import { parseDictionary } from '@/lib/dictionary/ddv2';
import type { DictionaryLoader } from '@/lib/dictionary/load';
import { LoadError } from '@/lib/dictionary/load';

/** Test helpers shared by the dictionary component tests. */
export const decode = (doc: unknown) => { const r = parseDictionary(doc); if (!r.ok) throw new LoadError(r.error); return r.dictionary; };
export const sampleLoader = (): DictionaryLoader => vi.fn(async () => decode(sample));
export const wrap = (ui: React.ReactElement) => render(<SWRConfig value={{ provider: () => new Map() }}><MantineProvider>{ui}</MantineProvider></SWRConfig>);
