import React from 'react';
import { Button, Drawer } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconBook2 } from '@tabler/icons-react';
import { PanelErrorBoundary } from '@gen3/frontend';
import type { DictionaryLoader } from '@/lib/dictionary/load';
import { CompactDictionary } from './CompactDictionary';

/** Width of the framework's "Data & Tools" rail, so the dictionary keeps the footprint people are used to. */
export const RAIL_WIDTH = 310;

/**
 * The workspace's dictionary. The framework's own "Data & Tools" rail renders a panel that reads the classic dictionary
 * shape and has no way to be replaced (@gen3/workspaces bundles it and exposes only `dataAndTools.enabled`), so that rail
 * is switched off for every workspace tier and this drawer takes its place: a button at the left edge opens the native dictionary at rail width.
 * The dictionary is fetched when the drawer opens, not before.
 */
export const WorkspaceDictionary = ({ loader }: { loader?: DictionaryLoader }) => {
  const [opened, { open, close }] = useDisclosure(false);
  return (
    <>
      <Button
        onClick={open} leftSection={<IconBook2 size={16} />} size="xs" aria-haspopup="dialog" data-testid="workspace-dictionary-open"
        style={{ position: 'fixed', left: 0, bottom: 80, zIndex: 150, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
      >
        Dictionary
      </Button>
      <Drawer
        opened={opened} onClose={close} position="left" size={RAIL_WIDTH} padding={0} title="Dictionary"
        withOverlay={false} trapFocus
        styles={{ body: { height: 'calc(100% - 60px)' }, content: { display: 'flex', flexDirection: 'column' } }}
      >
        <PanelErrorBoundary><CompactDictionary loader={loader} /></PanelErrorBoundary>
      </Drawer>
    </>
  );
};
