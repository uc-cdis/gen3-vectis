import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as routerMock from './src/test/nextRouterMock';

// next/router is replaced by an in-memory router for every test (see src/test/nextRouterMock.ts).
vi.mock('next/router', () => routerMock);

// jsdom lacks these; Mantine and the charts need them.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= RO;
Element.prototype.scrollIntoView ??= () => undefined;
// Mantine's autosizing Textarea reads document.fonts, which jsdom does not have.
if (!('fonts' in document)) {
  Object.defineProperty(document, 'fonts', { value: { addEventListener: () => undefined, removeEventListener: () => undefined, ready: Promise.resolve() } });
}
URL.createObjectURL ??= () => 'blob:test';

afterEach(() => { cleanup(); routerMock.setMockUrl('/'); });
