/**
 * Every table says which company, AWS account (or source system), deployment and feed a row belongs to. These columns are
 * not optional: whatever columns a person or a saved view picks, they are put back, right after the first column, so they
 * are on screen even in a narrow table. A column the index does not have is simply not added.
 */
export const ORIGIN_COLUMNS = ['tenant_id', 'account_id', 'environment', 'source'] as const;

const ORIGIN = new Set<string>(ORIGIN_COLUMNS);
export const isOriginColumn = (name: string): boolean => ORIGIN.has(name);

/** The service refuses a row request naming more than this many columns. */
export const MAX_REQUEST_COLUMNS = 60;

export function withOrigin(columns: readonly string[], known: readonly { name: string }[], max = MAX_REQUEST_COLUMNS): string[] {
  const have = new Set(known.map((c) => c.name));
  const rest = [...new Set(columns)].filter((c) => !ORIGIN.has(c) || have.has(c));
  const present = new Set(rest);
  const missing = ORIGIN_COLUMNS.filter((c) => have.has(c) && !present.has(c));
  const all = missing.length === 0 ? rest : [...rest.slice(0, 1), ...missing, ...rest.slice(1)];
  if (all.length <= max) return all;
  // Over the limit: the origin columns stay, the surplus is taken from the end of the other columns.
  let surplus = all.length - max;
  const out: string[] = [];
  for (let i = all.length - 1; i >= 0; i -= 1) {
    if (surplus > 0 && !ORIGIN.has(all[i]!)) { surplus -= 1; } else { out.unshift(all[i]!); }
  }
  return out;
}
