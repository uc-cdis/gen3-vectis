import { describe, expect, it } from 'vitest';
import { accountText } from './origin';

describe('accountText', () => {
  const names = { '111122223333': 'Production platform', gdc_f5: 'gdc_f5' };
  it('shows the name and the id together', () => expect(accountText('111122223333', names)).toBe('Production platform (111122223333)'));
  it('shows the bare id when there is no name, or the name is the id', () => {
    expect(accountText('999999999999', names)).toBe('999999999999');
    expect(accountText('gdc_f5', names)).toBe('gdc_f5');
  });
  it('says so when a record did not name its account, never a blank', () => {
    for (const none of [null, undefined, '']) expect(accountText(none, names)).toBe('Account not recorded');
  });
});
