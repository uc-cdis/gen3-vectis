import type { TesTaskSubmission } from '../tes/types';
import type { JobDef, LintIssue } from './types';

const SECRET_NAME_KEY = /secret|token|passw|key/i;
const SECRET_REF = /^secret:\/\/([A-Za-z0-9_.-]{1,64})$/;
const PATTERNS: Array<[RegExp, string]> = [
  [/\b(AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[A-Z0-9]{16}\b/, 'an AWS access key id'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----/, 'a PEM private key'],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/, 'a JWT'],
  [/\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})/, 'a GitHub token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/(secret|token|passw(or)?d|key)[A-Za-z0-9_]*["']?\s*[:=,]\s*["']?[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/i, 'an AWS-secret-like value next to a credential name'],
];
const LITERAL_SAFE = /^[\x20-\x7e]{0,4096}$/;

export function scanString(s: string): string | null {
  for (const [re, what] of PATTERNS) if (re.test(s)) return what;
  return null;
}
function walk(v: unknown, path: string, cb: (s: string, path: string) => void, depth = 0): void {
  if (depth > 8) return;
  if (typeof v === 'string') cb(v, path);
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, cb, depth + 1));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, cb, depth + 1);
}
function lintEnv(env: Record<string, unknown> | undefined, path: string, out: LintIssue[], allowSecretRefs: boolean, declared?: Set<string>) {
  for (const [k, v] of Object.entries(env ?? {})) {
    const p = `${path}.${k}`;
    if (typeof v !== 'string') continue;
    if (v.startsWith('secret://')) {
      const m = SECRET_REF.exec(v);
      if (!m) out.push({ path: p, message: 'invalid secret reference (use secret://<name>)' });
      else if (!allowSecretRefs) out.push({ path: p, message: 'secret references are not allowed here' });
      else if (declared && !declared.has(m[1])) out.push({ path: p, message: `secret "${m[1]}" is not listed in secrets[]` });
      continue;
    }
    if (!LITERAL_SAFE.test(v)) out.push({ path: p, message: 'env values must be printable ASCII text or secret://<name>' });
    if (SECRET_NAME_KEY.test(k) && /^[A-Za-z0-9/+=]{40}$/.test(v)) out.push({ path: p, message: 'looks like an AWS secret access key; use secret://<name>' });
  }
}
function scanAll(root: unknown, out: LintIssue[]) {
  walk(root, '$', (s, p) => {
    const what = scanString(s);
    if (what) out.push({ path: p, message: `contains what looks like ${what}; use secret://<name> instead of a literal credential` });
  });
}

/** Static credential lint (hygiene, not a boundary) of a job definition (templates, not compiled values). */
export function lintDef(def: JobDef): LintIssue[] {
  const out: LintIssue[] = [];
  scanAll(def, out);
  const declared = new Set(def.secrets ?? []);
  lintEnv(def.env, 'env', out, true, declared);
  (def.executors_after ?? []).forEach((x, i) => lintEnv(x.env, `executors_after[${i}].env`, out, true, declared));
  return out;
}

/** Credential lint (HYGIENE, not a security boundary: pattern matching cannot catch every secret) of a task about to be sent (also run on compiled output, so a param cannot smuggle a credential). */
/** `declaredSecrets`: when allowSecretRefs is set, only these secret names may be referenced. */
export function lintTask(task: TesTaskSubmission, opts: { allowSecretRefs?: boolean; declaredSecrets?: ReadonlySet<string> } = {}): LintIssue[] {
  const out: LintIssue[] = [];
  scanAll(task, out);
  task.executors.forEach((x, i) => lintEnv(x.env, `executors[${i}].env`, out, opts.allowSecretRefs === true, opts.declaredSecrets as Set<string> | undefined));
  return out;
}
export const secretRefsIn = (task: TesTaskSubmission): string[] =>
  task.executors.flatMap((x) => Object.values(x.env ?? {})).filter((v) => v.startsWith('secret://'));
