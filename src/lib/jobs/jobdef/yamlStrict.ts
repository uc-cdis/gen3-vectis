import { parseDocument } from 'yaml';
import { hasParserUnsafeChars, sanitizeLabel } from '@/lib/safe-text';

export const MAX_JOBDEF_BYTES = 64 * 1024;
// C0/C1 controls (incl. NEL U+0085), soft hyphen, zero-width and bidi characters, line/paragraph separators, BOM: characters
// two YAML parsers (ours and the engine's) may treat differently, or that make text read differently from what it is.
const MAX_NESTING = 20;
const MAX_NODES = 20000;

/** Depth and node count of parsed data; `over` is true as soon as either limit is exceeded (never truncates silently). */
function shape(v: unknown): { depth: number; nodes: number; over: boolean } {
  let nodes = 0;
  let maxDepth = 0;
  let over = false;
  const walk = (x: unknown, d: number) => {
    if (over) return;
    nodes += 1;
    if (d > maxDepth) maxDepth = d;
    if (d > MAX_NESTING || nodes > MAX_NODES) { over = true; return; }
    if (Array.isArray(x)) for (const y of x) walk(y, d + 1);
    else if (typeof x === 'object' && x !== null) for (const y of Object.values(x)) walk(y, d + 1);
  };
  walk(v, 0);
  return { depth: maxDepth, nodes, over };
}

function fmtYamlError(e: { message: string }): string {
  return sanitizeLabel(e.message.split('\n')[0], 200);
}

type StrictYaml = { ok: true; data: unknown } | { ok: false; errors: string[] };

/**
 * The one hardened YAML reader for everything the catalog reads (job definitions and native DAG definitions):
 * <= 64KB, no control characters, bounded flow nesting, ONE document, no anchors/aliases/merge keys/custom tags, unique keys.
 * (A parser differential with the engine that finally reads the text is the classic way to smuggle content past a linter;
 * refusing every YAML feature that the two parsers might treat differently keeps that gap small.)
 */
export function parseYamlStrict(yamlText: unknown, opts: { allowPlaceholders?: boolean } = {}): StrictYaml {
  if (typeof yamlText !== 'string') return { ok: false, errors: ['definition must be text'] };
  if (new TextEncoder().encode(yamlText).length > MAX_JOBDEF_BYTES) return { ok: false, errors: ['definition is larger than 64KB'] };
  if (hasParserUnsafeChars(yamlText)) return { ok: false, errors: ['definition contains control characters'] };
  // Flow-nesting guard before the parser recurses (placeholders {{x}} are not nesting).
  const probe = opts.allowPlaceholders === false ? yamlText : yamlText.replace(/\{\{[^{}]*\}\}/g, '');
  if ((probe.match(/[[{]/g) ?? []).length > 400) return { ok: false, errors: ['definition is too deeply nested'] };
  // block nesting is indentation: refuse absurd indentation before the parser recurses
  if (/^ {120,}\S/m.test(yamlText)) return { ok: false, errors: ['definition is too deeply nested'] };
  try {
    const doc = parseDocument(yamlText, { schema: 'core', version: '1.2', merge: false, uniqueKeys: true, customTags: [], prettyErrors: false });
    const problems = [...doc.errors, ...doc.warnings];
    if (problems.length) return { ok: false, errors: problems.slice(0, 5).map(fmtYamlError) };
    const data = doc.toJS({ maxAliasCount: 0 });
    if (shape(data).over) return { ok: false, errors: ['definition is too deeply nested or too large'] };
    return { ok: true, data };
  } catch {
    return { ok: false, errors: ['definition is not valid YAML'] };
  }
}
