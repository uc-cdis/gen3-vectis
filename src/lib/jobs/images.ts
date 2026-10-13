/**
 * Runner-neutral container image policy (used by the TES runner for task executors and by the Dagu runner for docker steps).
 *
 * Env names: the neutral `JOBS_*` name wins; the original `TES_*` name is still read (deploy compatibility), so an existing
 * deployment keeps its policy and a Dagu-only deployment does not have to carry a "TES" variable.
 *   JOBS_ALLOWED_IMAGE_PREFIXES | TES_ALLOWED_IMAGE_PREFIXES   entry ending '/' = prefix; else an exact repository (name or name:tag)
 *   JOBS_REQUIRE_IMAGE_DIGEST   | TES_REQUIRE_IMAGE_DIGEST     'true' requires @sha256:<64 hex>
 *   JOBS_ALLOW_ANY_IMAGE        | TES_ALLOW_ANY_IMAGE          DANGEROUS; in production also needs ..._I_UNDERSTAND_ANY_IMAGE_IS_UNSAFE=yes
 * Production with no prefixes configured = denied ('not-configured').
 */
import { isProduction } from './portal';

type Env = Record<string, string | undefined>;
const pick = (env: Env, name: string): string | undefined => env[`JOBS_${name}`] ?? env[`TES_${name}`];

export function imageAllowed(image: string, env: Env = process.env): boolean | 'not-configured' {
  if (pick(env, 'REQUIRE_IMAGE_DIGEST') === 'true' && !/@sha256:[0-9a-f]{64}$/.test(image)) return false;
  const prefixes = (pick(env, 'ALLOWED_IMAGE_PREFIXES') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (prefixes.length === 0) {
    // "any image" is DANGEROUS: in production it needs a second, explicit acknowledgement.
    if (pick(env, 'ALLOW_ANY_IMAGE') === 'true' && (!isProduction(env) || pick(env, 'I_UNDERSTAND_ANY_IMAGE_IS_UNSAFE') === 'yes')) return true;
    return isProduction(env) ? 'not-configured' : true;
  }
  // a prefix ending in '/' matches by startsWith; any other entry must equal the repository path exactly (tag allowed, digest not)
  return prefixes.some((p) => (p.endsWith('/') ? image.startsWith(p) : image === p || (image.startsWith(`${p}:`) && !image.slice(p.length + 1).includes('/') && !image.includes('@'))));
}
