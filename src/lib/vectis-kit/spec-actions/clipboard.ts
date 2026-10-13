/** Copy text. Uses the async clipboard API, falls back to a hidden textarea, and reports honestly when both fail. */
type CopyResult = 'copied' | 'copied-fallback' | 'failed';

export async function copyText(text: string): Promise<CopyResult> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    // fall through to the legacy path (permissions policy, insecure context, or a denied prompt)
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.setAttribute('aria-hidden', 'true');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok ? 'copied-fallback' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Save text as a file through a temporary object URL (revoked straight away). */
export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
