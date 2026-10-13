/**
 * Input validation for the alert surfaces. Limits mirror siem-app contract.py (and the @maxLength comments in
 * contract.generated.ts); the server re-validates, this only gives the analyst an early, specific message.
 */
import { MAX_VALUE_LENGTH, matchesIocType } from '@/lib/vectis-kit/spec/indicator';
import { hasControlChars } from '@/lib/safe-text';
import type { IocType } from '@/lib/vectis-kit/spec/indicator';

export const LIMITS = { reason: 512, assignee: 256, comment: 8192, note: 512, value: MAX_VALUE_LENGTH, bulk: 100, caseTitle: 256 } as const;

export function validateReason(raw: string): string | null {
  const s = raw.trim();
  if (!s) return 'A reason is required.';
  if (s.length > LIMITS.reason) return `Keep the reason under ${LIMITS.reason} characters.`;
  return null;
}

export function validateAssignee(raw: string): string | null {
  const s = raw.trim();
  if (!s) return 'Enter who this is assigned to.';
  if (s.length > LIMITS.assignee) return `Keep the name under ${LIMITS.assignee} characters.`;
  if (hasControlChars(s)) return 'The name contains characters that are not allowed.';
  return null;
}

export function validateComment(raw: string): string | null {
  return raw.length > LIMITS.comment ? `Keep the comment under ${LIMITS.comment} characters.` : null;
}

export function validateIndicator(type: IocType, raw: string): string | null {
  const v = raw.trim();
  if (!v) return 'Enter the indicator value.';
  if (v.length > LIMITS.value) return `Keep the value under ${LIMITS.value} characters.`;
  if (hasControlChars(v)) return 'The value contains characters that are not allowed.';
  return matchesIocType(type, v) ? null : `That is not a valid ${type === 'url' ? 'http(s) URL' : type === 'hash' ? 'hash (32 to 128 hex characters)' : type}.`;
}

export function validateConfidence(raw: string): string | null {
  if (!/^\d{1,3}$/.test(raw.trim())) return 'Confidence is a whole number from 0 to 100.';
  return Number(raw) > 100 ? 'Confidence is a whole number from 0 to 100.' : null;
}

export const validateNote = (raw: string): string | null => (raw.length > LIMITS.note ? `Keep the note under ${LIMITS.note} characters.` : null);

/** True when a key press came from somewhere the user is typing, so shortcuts must stay out of the way. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  const role = el.getAttribute('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox' || role === 'spinbutton';
}
