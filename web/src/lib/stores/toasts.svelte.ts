export interface ToastItem {
  id: number;
  message: string;
  tone: 'neutral' | 'error' | 'needs-you';
  /** Time on screen; without it the toast stays until dismissed. */
  ms?: number;
  /** Markdown under the message, e.g. the release notes of an update; scrolls when long. */
  details?: string;
}

/** Beyond this many the oldest confirmation goes; errors and needs-you are never dropped by the cap. */
const MAX = 3;

let next = 1;
export const toasts = $state<ToastItem[]>([]);

/** Errors and needs-you stay until closed; confirmations leave after `ms` (paused while hovered); pass 0 to keep one. */
export function toast(
  message: string,
  tone: ToastItem['tone'] = 'neutral',
  ms = tone === 'neutral' ? 4000 : 0,
  details?: string,
): void {
  if (tone !== 'neutral' && toasts.some((t) => t.tone === tone && t.message === message)) return; // a reload repeating the same failure
  toasts.push({ id: next++, message, tone, ms: ms || undefined, details });
  while (toasts.length > MAX) {
    const i = toasts.findIndex((t) => t.tone === 'neutral');
    if (i < 0) break;
    toasts.splice(i, 1);
  }
}

export function dismissToast(id: number): void {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

/** Toast for a failed call; returns undefined so it can end a catch chain. */
export function toastError(err: unknown): undefined {
  toast(err instanceof Error ? err.message : String(err), 'error');
  return undefined;
}
