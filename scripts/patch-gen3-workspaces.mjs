// Patches @gen3/workspaces (postinstall and image build) so the Data & Tools rail works with the DDv2 dictionary:
//   1. parseSchemaNodes reads DDv2's `entities` instead of the top level.
//   2. Property types like ["string","null"] show as "string".
//   3. The AI Assistant tab is listed (the entry is commented out in this release).
//   4. The assistant resolves a relative `schemaUrl` under /api/v0/submission/, like the Dictionary tab.
// Each edit must match exactly once or the install fails, so an upgrade that changes this code gets looked at.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARK = '/* vectis-ddv2 */';

export const PATCHES = [
  {
    name: 'parseSchemaNodes reads DDv2 entities',
    from: '    const raw = schema.properties ?? schema.definitions ?? schema;',
    to: `    ${MARK}\n    // DDv2 keeps its entities under "entities"; the classic dictionary has them at the top level.\n` +
      '    const raw = schema.entities && typeof schema.entities === \'object\' && !Array.isArray(schema.entities) ? schema.entities : schema.properties ?? schema.definitions ?? schema;',
  },
  {
    name: 'array property types',
    from: '                type: vTyped.type ?? vTyped.oneOf?.[0]?.type ?? undefined,',
    to: '                type: Array.isArray(vTyped.type) ? vTyped.type.filter((t)=>t !== \'null\').join(\' | \') || undefined : vTyped.type ?? vTyped.oneOf?.[0]?.type ?? undefined,',
  },
  {
    name: 'AI Assistant tab',
    from: '    }\n];\nconst DataToolsPanel = ({ schemaUrl = DEFAULT_DICTIONARY_SCHEMA_URL, kbUrl })=>{',
    to: '    },\n    {\n        id: \'assistant\',\n        label: \'AI Assistant\'\n    }\n];\nconst DataToolsPanel = ({ schemaUrl = DEFAULT_DICTIONARY_SCHEMA_URL, kbUrl })=>{',
  },
  {
    name: 'assistant dictionary URL',
    from: '                const res = await fetch(schemaUrl, {',
    to: '                const res = await fetch(/^([a-z][a-z0-9+.-]*:|\\/)/i.test(schemaUrl) ? schemaUrl : `/api/v0/submission/${schemaUrl}`, {',
  },
];

/** The patched text, or the text unchanged if it is already patched. Throws if an edit does not match exactly once. */
export function applyPatches(text, file = 'bundle') {
  if (text.includes(MARK)) return text;
  let out = text;
  for (const p of PATCHES) {
    const count = out.split(p.from).length - 1;
    if (count !== 1) {
      throw new Error(`patch-gen3-workspaces: "${p.name}" matched ${count} times in ${file} (expected 1). @gen3/workspaces changed; review this script.`);
    }
    out = out.replace(p.from, () => p.to);
  }
  return out;
}

export const BUNDLES = ['dist/index/esm/index.js', 'dist/index/cjs/index.js'];

export function patchPackage(root) {
  const pkg = path.join(root, 'node_modules', '@gen3', 'workspaces');
  if (!fs.existsSync(pkg)) {
    console.log('patch-gen3-workspaces: @gen3/workspaces is not installed; nothing to do');
    return [];
  }
  const done = [];
  for (const rel of BUNDLES) {
    const file = path.join(pkg, rel);
    const before = fs.readFileSync(file, 'utf8');
    const after = applyPatches(before, rel);
    if (after !== before) {
      fs.writeFileSync(file, after);
      done.push(rel);
    }
  }
  console.log(done.length ? `patch-gen3-workspaces: patched ${done.join(', ')}` : 'patch-gen3-workspaces: already patched');
  return done;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    patchPackage(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  }
}
