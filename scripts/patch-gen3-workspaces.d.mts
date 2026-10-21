export const MARK: string;
export const PATCHES: ReadonlyArray<{ name: string; from: string; to: string }>;
export const BUNDLES: string[];
export function applyPatches(text: string, file?: string): string;
export function patchPackage(root: string): string[];
