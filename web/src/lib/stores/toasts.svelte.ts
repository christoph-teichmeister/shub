import { ApiError } from './api.ts';

export interface ToastItem {
  id: number;
  message: string;
  tone: 'neutral' | 'error' | 'needs-you';
  /** Time on screen; without it the toast stays until dismissed. */
  ms?: number;
  /** Markdown under the message, e.g. the release notes of an update; scrolls when long. */
  details?: string;
}

/** Beyond this many the oldest confirmation goes; errors and needs-you are never dropped by the cap (up to five in all). */
const MAX = 3;
const HARD_MAX = 5;

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
    const i = toasts.findIndex((t, k) => t.tone === 'neutral' && k < toasts.length - 1); // never the one just pushed
    if (i < 0) break;
    toasts.splice(i, 1);
  }
  if (toasts.length > HARD_MAX) toasts.splice(0, toasts.length - HARD_MAX); // errors pile up: still bounded on a phone
}

export function dismissToast(id: number): void {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

/** Toast for a failed call; returns undefined so it can end a catch chain. */
export function toastError(err: unknown): undefined {
  toast(plainError(err), 'error');
  return undefined;
}

/** A sentence a person can act on instead of "HTTP 502" or "fetch failed". */
export function plainError(err: unknown): string {
  if (err instanceof ApiError) {
    // A message the server wrote on purpose stays; a bare status line gets a sentence.
    const bare =
      !err.message ||
      /^(HTTP \d+|Unauthorized|Forbidden|Bad Gateway|Service Unavailable|Gateway Timeout|Internal Server Error)$/i.test(
        err.message,
      );
    if (!bare) return err.message;
    if (err.status === 401 || err.status === 403)
      return "This device isn't allowed to do that. Ask a trusted device to approve it.";
    if (err.status >= 502 && err.status <= 504) return "Can't reach shub. Is it running?";
    return err.status >= 500 ? 'shub hit a problem. Try again.' : `That did not work (code ${err.status}).`;
  }
  if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError'))
    return "shub didn't answer in time. Is it running?";
  if (err instanceof TypeError) return "Can't reach shub. Is it running?";
  return err instanceof Error ? err.message : String(err);
}
