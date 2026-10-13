/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { describe, expect, it } from 'vitest';
import { normalizeStorageSetup, normalizeTime } from '../model';
import { sanitizeLogText, sanitizeText } from '@/lib/safe-text';
import { normalizeSize, normalizeTask, normalizeTaskList } from './normalize';
import { stripReadOnly, validateTaskSubmission } from './validate';

const ok = { executors: [{ image: 'python:3.9-slim', command: ['echo', 'hi'] }] };

describe('sanitizeText', () => {
  it('removes control, escape, bidi and zero-width characters but keeps newlines', () => {
    expect(sanitizeText('a\u001b[31mb\u0000c‮d​e\nf\tg')).toBe('a[31mbcde\nf\tg');
  });
  it('caps length and reports truncation', () => {
    const r = sanitizeLogText('x'.repeat(100), 10);
    expect(r.text).toHaveLength(10); expect(r.truncated).toBe(true);
    expect(sanitizeLogText('abc', 10).truncated).toBe(false);
  });
  it('does not split a surrogate pair and tolerates non-strings', () => {
    expect(sanitizeText('a😀', 2)).toBe('a');
    expect(sanitizeText(42)).toBe('');
  });
});

describe('normalizeTask', () => {
  it('maps unknown states to UNKNOWN and bad times to null', () => {
    const t = normalizeTask({ id: 'abc', state: 'EXPLODED', creation_time: 'yesterday', logs: [{ start_time: '2025-01-01T00:00:00Z', logs: [{ exit_code: 'x', stdout: 's\u0007' }] }] })!;
    expect(t.state).toBe('UNKNOWN'); expect(t.creation_time).toBeNull();
    expect(t.logs[0].start_time).toBe('2025-01-01T00:00:00Z');
    expect(t.logs[0].logs[0].exit_code).toBeNull(); expect(t.logs[0].logs[0].stdout).toBe('s');
  });
  it('rejects tasks without a safe id', () => {
    for (const id of [undefined, '', '../x', 'a/b', 'a:cancel', 'x'.repeat(129), 5]) expect(normalizeTask({ id })).toBeNull();
  });
  it('keeps size_bytes as an exact string', () => {
    expect(normalizeSize('9223372036854775807')).toBe('9223372036854775807');
    expect(normalizeSize(12)).toBe('12'); expect(normalizeSize(1e30)).toBeNull(); expect(normalizeSize('-1')).toBeNull(); expect(normalizeSize('1e5')).toBeNull();
    const t = normalizeTask({ id: 'a', logs: [{ outputs: [{ url: 's3://b/k', path: '/p', size_bytes: '9223372036854775807' }] }] })!;
    expect(t.logs[0].outputs[0].size_bytes).toBe('9223372036854775807');
  });
  it('caps stdout at 64KB with a flag, and never echoes env values', () => {
    const t = normalizeTask({ id: 'a', executors: [{ image: 'i', command: ['c'], env: { TOKEN: 'hunter2' } }], logs: [{ logs: [{ stdout: 'y'.repeat(70000), stderr: 'ok', exit_code: 0 }] }] })!;
    expect(t.logs[0].logs[0].stdout).toHaveLength(65536); expect(t.logs[0].logs[0].stdout_truncated).toBe(true); expect(t.logs[0].logs[0].stderr_truncated).toBe(false);
    expect(JSON.stringify(t)).not.toContain('hunter2');
  });
  it('is robust to hostile shapes', () => {
    expect(normalizeTask({ id: 'a', tags: { __proto__: 'x', k: { a: 1 } }, executors: 'x', logs: 5, inputs: [null, 3] })).toMatchObject({ id: 'a', executors: [], logs: [] });
    expect(normalizeTaskList({ tasks: [{ id: 'a' }, { id: '../b' }, 7], next_page_token: 'a b' })).toEqual({ tasks: [expect.objectContaining({ id: 'a' })], next_page_token: null });
    expect(normalizeTime('2025-13-45T00:00:00Z')).toBeNull();
  });
});

describe('storage setup', () => {
  it('keeps only short printable string fields', () => {
    const s = normalizeStorageSetup({ bucket: 'my-bucket', region: 'us-east-1', nested: { a: 1 }, junk: 'x y', long: 'z'.repeat(300) })!;
    expect(s.bucket).toBe('my-bucket'); expect(s.region).toBe('us-east-1'); expect(Object.keys(s).sort()).toEqual(['bucket', 'endpoint', 'region']);
    expect(normalizeStorageSetup('x')).toBeNull();
  });
});

describe('validateTaskSubmission', () => {
  it('accepts a minimal task and rejects unknown keys', () => {
    expect(validateTaskSubmission(ok).ok).toBe(true);
    expect(validateTaskSubmission({ ...ok, evil: 1 }).ok).toBe(false);
    expect(validateTaskSubmission({ executors: [{ ...ok.executors[0], privileged: true }] }).ok).toBe(false);
  });
  it('requires executors and bounds counts', () => {
    expect(validateTaskSubmission({}).ok).toBe(false);
    expect(validateTaskSubmission({ executors: [] }).ok).toBe(false);
    expect(validateTaskSubmission({ executors: Array(9).fill(ok.executors[0]) }).ok).toBe(false);
    const env = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`K${i}`, 'v']));
    expect(validateTaskSubmission({ executors: [{ ...ok.executors[0], env }] }).ok).toBe(false);
    const f = Array.from({ length: 65 }, (_, i) => ({ url: 's3://bkt/k', path: `/p${i}` }));
    expect(validateTaskSubmission({ ...ok, inputs: f }).ok).toBe(false);
    expect(validateTaskSubmission({ ...ok, outputs: f }).ok).toBe(false);
  });
  it('rejects bad images, urls, paths, backend_parameters and wildcard outputs without prefix', () => {
    const bad = [
      { executors: [{ image: 'registry.example.org/tools/../evil/x', command: ['a'] }] },
      { executors: [{ image: 'a b', command: ['a'] }] },
      { ...ok, inputs: [{ url: 'file:///etc/passwd', path: '/x' }] },
      { ...ok, inputs: [{ url: 'http://example.com/x', path: '/x' }] },
      { ...ok, inputs: [{ url: 'https://169.254.169.254/x', path: '/x' }] },
      { ...ok, inputs: [{ path: '/x' }] },
      { ...ok, inputs: [{ url: 's3://bkt/k', content: 'x', path: '/x' }] },
      { ...ok, inputs: [{ url: 's3://bkt/k', path: '/a/../../etc' }] },
      { ...ok, outputs: [{ url: 's3://bkt/k', path: '/out/*.txt' }] },
      { ...ok, resources: { backend_parameters: { a: 'b' } } },
      { ...ok, resources: { cpu_cores: 17 } }, { ...ok, resources: { ram_gb: 129 } }, { ...ok, resources: { disk_gb: 501 } },
      { ...ok, tags: { 'bad key': 'v' } },
    ];
    for (const t of bad) expect(validateTaskSubmission(t).ok, JSON.stringify(t)).toBe(false);
    expect(validateTaskSubmission({ ...ok, outputs: [{ url: 's3://bkt/k/', path: '/out/*.txt', path_prefix: '/out' }] }).ok).toBe(true);
  });
  it('stripReadOnly drops server-owned fields', () => {
    expect(stripReadOnly({ ...ok, id: 'x', state: 'COMPLETE', logs: [], creation_time: 't' })).toEqual(ok);
  });
});
