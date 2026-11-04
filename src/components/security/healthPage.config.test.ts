import { describe, expect, it } from 'vitest';
import authz from '../../../config/gen3/authz.json';
import navigation from '../../../config/gen3/navigation.json';
import { SECTION_PATHS } from './context';

type Route = { loginRequired?: boolean; authz?: string[] };
const routes = (authz as { routes: Record<string, Route> }).routes;
const items = (navigation as { navigation: { items: { href: string; name: string }[] } }).navigation.items;

describe('the console pages, their access rules and their menu entries agree', () => {
  it('every console page has a login-required route in authz.json that names a resource', () => {
    for (const path of SECTION_PATHS) {
      expect(routes[path], path).toBeDefined();
      expect(routes[path].loginRequired, path).toBe(true);
      expect(routes[path].authz?.length ?? 0, path).toBeGreaterThan(0);
    }
  });

  it('the Health page needs the administrator grant, which no other console page does', () => {
    expect(routes['/Health'].authz).toEqual(['/programs/vectis/projects/siem_admin']);
    for (const path of SECTION_PATHS.filter((p) => p !== '/Health')) expect(routes[path].authz, path).not.toContain('/programs/vectis/projects/siem_admin');
  });

  it('every console page has a menu entry, and the Health entry sits next to Detection', () => {
    const hrefs = items.map((i) => i.href);
    for (const path of SECTION_PATHS) expect(hrefs, path).toContain(path);
    expect(hrefs.indexOf('/Health')).toBe(hrefs.indexOf('/Detection') + 1);
  });
});
