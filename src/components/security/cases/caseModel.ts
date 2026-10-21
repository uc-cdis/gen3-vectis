import type { CaseCreate, CasePatch, CaseRecord } from '@/lib/vectis-kit/spec';

export type Priority = CaseRecord['priority'];
export type CaseStatus = CaseRecord['status'];

/** Rank, not string order: "high" sorts before "low" alphabetically, which is wrong for priorities. */
export const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'critical'];
export const priorityRank = (p: Priority): number => PRIORITIES.indexOf(p);
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
export const PRIORITY_COLOR: Record<Priority, string> = { low: 'blue', medium: 'yellow', high: 'orange', critical: 'red' };

export const STATUSES: readonly CaseStatus[] = ['open', 'in_progress', 'resolved', 'closed'];
export const CASE_STATUS_LABEL: Record<CaseStatus, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };
/** Statuses the Cases list shows by default (closed is hidden). */
export const DEFAULT_VISIBLE_STATUSES: readonly CaseStatus[] = ['open', 'in_progress', 'resolved'];
export const filterCasesByStatus = (cases: readonly CaseRecord[], visible: readonly CaseStatus[]): CaseRecord[] =>
  cases.filter((c) => visible.includes(c.status));

export const CASE_STATUS_COLOR: Record<CaseStatus, string> = { open: 'blue', in_progress: 'violet', resolved: 'green', closed: 'gray' };

/** Limits copied from siem_service/contract.py (ShortText, LongText, tags). */
export const LIMITS = { titleMax: 256, textMax: 8192, tagsMax: 20, tagMax: 256, assigneeMax: 256, noteMax: 8192 } as const;

interface CaseFields {
  title: string;
  description: string;
  tags: string[];
  assignee: string;
}
export type FieldErrors = Partial<Record<'title' | 'description' | 'tags' | 'assignee' | 'note', string>>;

/** The server strips whitespace, so measure the stripped text the same way. */
export function validateCaseFields(f: CaseFields): FieldErrors {
  const errors: FieldErrors = {};
  const title = f.title.trim();
  if (title.length < 1) errors.title = 'A title is required.';
  else if (title.length > LIMITS.titleMax) errors.title = `Title must be at most ${LIMITS.titleMax} characters (now ${title.length}).`;
  if (f.description.trim().length > LIMITS.textMax) errors.description = `Description must be at most ${LIMITS.textMax} characters.`;
  const tags = f.tags.map((t) => t.trim());
  if (tags.length > LIMITS.tagsMax) errors.tags = `At most ${LIMITS.tagsMax} tags (now ${tags.length}).`;
  else if (tags.some((t) => t.length < 1 || t.length > LIMITS.tagMax)) errors.tags = `Each tag must be 1 to ${LIMITS.tagMax} characters.`;
  if (f.assignee.trim().length > LIMITS.assigneeMax) errors.assignee = `Assignee must be at most ${LIMITS.assigneeMax} characters.`;
  return errors;
}

export function validateNote(body: string): string | undefined {
  const n = body.trim();
  if (n.length < 1) return 'A note cannot be empty.';
  if (n.length > LIMITS.noteMax) return `A note must be at most ${LIMITS.noteMax} characters (now ${n.length}).`;
  return undefined;
}

interface CreateInput extends CaseFields { priority: Priority }

export function toCaseCreate(i: CreateInput): CaseCreate {
  const out: CaseCreate = { title: i.title.trim(), priority: i.priority };
  if (i.description.trim()) out.description = i.description.trim();
  if (i.assignee.trim()) out.assignee = i.assignee.trim();
  const tags = [...new Set(i.tags.map((t) => t.trim()))];
  if (tags.length) out.tags = tags;
  return out;
}

interface EditDraft extends CaseFields { priority: Priority; status: CaseStatus }

/**
 * Only the fields that changed, plus the etag the edit is based on. Returns null when nothing changed
 * (the contract rejects an empty patch). An empty assignee means "leave unchanged": the contract has no way to unassign.
 */
export function buildPatch(orig: CaseRecord, d: EditDraft): CasePatch | null {
  const patch: CasePatch = { expected_etag: orig.etag };
  let changed = false;
  const set = <K extends keyof CasePatch>(k: K, v: CasePatch[K]) => { patch[k] = v; changed = true; };
  if (d.title.trim() !== orig.title) set('title', d.title.trim());
  if (d.description.trim() !== orig.description) set('description', d.description.trim());
  if (d.priority !== orig.priority) set('priority', d.priority);
  if (d.status !== orig.status) set('status', d.status);
  const assignee = d.assignee.trim();
  if (assignee && assignee !== (orig.assignee ?? '')) set('assignee', assignee);
  const tags = [...new Set(d.tags.map((t) => t.trim()))];
  if (JSON.stringify(tags) !== JSON.stringify(orig.tags)) set('tags', tags);
  return changed ? patch : null;
}

/** Highest priority first; ties by most recently updated. Pure so the order is testable. */
export function sortCasesByPriority(cases: readonly CaseRecord[]): CaseRecord[] {
  return [...cases].sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority) || b.updated_at.localeCompare(a.updated_at));
}
