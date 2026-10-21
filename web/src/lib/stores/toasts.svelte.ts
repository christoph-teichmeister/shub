export interface ToastItem {
  id: number;
  message: string;
  tone: 'neutral' | 'error' | 'needs-you';
  /** Time on screen; without it the toast stays until dismissed. */
  ms?: number;
}

/** Oldest toasts go first beyond this many. */
const MAX = 3;

let next = 1;
export const toasts = $state<ToastItem[]>([]);

/** Errors and needs-you stay until closed; confirmations leave after `ms` (paused while hovered). */
export function toast(message: string, tone: ToastItem['tone'] = 'neutral', ms = tone === 'neutral' ? 4000 : 0): void {
  toasts.push({ id: next++, message, tone, ms: ms || undefined });
  if (toasts.length > MAX) toasts.splice(0, toasts.length - MAX);
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
