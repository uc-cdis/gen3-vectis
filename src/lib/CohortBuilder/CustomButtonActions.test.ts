import { afterEach, describe, expect, it, vi } from 'vitest';

const registered = vi.hoisted(() => ({ action: null as null | ((p: Record<string, unknown>, done?: () => void) => Promise<void>) }));
vi.mock('@gen3/frontend', () => ({
  registerDownloadButtonAction: (_name: string, def: { action: typeof registered.action }) => { registered.action = def.action; },
}));
import { registerCustomButtonActions } from './CustomButtonActions';

afterEach(() => vi.unstubAllGlobals());

describe('the copy-as-Python button action', () => {
  it('puts a self-contained snippet on the clipboard with the filter written as an escaped Python literal, and no credential', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    registerCustomButtonActions();
    const done = vi.fn();
    await registered.action!({ type: 'audit_event', fields: ['a'], filter: { in: { country: ['US', 'x"; import os #'] }, ok: true, n: null } }, done);
    const code = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(code).toContain('Gen3Auth()');
    expect(code).toContain('"type": "audit_event"');
    expect(code).toContain('"ok": True');
    expect(code).toContain('"n": None');
    expect(code).toContain('"x\\"; import os #"'); // the quote is escaped: the text stays inside its string
    expect(code).not.toMatch(/Bearer|api_key|access_token/i);
    expect(done).toHaveBeenCalledTimes(1);
  });
  it('falls back to a prompt when the clipboard is refused', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied'); } } });
    const prompt = vi.fn();
    vi.stubGlobal('window', Object.assign(Object.create(window), { prompt }));
    registerCustomButtonActions();
    await registered.action!({}, undefined);
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});
