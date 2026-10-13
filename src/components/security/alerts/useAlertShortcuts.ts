import { useEffect, useRef } from 'react';
import { isTypingTarget } from './validate';

interface ShortcutHandlers {
  enabled: boolean;
  move: (delta: 1 | -1) => void;
  open: () => void;
  toggleSelect: () => void;
  help: () => void;
}

export const SHORTCUTS: readonly { keys: string; does: string }[] = [
  { keys: 'j', does: 'Move to the next alert' },
  { keys: 'k', does: 'Move to the previous alert' },
  { keys: 'Enter', does: 'Open the highlighted alert' },
  { keys: 'x', does: 'Select or clear the highlighted alert' },
  { keys: '?', does: 'Show this list' },
];

/** Page-level shortcuts. They never fire while the user is typing, with a modifier held, or while a dialog is open. */
export function useAlertShortcuts(h: ShortcutHandlers): void {
  const ref = useRef(h);
  useEffect(() => { ref.current = h; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cur = ref.current;
      if (!cur.enabled || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (e.key === 'j') cur.move(1);
      else if (e.key === 'k') cur.move(-1);
      else if (e.key === 'x') cur.toggleSelect();
      else if (e.key === '?') cur.help();
      else if (e.key === 'Enter') {
        // Enter on a button or link must keep doing what that control does.
        if (t && (t.closest('button') || t.closest('a'))) return;
        cur.open();
      } else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
