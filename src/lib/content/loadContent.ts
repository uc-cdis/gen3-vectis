import type {
  AuthorizedRoutesConfig,
  Fonts,
  RegisteredIcons,
  TenStringArray
} from '@gen3/frontend';
import {
  ContentSource,
  DefaultAuthorizedRoutesConfig
} from '@gen3/frontend';
import { GEN3_COMMONS_NAME } from '@gen3/core';

const DEFAULT_SHADE = '#111111';

const normalizeShades = (value: unknown): TenStringArray => {
  const source =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};

  const ordered = [
    'max',
    'lightest',
    'lighter',
    'light',
    'DEFAULT',
    'vivid',
    'dark',
    'darker',
    'darkest',
    'min',
  ].map((key) => source[key]);

  const fallback =
    (typeof source.DEFAULT === 'string' && source.DEFAULT) || DEFAULT_SHADE;

  const normalized = ordered.map((entry) =>
    typeof entry === 'string' && entry.trim().length > 0 ? entry : fallback,
  );

  return normalized as TenStringArray;
};

const normalizeFonts = (value: unknown): Fonts => {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

  const toFontArray = (entry: unknown): string[] => {
    if (Array.isArray(entry) && entry.every((v) => typeof v === 'string')) {
      return entry as string[];
    }
    if (typeof entry === 'string' && entry.trim().length > 0) {
      return [entry];
    }
    return ['Poppins', 'sans-serif'];
  };

  const heading = toFontArray(input.heading);
  const content = toFontArray(input.content);
  const fontFamily =
    typeof input.fontFamily === 'string' && input.fontFamily.trim().length > 0
      ? input.fontFamily
      : heading[0] || 'Poppins';

  return {
    heading,
    content,
    fontFamily,
  };
};

export const loadContent = async () => {
  const modals = await ContentSource.getContentDatabase().get(
    `${GEN3_COMMONS_NAME}/modals.json`,
  );
  const session = await ContentSource.getContentDatabase().get(
    `${GEN3_COMMONS_NAME}/session.json`,
  );

  const fonts = await ContentSource.getContentDatabase().get(
    `${GEN3_COMMONS_NAME}/themeFonts.json`,
  );

  const themeColors = await ContentSource.getContentDatabase().get(
    `${GEN3_COMMONS_NAME}/themeColors.json`,
  );

  const protectedRoutes = await ContentSource.getContentDatabase().get<AuthorizedRoutesConfig>(
    `${GEN3_COMMONS_NAME}/authz.json`,
  );

  const workspacePreviewEnabled =
    process.env.LOCAL_WORKSPACES_PREVIEW === 'true';

  const resolvedProtectedRoutes = structuredClone(
    protectedRoutes ?? DefaultAuthorizedRoutesConfig,
  ) as AuthorizedRoutesConfig;

  if (workspacePreviewEnabled && resolvedProtectedRoutes.routes) {
    for (const route of ['/Workspace', '/Workspaces', '/workspaces/jupyter']) {
      const current = resolvedProtectedRoutes.routes[route] || {};
      resolvedProtectedRoutes.routes[route] = {
        ...current,
        loginRequired: false,
      };
    }
  }

  const colors = Object.fromEntries(
    Object.entries(themeColors).map(([key, values]) => [key, normalizeShades(values)]),
  );

  const icons = await ContentSource.getContentDatabase().getAll(
    `icons/`,
    '\\.json',
  );

  return {
    modalsConfig: modals,
    sessionConfig: 'sessionConfig' in session ? session.sessionConfig : session,
    fonts: normalizeFonts(fonts),
    colors: colors,
    icons: icons as RegisteredIcons[],
    protectedRoutes: resolvedProtectedRoutes,
  };
};
