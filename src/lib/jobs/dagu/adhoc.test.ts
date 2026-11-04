import { describe, expect, it } from 'vitest';
import { ADHOC_LIMITS, compileAdhocDag } from './adhoc';

const env = { NODE_ENV: 'production', DAGU_ALLOWED_EXECUTORS: 'kubernetes,http,jq,mail', JOBS_ALLOWED_IMAGE_PREFIXES: 'quay.io/cdis/,busybox' };
const step = (extra = '') => `  - id: a\n    action: k8s.run\n    with:\n      image: busybox\n      command: [echo, hi]\n${extra}`;
const dag = (head: string, steps: string) => `name: t\n${head}steps:\n${steps}`;
const errorsOf = (y: string): string[] => { const r = compileAdhocDag(y, env); return r.ok ? [] : r.errors; };

describe('a pasted workflow', () => {
  it('still compiles when it is ordinary', () => {
    const y = dag('timeout_sec: 3600\nmax_active_steps: 4\n', step('    retry_policy:\n      limit: 3\n      interval_sec: 30\n      backoff: 2\n    timeout_sec: 600\n'));
    expect(compileAdhocDag(y, env).ok).toBe(true);
  });

  it('may not send e-mail, even when the server enables the mail executor', () => {
    const y = dag('', '  - id: m\n    action: mail.send\n    with:\n      to: someone@example.org\n      from: ceo@example.org\n      subject: hi\n      message: hi\n');
    expect(errorsOf(y).join(' ')).toMatch(/cannot send e-mail/);
    expect(errorsOf(y.replace('action: mail.send', 'type: mail')).join(' ')).toMatch(/cannot send e-mail/);
  });

  it.each([
    ['retries', step(`    retry_policy:\n      limit: ${ADHOC_LIMITS.retries + 1}\n`), /retry_policy.limit/],
    ['a million retries', step('    retry_policy:\n      limit: 1000000\n      interval_sec: 0\n'), /retry_policy.limit/],
    ['a retry wait', step(`    retry_policy:\n      limit: 1\n      interval_sec: ${ADHOC_LIMITS.intervalSec + 1}\n`), /interval_sec/],
    ['a text retry limit', step('    retry_policy:\n      limit: "5"\n'), /retry_policy.limit/],
    ['an unknown retry key', step('    retry_policy:\n      limit: 1\n      command: x\n'), /retry_policy.command/],
    ['a step timeout', step(`    timeout_sec: ${ADHOC_LIMITS.timeoutSec + 1}\n`), /timeout_sec/],
  ])('refuses %s', (_n, steps, re) => {
    expect(errorsOf(dag('', steps)).join(' ')).toMatch(re);
  });

  it('refuses a huge workflow timeout and too many parallel steps', () => {
    expect(errorsOf(dag('timeout_sec: 999999999\n', step())).join(' ')).toMatch(/timeout_sec/);
    expect(errorsOf(dag(`max_active_steps: ${ADHOC_LIMITS.activeSteps + 1}\n`, step())).join(' ')).toMatch(/max_active_steps/);
    expect(errorsOf(dag('max_active_steps: 0\n', step())).join(' ')).toMatch(/max_active_steps/);
  });
});
