import React from 'react';
import { Button } from '@mantine/core';
import { ErrorCard, MessageCard } from '@gen3/frontend';
import { LoadingState } from '@/lib/vectis-kit/ui/primitives';
import type { DictionaryState } from '@/lib/dictionary/load';

/** Loading, error and empty states for anything that shows the dictionary. Children only ever see a parsed dictionary. */
export const DictionaryBoundary = ({ state, retry, children }: {
  state: DictionaryState; retry: () => void; children: (d: Extract<DictionaryState, { status: 'ready' }>['dictionary']) => React.ReactNode;
}) => {
  if (state.status === 'loading') return <div className="p-4 w-full" role="status"><LoadingState rows={6} /></div>;
  if (state.status === 'error') {
    return (
      <div className="p-4 w-full" role="alert" data-testid="dictionary-error">
        <ErrorCard message={`The dictionary could not be shown. ${state.message}`} />
        <Button mt="xs" size="xs" variant="default" onClick={retry}>Try again</Button>
      </div>
    );
  }
  if (state.dictionary.entities.length === 0) {
    return <div className="p-4 w-full" data-testid="dictionary-empty"><MessageCard message="The dictionary is published but defines no entities." /></div>;
  }
  return <>{children(state.dictionary)}</>;
};
