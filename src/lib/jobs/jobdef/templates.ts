/** `{{name}}` tokens: one pass, never re-evaluated. */
export const tokenRe = () => /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
export const BUILTIN_USER_BUCKET = 'user_bucket';

export function tokensIn(s: string): string[] {
  return [...s.matchAll(tokenRe())].map((m) => m[1]);
}
/** True if, once valid tokens are removed, braces remain (malformed placeholder). */
export function hasStrayBraces(s: string): boolean {
  return /\{\{|\}\}/.test(s.replace(tokenRe(), ''));
}
export const isWholeToken = (s: string): string | null => /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/.exec(s)?.[1] ?? null;

const SHELLS = /^(sh|bash|zsh|dash|ash|ksh|csh|tcsh|fish|eval|exec|env|xargs|awk|gawk|mawk|busybox|jq)$/;
const INLINE: Array<[RegExp, RegExp]> = [
  [/^(python|python[0-9.]+|pypy[0-9]*)$/, /^-[A-Za-z]*c$/],
  [/^(node|nodejs|bun|deno)$/, /^(-[A-Za-z]*e|--eval|-p|--print)$/],
  [/^(perl|ruby|lua|Rscript)$/, /^-[A-Za-z]*e$/],
  [/^php$/, /^-r$/],
];
const base = (a: string) => a.split('/').pop() ?? a;

/**
 * Indexes of argv elements that hold a placeholder where it would be interpreted as code:
 * the program itself, or anything after a shell / inline-code flag.
 */
export function shellPlaceholderViolations(argv: string[]): number[] {
  const bad: number[] = [];
  let tainted = false;
  let interp: RegExp | null = null;
  argv.forEach((a, i) => {
    const has = tokensIn(a).length > 0;
    if (has && (i === 0 || tainted)) bad.push(i);
    if (has) return;
    const b = base(a);
    if (SHELLS.test(b) || a === '-c') tainted = true;
    for (const [prog, flag] of INLINE) {
      if (prog.test(b)) interp = flag;
    }
    if (interp && interp.test(a)) tainted = true;
  });
  return bad;
}

/** True if a definition uses the `{{user_bucket}}` placeholder (needs a runner that offers per-user storage). */
export const usesUserBucket = (def: unknown): boolean => /\{\{\s*user_bucket\s*\}\}/.test(JSON.stringify(def));
