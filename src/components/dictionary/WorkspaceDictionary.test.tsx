import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoadError } from '@/lib/dictionary/load';
import { CompactDictionary } from './CompactDictionary';
import { WorkspaceDictionary } from './WorkspaceDictionary';
import { sampleLoader, wrap } from './testUtils';

describe('the compact workspace dictionary', () => {
  it('lists entities, searches, and expands one to its 9 properties', async () => {
    wrap(<CompactDictionary loader={sampleLoader()} />);
    expect(await screen.findAllByTestId('compact-entity')).toHaveLength(8);
    await userEvent.type(screen.getByLabelText('Search entities and properties'), 'http_act');
    const hit = screen.getAllByTestId('compact-entity');
    expect(hit).toHaveLength(1);
    // a single match opens itself
    expect(await screen.findAllByTestId('compact-property')).toHaveLength(9);
    const link = screen.getByRole('link', { name: 'Open in the dictionary', hidden: true });
    expect(link).toHaveAttribute('href', '/DataDictionary?entity=http_activity');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
  });
  it('shows the version and a clear error state', async () => {
    const ok = wrap(<CompactDictionary loader={sampleLoader()} />);
    expect(await screen.findByText('sample-ddv2-v1')).toBeInTheDocument();
    ok.unmount();
    wrap(<CompactDictionary loader={async () => { throw new LoadError('No dictionary has been published yet.'); }} />);
    expect(await screen.findByTestId('dictionary-error')).toHaveTextContent('No dictionary has been published yet.');
  });
});

describe('the workspace drawer', () => {
  it('fetches nothing until opened, then shows the compact dictionary, and closes with Escape', async () => {
    const loader = sampleLoader();
    wrap(<WorkspaceDictionary loader={loader} />);
    expect(loader).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('workspace-dictionary-open'));
    const dialog = await screen.findByRole('dialog', { name: 'Dictionary' });
    expect(await within(dialog).findAllByTestId('compact-entity')).toHaveLength(8);
    expect(loader).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
