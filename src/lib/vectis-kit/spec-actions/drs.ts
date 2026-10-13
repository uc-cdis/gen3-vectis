interface DrsManifest {
  manifest: { object_id: string }[];
  included: number;
  skipped: number;
  /** Why rows were skipped, so the console can say so rather than silently dropping them. */
  skippedReasons: { notDrs: number; missing: number; duplicate: number };
}

/** drs://host/id where host and id use URI-safe characters only. No whitespace, quotes or control characters. */
const DRS_URI = /^drs:\/\/[A-Za-z0-9][A-Za-z0-9.:_-]{0,127}\/[A-Za-z0-9._~:@+=%/-]{1,255}$/;
/** No `..` or `.` path segment and no shell metacharacters: a consumer may build paths or commands from the id. */
export const isDrsUri = (v: unknown): v is string =>
  typeof v === 'string' && DRS_URI.test(v) && !v.slice(v.indexOf('/', 6) + 1).split('/').some((seg) => seg === '..' || seg === '.');
const MAX_MANIFEST_OBJECTS = 5000;

/**
 * Build a manifest from result rows. A row contributes its `object_id`, or failing that its `evidence_uri`, but only
 * when the value is a drs:// URI. Everything else is skipped and counted. Duplicates are listed once.
 */
export function toDrsManifest(rows: readonly Record<string, unknown>[]): DrsManifest {
  const seen = new Set<string>();
  const manifest: { object_id: string }[] = [];
  const reasons = { notDrs: 0, missing: 0, duplicate: 0 };
  for (const row of rows) {
    const candidates = [row?.object_id, row?.evidence_uri].filter((v) => v !== null && v !== undefined && v !== '');
    if (candidates.length === 0) { reasons.missing += 1; continue; }
    const uri = candidates.find(isDrsUri);
    if (!uri) { reasons.notDrs += 1; continue; }
    if (seen.has(uri)) { reasons.duplicate += 1; continue; }
    if (manifest.length >= MAX_MANIFEST_OBJECTS) { reasons.notDrs += 1; continue; }
    seen.add(uri);
    manifest.push({ object_id: uri });
  }
  return { manifest, included: manifest.length, skipped: reasons.notDrs + reasons.missing + reasons.duplicate, skippedReasons: reasons };
}

export const manifestJson = (m: DrsManifest): string => JSON.stringify(m.manifest, null, 2);
