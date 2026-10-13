import { describe, expect, it } from 'vitest';
import { ROUTES, buildPath, matchRoute } from './routes';

describe('route allowlist', () => {
  it('matches every declared route by its own method and path', () => {
    for (const [name, def] of Object.entries(ROUTES)) {
      const segs = def.path.split('/').map((s) => (s.startsWith(':') ? 'g-abc123' : s));
      const m = matchRoute(def.method, segs);
      expect(`${name}:${m?.name}`).toBe(`${name}:${name}`);
    }
  });

  it('extracts path parameters', () => {
    expect(matchRoute('PATCH', ['alerts', 'g-abc123'])).toEqual({ name: 'alertPatch', params: { id: 'g-abc123' } });
    expect(matchRoute('GET', ['alerts', 'g-1', 'why'])?.name).toBe('alertWhy');
  });

  it('keeps a literal route apart from a parameterised sibling', () => {
    expect(matchRoute('POST', ['alerts', 'bulk'])?.name).toBe('alertBulk');
  });

  it('rejects the wrong method, unknown paths and extra segments', () => {
    expect(matchRoute('GET', ['alerts'])).toBeNull(); // alerts is POST only
    expect(matchRoute('DELETE', ['cases', 'case-1'])).toBeNull();
    expect(matchRoute('GET', ['admin'])).toBeNull();
    expect(matchRoute('GET', ['cases', 'case-1', 'extra'])).toBeNull();
    expect(matchRoute('GET', [])).toBeNull();
  });

  it.each([
    '..', '../x', 'a/b', 'a b', 'a\nb', 'a\u0000b', '', ' ', '-lead', 'x'.repeat(129), 'g-1\n', 'g-1%2f..',
  ])('rejects the hostile path parameter %j', (bad) => {
    expect(matchRoute('PATCH', ['alerts', bad])).toBeNull();
    expect(() => buildPath('alertPatch', { id: bad })).toThrow(/path parameter/);
  });

  it('encodes a valid parameter and requires it to be present', () => {
    expect(buildPath('caseGet', { id: 'case-0001' })).toBe('cases/case-0001');
    expect(() => buildPath('caseGet')).toThrow(/path parameter/);
  });
});
