/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { describe, expect, it } from 'vitest';
import { RunnerConfigError } from './runner';
import { getRunner, runnerId } from './select';
import { tesRunner } from './tes/tesRunner';

describe('runner selection', () => {
  it('defaults to tes and treats empty as unset', () => {
    expect(runnerId({})).toBe('tes');
    expect(runnerId({ JOBS_RUNNER: ' ' })).toBe('tes');
    expect(getRunner({ JOBS_RUNNER: 'tes' })).toBe(tesRunner);
  });
  it('anything else fails closed, including batch and object-prototype names', () => {
    for (const v of ['TES', 'batch', 'k8s', 'tes,x', '__proto__', 'constructor', 'toString']) expect(() => runnerId({ JOBS_RUNNER: v }), v).toThrow(RunnerConfigError);
  });
});
